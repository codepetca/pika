import { describe, expect, it, vi } from 'vitest'
import { readContextualLessonPlans } from '@/lib/server/contextual-lesson-plan-read'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const planId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const timestamp = '2026-09-01T12:00:00+00:00'
const plan = (date: string, id = planId) => ({
  id, classroom_id: classroomId, date, content: { type: 'doc', content: [] },
  content_markdown: 'Plan', created_at: timestamp, updated_at: timestamp,
  artifact_id: planId, source_artifact_id: null, source_blueprint_version_id: null,
  blueprint_archived_at: null,
})
const root = (plans: unknown, visibility: unknown = 'all', membership: unknown = [{ classroom_id: classroomId, student_id: actorId }]) => ({
  id: classroomId, teacher_id: otherId, archived_at: null, lesson_plan_visibility: visibility,
  plans, membership,
})
function client(pages: unknown[], permission: 'owner' | 'member' = 'member', preflight?: { classroom?: unknown; enrollment?: unknown }) {
  const queries: Array<{ methods: Array<[string, unknown[]]> }> = []
  let count = 0
  let table = ''
  const from = vi.fn((name: string) => {
    table = name
    const record = { methods: [] as Array<[string, unknown[]]> }
    const builder: Record<string, (...args: unknown[]) => unknown> = {}
    for (const method of ['select', 'eq', 'neq', 'is', 'gte', 'lte', 'gt', 'order', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        record.methods.push([method, args])
        if (method === 'select' && String(args[0]).includes('plans:')) queries.push(record)
        return builder
      }
    }
    builder.maybeSingle = () => builder
    builder.then = (resolve: (value: unknown) => unknown) => {
      const select = String(record.methods.find(([method]) => method === 'select')?.[1][0])
      if (select.includes('plans:')) return resolve(pages[count++])
      if (table === 'classroom_enrollments') return resolve(preflight && 'enrollment' in preflight ? preflight.enrollment : envelope({ classroom_id: classroomId, student_id: actorId }))
      return resolve(preflight && 'classroom' in preflight ? preflight.classroom : envelope({ id: classroomId, teacher_id: permission === 'owner' ? actorId : otherId, archived_at: null }))
    }
    return builder
  })
  return { supabase: { from } as any, queries, from }
}
const input = { actorId, classroomId, start: '2026-09-01', end: '2026-09-30' }
const envelope = (data: unknown) => ({ data, error: null })

describe('actor-bound contextual lesson-plan read', () => {
  it('roots each page in current owner and returns the full projection with markdown', async () => {
    const { supabase, queries, from } = client([envelope({ ...root([plan('2026-09-19')]), teacher_id: actorId, membership: undefined }), envelope({ ...root([]), teacher_id: actorId, membership: undefined })], 'owner')
    const result = await readContextualLessonPlans({ ...input, permission: 'owner', supabase })
    expect(result.lesson_plans).toEqual([{ ...plan('2026-09-19') }])
    expect(from).toHaveBeenCalledWith('classrooms')
    expect(queries[0].methods).toContainEqual(['eq', ['teacher_id', actorId]])
    expect(queries[1].methods).toContainEqual(['gt', ['plans.date', '2026-09-19']])
    expect(queries[0].methods).toContainEqual(['limit', [1000, { referencedTable: 'plans' }]])
    expect(queries[0].methods.find(([name]) => name === 'select')?.[1][0]).toContain('source_blueprint_version_id')
  })

  it('requires member identity, active class, and same-statement visibility', async () => {
    const { supabase, queries } = client([envelope(root([plan('2026-09-19')], 'current_week')), envelope(root([], 'current_week'))])
    const result = await readContextualLessonPlans({ ...input, permission: 'member', supabase, now: new Date('2026-09-16T12:00:00') })
    expect(result).toMatchObject({ visibility: 'current_week', max_date: '2026-09-19' })
    expect(queries[0].methods).toContainEqual(['neq', ['teacher_id', actorId]])
    expect(queries[0].methods).toContainEqual(['is', ['archived_at', null]])
    expect(queries[0].methods).toContainEqual(['eq', ['membership.student_id', actorId]])
    expect(queries[0].methods).toContainEqual(['lte', ['plans.date', '2026-09-30']])
    expect(queries[1].methods).toContainEqual(['lte', ['plans.date', '2026-09-19']])
  })

  it('continues after a full 1000-row page and reads the terminal empty page', async () => {
    const many = Array.from({ length: 1001 }, (_, index) => plan(new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`))
    const pages = [envelope({ ...root(many.slice(0, 1000)), teacher_id: actorId, membership: undefined }), envelope({ ...root(many.slice(1000)), teacher_id: actorId, membership: undefined }), envelope({ ...root([]), teacher_id: actorId, membership: undefined })]
    const { supabase, queries } = client(pages, 'owner')
    const result = await readContextualLessonPlans({ ...input, start: '2025-01-01', end: '2028-12-31', permission: 'owner', supabase })
    expect(result.lesson_plans).toHaveLength(1001)
    expect(queries).toHaveLength(3)
  })

  it('continues after a short nonterminal page', async () => {
    const first = plan('2026-09-18')
    const second = plan('2026-09-19', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    const { supabase, queries } = client([envelope(root([first])), envelope(root([second])), envelope(root([]))])
    const result = await readContextualLessonPlans({ ...input, permission: 'member', supabase })
    expect(result.lesson_plans).toHaveLength(2)
    expect(queries).toHaveLength(3)
  })

  it.each([
    { data: undefined, error: null }, envelope(undefined), envelope({ ...root([]), id: otherId }),
    envelope({ ...root([]), membership: [] }), envelope({ ...root([]), lesson_plan_visibility: undefined }),
    envelope(root([plan('2026-09-31')])), envelope(root([{ ...plan('2026-09-19'), classroom_id: otherId }])),
  ])('fails closed on malformed envelope, relationship, visibility or row %#', async (bad) => {
    const { supabase } = client([bad])
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('discards accumulated pages if access or visibility changes on terminal page', async () => {
    const { supabase } = client([envelope(root([plan('2026-09-19')], 'all')), envelope(root([], 'current_week'))])
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns 403 when the current authorized root disappears on a later page', async () => {
    const { supabase } = client([envelope(root([plan('2026-09-19')], 'all')), envelope(null)])
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([undefined, null, 'broken', { type: 'not-doc' }])('rejects absent or invalid plan content %#', async content => {
    const { supabase } = client([envelope(root([{ ...plan('2026-09-19'), content }])), envelope(root([]))])
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({
      statusCode: 503, message: 'Unable to verify classroom lesson plans',
    })
  })

  it('rejects duplicate plan identities across pages', async () => {
    const { supabase } = client([envelope(root([plan('2026-09-18')])), envelope(root([plan('2026-09-19')])), envelope(root([]))])
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('does not treat a malformed null preflight envelope as a missing classroom', async () => {
    const { supabase } = client([], 'member', { classroom: { data: null } })
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { preflight: { classroom: envelope(null) }, statusCode: 404 },
    { preflight: { classroom: envelope({ id: classroomId, teacher_id: actorId, archived_at: null }) }, statusCode: 403 },
    { preflight: { classroom: envelope({ id: classroomId, teacher_id: otherId, archived_at: timestamp }) }, statusCode: 403 },
    { preflight: { enrollment: envelope(null) }, statusCode: 403 },
    { preflight: { enrollment: { data: null } }, statusCode: 503 },
  ])('preserves strict member preflight status %#', async ({ preflight, statusCode }) => {
    const { supabase, queries } = client([], 'member', preflight)
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode })
    expect(queries).toHaveLength(0)
  })

  it('allows an archived current owner and does not apply member visibility', async () => {
    const future = plan('2026-09-30')
    const { supabase } = client([
      envelope({ ...root([future], 'current_week'), teacher_id: actorId, membership: undefined }),
      envelope({ ...root([], 'current_week'), teacher_id: actorId, membership: undefined }),
    ], 'owner', { classroom: envelope({ id: classroomId, teacher_id: actorId, archived_at: timestamp }) })
    const result = await readContextualLessonPlans({ ...input, permission: 'owner', supabase, now: new Date('2026-09-16T12:00:00') })
    expect(result.lesson_plans).toEqual([future])
  })

  it('omits plans above the first page current visibility while checking the terminal page', async () => {
    const { supabase, queries } = client([envelope(root([plan('2026-09-30')], 'current_week')), envelope(root([], 'current_week'))])
    const result = await readContextualLessonPlans({ ...input, permission: 'member', supabase, now: new Date('2026-09-16T12:00:00') })
    expect(result.lesson_plans).toEqual([])
    expect(queries).toHaveLength(2)
  })

  it.each([
    { now: '2026-03-07T12:00:00', visibility: 'current_week', max: '2026-03-07' },
    { now: '2026-03-08T12:00:00', visibility: 'current_week', max: '2026-03-14' },
    { now: '2026-03-08T12:00:00', visibility: 'one_week_ahead', max: '2026-03-21' },
    { now: '2026-11-01T12:00:00', visibility: 'current_week', max: '2026-11-07' },
    { now: '2026-03-08T12:00:00', visibility: null, max: '2026-03-14' },
  ] as const)('computes Toronto Saturday visibility across Sunday and DST %#', async ({ now, visibility, max }) => {
    const { supabase } = client([envelope(root([], visibility))])
    const result = await readContextualLessonPlans({ ...input, permission: 'member', supabase, now: new Date(now) })
    expect(result).toMatchObject({ visibility: visibility ?? 'current_week', max_date: max })
  })

  it('treats null-to-current-week visibility change on terminal page as a change', async () => {
    const { supabase } = client([envelope(root([plan('2026-09-19')], null)), envelope(root([], 'current_week'))])
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('strips joined metadata and derives markdown from valid rich content', async () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }
    const { supabase } = client([envelope(root([{ ...plan('2026-09-19'), content, content_markdown: null, joined: { secret: true } }])), envelope(root([]))])
    const result = await readContextualLessonPlans({ ...input, permission: 'member', supabase })
    expect(result.lesson_plans[0].content_markdown).toContain('Hello')
    expect(result.lesson_plans[0]).not.toHaveProperty('joined')
    expect(Object.keys(result.lesson_plans[0])).toHaveLength(11)
  })

  it.each(['construction', 'await'] as const)('maps preflight $0 failure to generic 503', async mode => {
    const { supabase, from } = client([], 'member', mode === 'await' ? { classroom: Promise.reject(new Error('private')) } : undefined)
    if (mode === 'construction') from.mockImplementationOnce(() => { throw new Error('private') })
    await expect(readContextualLessonPlans({ ...input, permission: 'member', supabase })).rejects.toMatchObject({
      statusCode: 503, message: 'Unable to verify classroom lesson plans',
    })
  })

  it('queries even when requested dates are beyond current visibility', async () => {
    const { supabase, queries } = client([envelope(root([], 'current_week'))])
    const result = await readContextualLessonPlans({ ...input, start: '2027-01-01', end: '2027-02-01', permission: 'member', supabase, now: new Date('2026-09-16T12:00:00') })
    expect(result.lesson_plans).toEqual([])
    expect(queries).toHaveLength(1)
  })
})
