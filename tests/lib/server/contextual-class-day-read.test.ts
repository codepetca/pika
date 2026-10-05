import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readContextualClassDays } from '@/lib/server/contextual-class-day-read'
import type { Database } from '@/types/database'
import type { getServiceRoleClient } from '@/lib/supabase'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const day = (n = 1, date = '2026-10-03') => ({ id: id(n), classroom_id: classroomId, date, is_class_day: true, prompt_text: null as string | null })
const envelope = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK' })
type Permission = 'owner' | 'member'
const classroom = (permission: Permission) => ({ id: classroomId, teacher_id: permission === 'owner' ? actorId : otherId, archived_at: null as string | null })
const root = (days: unknown, permission: Permission = 'owner') => ({ ...classroom(permission), class_days: days, ...(permission === 'member' ? { membership: [{ classroom_id: classroomId, student_id: actorId }] } : {}) })
function fixture(pages: unknown[], permission: Permission = 'owner', preflight: { classroom?: unknown; enrollment?: unknown } = {}) {
  const queries: Array<Array<[string, unknown[]]>> = []
  let page = 0
  const from = vi.fn((table: string) => {
    const methods: Array<[string, unknown[]]> = []
    const builder: Record<string, (...args: unknown[]) => unknown> = {}
    for (const name of ['select', 'eq', 'neq', 'is', 'or', 'order', 'limit', 'maybeSingle']) {
      builder[name] = (...args) => { methods.push([name, args]); return builder }
    }
    builder.then = (...args) => {
      const select = String(methods.find(([name]) => name === 'select')?.[1][0])
      const payload = select.includes('class_days:')
      if (payload) queries.push(methods)
      const result = payload ? pages[page++] : table === 'classroom_enrollments'
        ? 'enrollment' in preflight ? preflight.enrollment : envelope({ classroom_id: classroomId, student_id: actorId })
        : 'classroom' in preflight ? preflight.classroom : envelope(classroom(permission))
      return Promise.resolve(result).then(args[0] as (value: unknown) => unknown, args[1] as (reason: unknown) => unknown)
    }
    return builder
  })
  return { from, queries, supabase: { from } as unknown as ReturnType<typeof getServiceRoleClient> }
}
function read(pages: unknown[], permission: Permission = 'owner', preflight?: { classroom?: unknown; enrollment?: unknown }) {
  const client = fixture(pages, permission, preflight)
  return { ...client, result: readContextualClassDays({ supabase: client.supabase, actorId, classroomId }) }
}

describe('shared class-day reads with current statement relationships', () => {
  it.each(['owner', 'member'] as const)('returns five fields and binds every %s payload including terminal', async permission => {
    const row = { ...day(), prompt_text: '  Historical prompt  ', is_class_day: false }
    const { result, queries } = read([envelope(root([row], permission)), envelope(root([], permission))], permission)
    await expect(result).resolves.toEqual({ class_days: [row] })
    expect(Object.keys(row)).toHaveLength(5)
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      expect(query).toContainEqual(['eq', ['id', classroomId]])
      expect(String(query[0][1][0])).toContain('class_days:class_days!class_days_classroom_id_fkey(id,classroom_id,date,is_class_day,prompt_text)')
      expect(query).toContainEqual(['order', ['date', { ascending: true, referencedTable: 'class_days' }]])
      expect(query).toContainEqual(['order', ['id', { ascending: true, referencedTable: 'class_days' }]])
      expect(query).toContainEqual(['limit', [1000, { referencedTable: 'class_days' }]])
      if (permission === 'owner') expect(query).toContainEqual(['eq', ['teacher_id', actorId]])
      else {
        expect(String(query[0][1][0])).toContain('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)')
        expect(query).toContainEqual(['neq', ['teacher_id', actorId]])
        expect(query).toContainEqual(['is', ['archived_at', null]])
        expect(query).toContainEqual(['eq', ['membership.student_id', actorId]])
      }
    }
    expect(queries[1]).toContainEqual(['or', [`date.gt.2026-10-03,and(date.eq.2026-10-03,id.gt.${id(1)})`, { referencedTable: 'class_days' }]])
  })

  it.each(['owner', 'member'] as const)('reads >1000 days through short %s pages and requires terminal proof', async permission => {
    const rows = Array.from({ length: 1002 }, (_, index) => day(index + 1, new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10)))
    const { result, queries } = read([envelope(root(rows.slice(0, 1000), permission)), envelope(root(rows.slice(1000, 1001), permission)), envelope(root(rows.slice(1001), permission)), envelope(root([], permission))], permission)
    await expect(result).resolves.toEqual({ class_days: rows })
    expect(queries).toHaveLength(4)
    expect(queries[1]).toContainEqual(['or', [`date.gt.${rows[999].date},and(date.eq.${rows[999].date},id.gt.${rows[999].id})`, { referencedTable: 'class_days' }]])
  })

  it('allows archived owners with owner precedence and denies archived or removed members', async () => {
    const archived_at = '2026-10-03T12:00:00Z'
    const owner = read([envelope({ ...root([]), archived_at })], 'owner', { classroom: envelope({ ...classroom('owner'), archived_at }) })
    await expect(owner.result).resolves.toEqual({ class_days: [] })
    expect(owner.from).not.toHaveBeenCalledWith('classroom_enrollments')
    await expect(read([], 'member', { classroom: envelope({ ...classroom('member'), archived_at }) }).result).rejects.toMatchObject({ statusCode: 403 })
    await expect(read([], 'member', { enrollment: envelope(null) }).result).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each(['owner', 'member'] as const)('discards %s data when current relationship disappears first/later/terminal', async permission => {
    for (const prefix of [[], [envelope(root([day()], permission))], [envelope(root([day()], permission)), envelope(root([day(2, '2026-10-04')], permission))]]) {
      await expect(read([...prefix, envelope(null)], permission).result).rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it.each([
    undefined, null, {}, [], { data: null }, { error: null }, { data: undefined, error: null },
    { data: null, error: false }, { data: null, error: {} }, Object.create(envelope(root([]))),
    { ...envelope(root([])), unexpected: true }, { ...envelope(root([])), error: { code: '42501' } },
    { ...envelope(root([])), status: 500 }, { ...envelope(root([])), status: 0 },
    { ...envelope(root([])), count: -1 }, { ...envelope(root([])), count: 1.5 },
    envelope({ ...root([]), id: otherId }), envelope({ ...root([]), teacher_id: otherId }),
    envelope({ ...root([]), archived_at: 'bad' }), envelope({ ...root([]), extra: true }),
    envelope(root(null)), envelope(root({})), envelope(root([null])),
    envelope(root(Array.from({ length: 1001 }, (_, n) => day(n + 1)))),
  ])('rejects malformed SDK/owner evidence %#', async page => {
    await expect(read([page]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    [], null, {}, [{ classroom_id: otherId, student_id: actorId }], [{ classroom_id: classroomId, student_id: otherId }],
    [{ classroom_id: classroomId, student_id: actorId, extra: true }],
    [{ classroom_id: classroomId, student_id: actorId }, { classroom_id: classroomId, student_id: actorId }],
  ])('rejects substituted/malformed/cardinality member evidence %#', async membership => {
    await expect(read([envelope({ ...root([], 'member'), membership })], 'member').result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([{ teacher_id: actorId }, { archived_at: '2026-10-03T12:00:00Z' }])('rejects invalid current member roots %#', async patch => {
    await expect(read([envelope({ ...root([], 'member'), ...patch })], 'member').result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { id: 'bad' }, { classroom_id: otherId }, { date: '2026-02-30' }, { date: '2026-1-01' }, { date: 'infinity' },
    { is_class_day: 1 }, { is_class_day: undefined }, { prompt_text: 7 }, { prompt_text: undefined }, { private: true },
  ])('rejects malformed or foreign class-day fields %#', async patch => {
    await expect(read([envelope(root([{ ...day(), ...patch }]))]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    [day(), day()], [day(), day(2)], [day(2), day(1)], [day(1, '2026-10-04'), day(2)],
    [day(), day(1, '2026-10-04')],
  ])('rejects duplicate IDs/dates and backward cursors within/across pages %#', async (first, second) => {
    await expect(read([envelope(root([first, second]))]).result).rejects.toMatchObject({ statusCode: 503 })
    await expect(read([envelope(root([first])), envelope(root([second]))]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { classroom: envelope(null), status: 404 }, { classroom: { data: null }, status: 503 },
    { classroom: envelope({ ...classroom('owner'), id: otherId }), status: 503 },
    { enrollment: envelope(null), status: 403 }, { enrollment: { data: null }, status: 503 },
    { enrollment: envelope({ classroom_id: otherId, student_id: actorId }), status: 503 },
    { enrollment: envelope({ classroom_id: classroomId, student_id: otherId }), status: 503 },
  ])('distinguishes preflight missing/denied/malformed %#', async ({ status, ...preflight }) => {
    const { result, queries } = read([], 'member', preflight)
    await expect(result).rejects.toMatchObject({ statusCode: status })
    expect(queries).toHaveLength(0)
  })

  it('rejects invalid identities before client access and maps transport failure to 503', async () => {
    const client = fixture([])
    await expect(readContextualClassDays({ supabase: client.supabase, actorId: 'bad', classroomId })).rejects.toMatchObject({ statusCode: 400 })
    expect(client.from).not.toHaveBeenCalled()
    client.from.mockImplementation(() => { throw new Error('private transport detail') })
    await expect(readContextualClassDays({ supabase: client.supabase, actorId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('fails closed when enrollment or payload transport throws after preflight', async () => {
    for (const permission of ['owner', 'member'] as const) {
      const client = fixture([], permission)
      const initial = client.from.getMockImplementation()!
      let calls = 0
      client.from.mockImplementation(table => {
        if (++calls === 2) throw new Error('private transport detail')
        return initial(table)
      })
      await expect(readContextualClassDays({ supabase: client.supabase, actorId, classroomId })).rejects.toMatchObject({ statusCode: 503 })
    }
  })

  it.each(['owner', 'member'] as const)('uses the installed SDK to serialize the %s FK, authority, order, limit and cursor', async permission => {
    const urls: URL[] = []
    const responses = [classroom(permission), ...(permission === 'member' ? [{ classroom_id: classroomId, student_id: actorId }] : []), root([day()], permission), root([], permission)]
    const fetcher = vi.fn(async (request: RequestInfo | URL) => {
      urls.push(new URL(String(request)))
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-service-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
    await expect(readContextualClassDays({ supabase, actorId, classroomId })).resolves.toEqual({ class_days: [day()] })
    const payloads = urls.filter(url => url.searchParams.get('select')?.includes('class_days:'))
    expect(payloads).toHaveLength(2)
    for (const url of payloads) {
      expect(url.pathname).toBe('/rest/v1/classrooms')
      expect(url.searchParams.get('id')).toBe(`eq.${classroomId}`)
      expect(url.searchParams.get('class_days.order')).toBe('date.asc,id.asc')
      expect(url.searchParams.get('class_days.limit')).toBe('1000')
      expect(url.searchParams.has('offset')).toBe(false)
      expect(url.searchParams.get('teacher_id')).toBe(`${permission === 'owner' ? 'eq' : 'neq'}.${actorId}`)
      if (permission === 'member') {
        expect(url.searchParams.get('archived_at')).toBe('is.null')
        expect(url.searchParams.get('membership.student_id')).toBe(`eq.${actorId}`)
      }
    }
    expect(payloads[1].searchParams.get('class_days.or')).toBe(`(date.gt.2026-10-03,and(date.eq.2026-10-03,id.gt.${id(1)}))`)
  })
})
