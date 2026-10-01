import { describe, expect, it, vi } from 'vitest'
import { readContextualTeacherLogSummary } from '@/lib/server/contextual-teacher-daily-summary'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-30'
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const joined = { id: classroomId, teacher_id: actorId }
const stats = [{ classroom_id: classroomId, date, updated_at: '2026-09-30T13:00:00Z', classroom: joined }]
const cache = {
  id: '44444444-4444-4444-8444-444444444444', classroom_id: classroomId, date,
  summary_items: { policy_version: 'high-priority-v1', overview: 'Progress', action_items: [{ text: 'AB needs help', initials: 'AB' }] },
  initials_map: { AB: 'Alice Brown' }, entry_count: 1,
  entries_updated_at: '2026-09-30T13:00:00Z', generated_at: '2026-09-30T14:00:00Z', classroom: joined,
}

type QueryResult = { data?: unknown; count?: unknown; error?: unknown }
function fixture(overrides: Partial<Record<'classrooms' | 'stats' | 'count' | 'cache', QueryResult>> = {}) {
  const calls: { table: string; select: unknown[]; filters: [string, unknown][] }[] = []
  let entrySelect = 0
  const from = vi.fn((table: string) => {
    const kind = table === 'entries' ? (++entrySelect === 1 ? 'stats' : 'count') : table === 'log_summaries' ? 'cache' : 'classrooms'
    const defaultResult: Record<string, QueryResult> = {
      classrooms: { data: classroom, error: null },
      stats: { data: stats, error: null },
      count: { data: null, count: 1, error: null },
      cache: { data: cache, error: null },
    }
    const result = overrides[kind] ?? defaultResult[kind]
    const call = { table, select: [] as unknown[], filters: [] as [string, unknown][] }
    calls.push(call)
    const query: Record<string, unknown> = {
      select: (...args: unknown[]) => { call.select = args; return query },
      eq: (field: string, value: unknown) => { call.filters.push([field, value]); return query },
      order: () => query,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return query
  })
  return { supabase: { from } as never, calls, from }
}

async function read(f: ReturnType<typeof fixture>) {
  return readContextualTeacherLogSummary({ supabase: f.supabase, actorId, classroomId, date })
}

describe('contextual teacher cached Daily summary', () => {
  it('returns restored ready summary and binds every data statement to current owner, classroom and date', async () => {
    const f = fixture()
    const result = await read(f)
    expect(result).toEqual({ summary_status: 'ready', summary: {
      overview: 'High-priority items were identified by this automated summary.',
      action_items: [{ text: 'Alice Brown needs help', studentName: 'Alice Brown' }],
      generated_at: cache.generated_at,
    } })
    for (const call of f.calls.slice(1)) {
      expect(call.select[0]).toContain('classroom:classrooms!inner(id,teacher_id)')
      expect(call.filters).toEqual(expect.arrayContaining([
        ['classroom_id', classroomId], ['date', date], ['classroom.teacher_id', actorId],
      ]))
    }
    expect(f.calls[2].select[1]).toEqual({ count: 'exact', head: true })
    expect(f.calls[3].select[0]).not.toContain('*')
  })

  it.each([
    [{ classrooms: { data: null, error: null } }, 404],
    [{ classrooms: { data: { ...classroom, teacher_id: otherId }, error: null } }, 403],
    [{ classrooms: { data: { ...classroom, id: otherId }, error: null } }, 503],
    [{ classrooms: { data: { ...classroom, archived_at: '2026-09-01T00:00:00Z' }, error: null } }, 200],
  ] as const)('preflight enforces owner and preserves archive access %#', async (overrides, status) => {
    const f = fixture(overrides)
    if (status === 200) await expect(read(f)).resolves.toHaveProperty('summary_status', 'ready')
    else await expect(read(f)).rejects.toMatchObject({ statusCode: status })
    if (status !== 200) expect(f.calls).toHaveLength(1)
  })

  it('returns no_entries on an exact zero count without reading cache', async () => {
    const f = fixture({ stats: { data: [], error: null }, count: { data: null, count: 0, error: null } })
    await expect(read(f)).resolves.toEqual({ summary: null, summary_status: 'no_entries' })
    expect(f.calls).toHaveLength(3)
  })

  it.each([
    [{ cache: { data: null, error: null } }, 'pending'],
    [{ cache: { data: { ...cache, entry_count: 2 }, error: null } }, 'pending'],
    [{ cache: { data: { ...cache, entries_updated_at: '2026-09-30T12:00:00Z' }, error: null } }, 'pending'],
    [{ cache: { data: { ...cache, summary_items: { policy_version: 'old', overview: 'private' } }, error: null } }, 'unavailable'],
    [{ cache: { data: { ...cache, summary_items: { policy_version: 'high-priority-v1' } }, error: null } }, 'pending'],
  ] as const)('preserves summary status %#', async (overrides, status) => {
    await expect(read(fixture(overrides))).resolves.toEqual({ summary: null, summary_status: status })
  })

  it('allows legacy nullable freshness timestamps', async () => {
    const f = fixture({ cache: { data: { ...cache, entries_updated_at: null }, error: null } })
    await expect(read(f)).resolves.toHaveProperty('summary_status', 'ready')
  })

  it.each([
    { stats: { data: null, error: null } },
    { classrooms: { data: classroom } },
    { classrooms: { data: classroom, error: false } },
    { stats: { data: stats } },
    { stats: { data: stats, error: false } },
    { stats: { data: stats, error: { code: 'XX' } } },
    { stats: { data: [stats[0], stats[0]], error: null } },
    { stats: { data: [{ ...stats[0], classroom: null }], error: null } },
    { stats: { data: [{ ...stats[0], classroom: { ...joined, teacher_id: otherId } }], error: null } },
    { stats: { data: [{ ...stats[0], date: '2026-09-29' }], error: null } },
    { count: { count: null, error: null } },
    { count: { data: null, count: 1 } },
    { count: { data: null, count: 1, error: false } },
    { count: { count: 1, error: null } },
    { count: { data: [], count: 1, error: null } },
    { count: { count: -1, error: null } },
    { count: { count: 1.5, error: null } },
    { count: { count: Number.MAX_SAFE_INTEGER + 1, error: null } },
    { count: { count: 1, error: { code: 'XX' } } },
    { cache: { data: undefined, error: null } },
    { cache: { data: cache } },
    { cache: { data: cache, error: false } },
    { cache: { data: { ...cache, classroom: null }, error: null } },
    { cache: { data: { ...cache, classroom: { ...joined, teacher_id: otherId } }, error: null } },
    { cache: { data: { ...cache, classroom_id: otherId }, error: null } },
    { cache: { data: { ...cache, date: '2026-09-29' }, error: null } },
    { cache: { data: { ...cache, id: otherId, generated_at: 'broken' }, error: null } },
    { cache: { data: { ...cache, summary_items: { policy_version: 'high-priority-v1', overview: 7, action_items: [] } }, error: null } },
    { cache: { data: { ...cache, initials_map: { AB: 7 } }, error: null } },
    { cache: { data: cache, error: { code: 'XX' } } },
  ])('fails closed on malformed or unbound database evidence %#', async (overrides) => {
    await expect(read(fixture(overrides))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('maps query construction and rejected statements to 503', async () => {
    const f = fixture()
    f.from.mockImplementationOnce(() => { throw new Error('builder') })
    await expect(read(f)).rejects.toMatchObject({ statusCode: 503 })
    const rejected = fixture()
    rejected.from.mockImplementationOnce(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.reject(new Error('network')) }) }) }))
    await expect(read(rejected)).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(['entries', 'log_summaries'])('maps %s builder failures to 503', async (table) => {
    const f = fixture()
    const original = f.from.getMockImplementation()!
    f.from.mockImplementation((name: string) => {
      if (name === table) throw new Error('builder')
      return original(name)
    })
    await expect(read(f)).rejects.toMatchObject({ statusCode: 503 })
  })
})
