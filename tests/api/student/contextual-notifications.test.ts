import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/notifications/route'
import { mockAuthenticationError, mockAuthorizationError } from '../setup'
import { getTodayInToronto } from '@/lib/timezone'

const f = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: f.auth, requireRole: f.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: f.from }) }))
const actor = '76000000-0000-4000-8000-000000000011'
const owner = '76000000-0000-4000-8000-000000000012'
const classroom = '76000000-0000-4000-8000-000000000021'
const generation = '76000000-0000-4000-8000-000000000031'
const root = () => ({ id: classroom, teacher_id: owner, archived_at: null,
  feature_visibility: { classwork: false, tests: false, announcements: false },
  membership: [{ id: generation, classroom_id: classroom, student_id: actor }] })

type Row = Record<string, unknown>
function mockDatabase(change?: (value: Row, index: number, projection: string) => unknown, data: Record<string, Row[]> = {}, cap = 1000) {
  const calls: Array<{ projection: string; filters: Array<[string, unknown]> }> = []
  f.from.mockImplementation((table: string) => {
    expect(table).toBe('classrooms')
    const call = { projection: '', filters: [] as Array<[string, unknown]> }; calls.push(call)
    const q: Record<string, unknown> = {}, limits: Record<string, number> = {}
    for (const name of ['select','eq','neq','is','filter','gt','order','limit','in','or','abortSignal']) {
      q[name] = vi.fn((...args: unknown[]) => {
        if (name === 'select') call.projection = String(args[0])
        if (['eq','neq','is','filter','gt','in','or'].includes(name)) call.filters.push([String(args[0]),args[1]])
        if (name === 'limit') limits[String((args[1] as {referencedTable:string}).referencedTable)] = Number(args[0])
        return q
      })
    }
    q.maybeSingle = vi.fn(async () => {
      let value: Record<string, unknown> = root()
      const page = (rows: Row[], reference: string) => {
        const cursor = call.filters.find(([key]) => key === `${reference}.id`)?.[1]
        return rows.filter(row => typeof cursor !== 'string' || String(row.id) > cursor)
          .sort((a,b) => String(a.id).localeCompare(String(b.id))).slice(0, Math.min(cap, limits[reference] ?? 1000))
      }
      for (const alias of ['days','entries','assignments','tests','announcements']) {
        if (call.projection.includes(`${alias}:`)) value[alias] = data[alias] ?? []
      }
      for (const kind of ['assignments','tests','announcements']) {
        if (!call.projection.includes(`items:${kind}!`)) continue
        const ids = call.filters.find(([key]) => key === 'items.id' && Array.isArray(call.filters.find(([k]) => k === key)?.[1]))?.[1]
        const parents = (data[kind] ?? []).filter(row => !Array.isArray(ids) || ids.includes(row.id))
        value.items = (Array.isArray(ids) ? parents : page(parents, 'items')).map(row => {
          if (!call.projection.includes('children:')) return { ...row }
          const table = ['assignment_docs','test_responses','test_attempts','test_student_availability','announcement_reads'].find(table => call.projection.includes(`children:${table}!`))!
          const parentColumn = kind === 'assignments' ? 'assignment_id' : kind === 'tests' ? 'test_id' : 'announcement_id'
          return { ...row, children: page((data[table] ?? []).filter(child => child[parentColumn] === row.id), 'items.children') }
        })
      }
      if (call.projection === 'id,teacher_id,archived_at') value = { id: classroom, teacher_id: owner, archived_at: null }
      return { data: change ? change(value, calls.length, call.projection) : value, error: null }
    })
    return q
  })
  return calls
}
const request = (query = `classroom_id=${classroom}`) => new NextRequest(`http://localhost/api/student/notifications?${query}`)

describe('contextual student notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    f.auth.mockResolvedValue({ id: actor, email: 'synthetic@example.test', role: 'teacher' })
    f.role.mockRejectedValue(mockAuthorizationError())
  })
  afterEach(() => vi.unstubAllEnvs())
  it('admits a teacher-valued current member through the actual route', async () => {
    const calls = mockDatabase()
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hasTodayEntry: true, unviewedAssignmentsCount: 0, activeTestsCount: 0, unreadAnnouncementsCount: 0 })
    expect(f.role).not.toHaveBeenCalled()
    expect(calls.length).toBeGreaterThan(1)
  })
  it('authenticates before malformed admission or query', async () => {
    f.auth.mockRejectedValue(mockAuthenticationError())
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'broken')
    expect((await GET(request('classroom_id=invalid'))).status).toBe(401)
    expect(f.from).not.toHaveBeenCalled()
  })
  it.each(['classroom_id=invalid', `classroom_id=${classroom}&student_id=${owner}`, `classroom_id=${classroom}&classroom_id=${classroom}`])('rejects strict query %s', async query => {
    expect((await GET(request(query))).status).toBe(400)
    expect(f.from).not.toHaveBeenCalled()
  })
  it('fails closed on malformed configured admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'broken')
    expect((await GET(request())).status).toBe(503)
    expect(f.from).not.toHaveBeenCalled()
  })
  it('rejects a changed enrollment generation before responding', async () => {
    mockDatabase((value, index) => index > 2 ? { ...value, membership: [{ id: owner, classroom_id: classroom, student_id: actor }] } : value)
    expect((await GET(request())).status).toBe(503)
  })
  it.each([false,true])('preserves own today-entry state %s on an active class day', async present => {
    const date = getTodayInToronto()
    mockDatabase(undefined, {
      days:[{id:owner,classroom_id:classroom,date,is_class_day:true}],
      entries:present ? [{id:owner,classroom_id:classroom,date,student_id:actor}] : [],
    })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).hasTodayEntry).toBe(present)
  })
  it.each(['owner','archive','removal','generation','features'])('rejects %s drift at the final control statement', async drift => {
    mockDatabase((value,index,projection) => {
      if (index <= 2 || projection.includes('days:')) return value
      if (drift === 'owner') return { ...value,teacher_id:actor }
      if (drift === 'archive') return { ...value,archived_at:'2026-10-23T12:00:00Z' }
      if (drift === 'removal') return null
      if (drift === 'generation') return { ...value,membership:[{id:owner,classroom_id:classroom,student_id:actor}] }
      return { ...value,feature_visibility:{classwork:true,tests:true,announcements:true} }
    })
    const response = await GET(request())
    expect(response.status).toBe(drift === 'removal' ? 403 : 503)
    expect(await response.json()).not.toHaveProperty('hasTodayEntry')
  })
  it.each([undefined, JSON.stringify({version:1,admittedUserIds:[]})])('preserves legacy role denial when absent or unadmitted %#', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION',config)
    expect((await GET(request())).status).toBe(403)
    expect(f.role).toHaveBeenCalledWith('student')
    expect(f.from).not.toHaveBeenCalled()
  })
  it.each([null, {membership:'bad'}, {feature_visibility:{tests:'yes'}}])('fails closed on malformed database envelope %#', async patch => {
    mockDatabase((value,index) => index === 1 ? value : patch === null ? { ...value,id:'invalid' } : { ...value,...patch })
    expect((await GET(request())).status).toBe(503)
  })
  it('never passes an SDK-supplied API error through as a domain denial', async () => {
    const { ApiError } = await import('@/lib/api-error')
    f.from.mockImplementation(() => { throw new ApiError(418,'private SDK detail') })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({error:'Unable to verify classroom notifications'})
  })
  it('batches more than fifty visible parents without losing notification counts', async () => {
    const assignments = Array.from({length:51},(_,i) => ({
      id:`76000000-0000-4000-8000-${(1000+i).toString().padStart(12,'0')}`,
      classroom_id:classroom,updated_at:'2020-01-01T00:00:00Z',is_draft:false,released_at:null,
    }))
    const calls = mockDatabase((value,index) => index === 1 ? value : {...value,feature_visibility:{classwork:true,tests:false,announcements:false}}, {assignments})
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).unviewedAssignmentsCount).toBe(51)
    expect(calls.filter(call => call.projection.includes('children:assignment_docs!'))).toHaveLength(4)
  })
  it.each(['foreign-parent','foreign-child','future-announcement','parent-update'])('rejects injected %s data before counters', async mutation => {
    const updated_at = '2020-01-01T00:00:00Z'
    const announcement = {id:generation,classroom_id:classroom,updated_at,is_draft:false,scheduled_for:null}
    const data = {announcements:[announcement],announcement_reads:[{id:owner,announcement_id:generation,user_id:actor}]}
    mockDatabase((value,index,projection) => {
      if (index === 1) return value
      const next = { ...value,feature_visibility:{classwork:false,tests:false,announcements:true} }
      const items = next.items as Array<Record<string,unknown>> | undefined
      if (!items?.length) return next
      if (mutation === 'foreign-parent') return { ...next,items:items.map(item => ({...item,classroom_id:owner})) }
      if (mutation === 'future-announcement') return { ...next,items:items.map(item => ({...item,scheduled_for:'2099-01-01T00:00:00Z'})) }
      if (!projection.includes('children:')) return next
      if (mutation === 'parent-update') return {...next,items:items.map(item => ({...item,updated_at:'2021-01-01T00:00:00Z'}))}
      return {...next,items:items.map(item => ({...item,children:[{id:owner,announcement_id:generation,user_id:owner}]}))}
    },data)
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('unreadAnnouncementsCount')
  })
  it.each(['teacher','student'])('admits the same current member with %s account role', async role => {
    f.auth.mockResolvedValue({ id: actor, email: 'synthetic@example.test', role })
    mockDatabase()
    expect((await GET(request())).status).toBe(200)
  })
  it.each([{ teacher_id: actor }, { archived_at: '2026-10-23T12:00:00Z' }])('denies owner precedence and archived classrooms %#', async patch => {
    mockDatabase(value => ({ ...value, ...patch }))
    expect((await GET(request())).status).toBe(403)
  })
  it.each([[], [{ id: generation, classroom_id: owner, student_id: actor }], [{ id: generation, classroom_id: classroom, student_id: owner }]])('rejects malformed membership %#', async membership => {
    mockDatabase((value, index) => index === 1 ? value : { ...value, membership })
    expect((await GET(request())).status).toBe(503)
  })
  it('binds every terminal/data/final statement to active current membership and generation', async () => {
    const calls = mockDatabase()
    expect((await GET(request())).status).toBe(200)
    for (const call of calls.slice(1)) {
      expect(call.projection).toContain('!inner(id,classroom_id,student_id)')
      expect(call.filters).toContainEqual(['id', classroom])
      expect(call.filters).toContainEqual(['teacher_id', owner])
      expect(call.filters).toContainEqual(['archived_at', null])
      expect(call.filters).toContainEqual(['membership.student_id', actor])
      expect(call.filters).toContainEqual(['membership.classroom_id', classroom])
    }
    for (const call of calls.slice(2)) expect(call.filters).toContainEqual(['membership.id', generation])
  })
  it('preserves all four counters using compact paged parent/own-child projections', async () => {
    const id = (n:number) => `76000000-0000-4000-8000-${n.toString().padStart(12,'0')}`
    const timestamp = '2020-01-01T00:00:00Z'
    const assignment = (n:number) => ({ id:id(n), classroom_id:classroom, updated_at:timestamp, is_draft:false, released_at:null })
    const test = (n:number, status='active') => ({ id:id(n), classroom_id:classroom, updated_at:timestamp, status })
    const announcement = (n:number) => ({ id:id(n), classroom_id:classroom, updated_at:timestamp, is_draft:false, scheduled_for:null })
    const data = {
      assignments:[assignment(100), assignment(101), assignment(102)],
      assignment_docs:[{ id:id(200), assignment_id:id(100), student_id:actor, viewed_at:timestamp, returned_at:null, feedback_returned_at:null },
        { id:id(201), assignment_id:id(101), student_id:actor, viewed_at:timestamp, returned_at:'2021-01-01T00:00:00Z', feedback_returned_at:null }],
      tests:[test(300), test(301), test(302), test(303,'closed'), test(304)],
      test_responses:[{ id:id(400), test_id:id(300), student_id:actor, selected_option:null, response_text:'  ' },
        { id:id(401), test_id:id(301), student_id:actor, selected_option:0, response_text:null }],
      test_attempts:[{ id:id(500), test_id:id(302), student_id:actor, is_submitted:false, closed_for_grading_at:timestamp },
        { id:id(501), test_id:id(304), student_id:actor, is_submitted:true, closed_for_grading_at:null }],
      test_student_availability:[{ id:id(600), test_id:id(303), student_id:actor, state:'open' }],
      announcements:[announcement(700),announcement(701)],
      announcement_reads:[{ id:id(800), announcement_id:id(700), user_id:actor }],
    }
    const calls = mockDatabase((value,index) => index === 1 ? value : { ...value, feature_visibility: { classwork:true,tests:true,announcements:true } }, data, 1)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hasTodayEntry:true,unviewedAssignmentsCount:2,activeTestsCount:2,unreadAnnouncementsCount:1 })
    expect(calls.some(call => call.filters.some(([key]) => key === 'items.children.id'))).toBe(true)
    for (const call of calls) expect(call.projection).not.toMatch(/rich_|content|documents|feedback,|\*/)
    for (const call of calls.filter(call => call.projection.includes('children:'))) {
      expect(call.filters.some(([key,value]) => key === 'items.children.student_id' && value === actor || key === 'items.children.user_id' && value === actor)).toBe(true)
      expect(call.filters.some(([key,value]) => key.includes('id.eq.') && key.includes('updated_at.eq.') && (value as {referencedTable:string}).referencedTable === 'items')).toBe(true)
    }
  })
})
