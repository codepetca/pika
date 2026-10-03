import { describe, expect, it, vi } from 'vitest'
import { readContextualAnnouncements } from '@/lib/server/contextual-announcement-read'
import type { getServiceRoleClient } from '@/lib/supabase'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const timestamp = '2026-10-02T12:00:00.123456+00:00'
const now = new Date('2026-10-02T12:00:00.124Z')
const announcement = (index = 1, published_at: string | null = timestamp) => ({
  id: id(index), classroom_id: classroomId, title: 'Title', content: 'Markdown',
  created_by: otherId, is_draft: published_at === null, published_at, scheduled_for: null,
  created_at: timestamp, updated_at: timestamp,
})
const envelope = (data: unknown) => ({ data, error: null })
const root = (announcements: unknown, permission: 'owner' | 'member' = 'member') => ({
  id: classroomId, teacher_id: permission === 'owner' ? actorId : otherId, archived_at: null,
  announcements, membership: [{ classroom_id: classroomId, student_id: actorId }],
})
function client(pages: unknown[], permission: 'owner' | 'member' = 'member', preflight?: { classroom?: unknown; enrollment?: unknown }) {
  const queries: Array<Array<[string, unknown[]]>> = []
  let page = 0
  const from = vi.fn((table: string) => {
    const methods: Array<[string, unknown[]]> = []
    const builder: Record<string, (...args: any[]) => any> = {}
    for (const name of ['select', 'eq', 'neq', 'is', 'or', 'order', 'limit']) {
      builder[name] = (...args: unknown[]) => {
        methods.push([name, args])
        if (name === 'select' && String(args[0]).includes('announcements:')) queries.push(methods)
        return builder
      }
    }
    builder.maybeSingle = () => builder
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const select = String(methods.find(([name]) => name === 'select')?.[1][0])
      const result = select.includes('announcements:') ? pages[page++]
        : table === 'classroom_enrollments'
          ? preflight && 'enrollment' in preflight ? preflight.enrollment : envelope({ classroom_id: classroomId, student_id: actorId })
          : preflight && 'classroom' in preflight ? preflight.classroom : envelope({ id: classroomId, teacher_id: permission === 'owner' ? actorId : otherId, archived_at: null })
      return Promise.resolve(result).then(resolve, reject)
    }
    return builder
  })
  return { supabase: { from } as unknown as ReturnType<typeof getServiceRoleClient>, from, queries }
}
const input = { actorId, classroomId, now }
const read = (pages: unknown[], permission: 'owner' | 'member' = 'member', preflight?: { classroom?: unknown; enrollment?: unknown }) => {
  const fixture = client(pages, permission, preflight)
  return { ...fixture, result: readContextualAnnouncements({ ...input, permission, supabase: fixture.supabase }) }
}

describe('actor-bound shared announcement reads', () => {
  it.each(['owner', 'member'] as const)('returns an authorized empty %s root', async permission => {
    const { result, queries } = read([envelope(root([], permission))], permission)
    await expect(result).resolves.toEqual({ announcements: [] })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContainEqual(['eq', ['id', classroomId]])
  })

  it('roots owner pages in current ownership, preserves transferred creators and strips metadata', async () => {
    const row = { ...announcement(), private_join: { secret: true } }
    const { result, queries, from } = read([envelope(root([row], 'owner')), envelope(root([], 'owner'))], 'owner')
    await expect(result).resolves.toEqual({ announcements: [announcement()] })
    expect(from.mock.calls.every(([table]) => table === 'classrooms')).toBe(true)
    for (const query of queries) {
      expect(query).toContainEqual(['eq', ['teacher_id', actorId]])
      expect(query).toContainEqual(['order', ['published_at', { ascending: false, nullsFirst: true, referencedTable: 'announcements' }]])
      expect(query).toContainEqual(['order', ['id', { ascending: true, referencedTable: 'announcements' }]])
      expect(query).toContainEqual(['limit', [1000, { referencedTable: 'announcements' }]])
      expect(query.some(([, args]) => args[0] === 'announcements.created_by')).toBe(false)
      expect(String(query[0][1][0])).toContain('announcements!announcements_classroom_id_fkey(')
      expect(String(query[0][1][0])).not.toContain('announcements_classroom_id_fkey!inner')
    }
  })

  it('binds members and active classes in every data page with one combined OR', async () => {
    const { result, queries } = read([envelope(root([announcement()])), envelope(root([]))])
    await expect(result).resolves.toEqual({ announcements: [announcement()] })
    for (const query of queries) {
      expect(query).toContainEqual(['neq', ['teacher_id', actorId]])
      expect(query).toContainEqual(['is', ['archived_at', null]])
      expect(query).toContainEqual(['eq', ['membership.student_id', actorId]])
      expect(query).toContainEqual(['eq', ['announcements.is_draft', false]])
      const filters = query.filter(([name]) => name === 'or')
      expect(filters).toHaveLength(1)
      expect(filters[0][1][1]).toEqual({ referencedTable: 'announcements' })
      expect(String(filters[0][1][0])).toContain('scheduled_for.lte.2026-10-02T12:00:00.124Z')
    }
    expect(queries[1]).toContainEqual(['or', [`and(or(scheduled_for.is.null,scheduled_for.lte.2026-10-02T12:00:00.124Z),or(published_at.lt.${timestamp},and(published_at.eq.${timestamp},id.gt.${id(1)})))`, { referencedTable: 'announcements' }]])
  })

  it('keysets null drafts before publications with exact microsecond timestamps and UUID ties', async () => {
    const older = '2026-10-02T12:00:00.123455+00:00'
    const rows = [announcement(1, null), announcement(2, null), announcement(3), announcement(4), announcement(5, older)]
    const { result, queries } = read(rows.map(row => envelope(root([row], 'owner'))).concat([envelope(root([], 'owner'))]), 'owner')
    await expect(result).resolves.toEqual({ announcements: rows })
    expect(queries[1]).toContainEqual(['or', [`and(published_at.is.null,id.gt.${id(1)}),published_at.not.is.null`, { referencedTable: 'announcements' }]])
    expect(queries[3]).toContainEqual(['or', [`published_at.lt.${timestamp},and(published_at.eq.${timestamp},id.gt.${id(3)})`, { referencedTable: 'announcements' }]])
  })

  it('continues after 1000 rows and a short page and requires terminal relationship proof', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => announcement(index + 1))
    const { result, queries } = read([envelope(root(rows.slice(0, 1000), 'owner')), envelope(root(rows.slice(1000), 'owner')), envelope(root([], 'owner'))], 'owner')
    await expect(result).resolves.toEqual({ announcements: rows })
    expect(queries).toHaveLength(3)
  })

  it.each(['owner', 'member'] as const)('discards all pages if %s authority disappears on the terminal read', async permission => {
    const { result } = read([envelope(root([announcement()], permission)), envelope(null)], permission)
    await expect(result).rejects.toMatchObject({ statusCode: 403 })
  })

  it('permits archived owners and denies archived members and owner-as-member precedence', async () => {
    const archived = { ...root([], 'owner'), archived_at: timestamp }
    await expect(read([envelope(archived)], 'owner', { classroom: envelope(archived) }).result).resolves.toEqual({ announcements: [] })
    await expect(read([], 'member', { classroom: envelope({ ...root([]), archived_at: timestamp }) }).result).rejects.toMatchObject({ statusCode: 403 })
    await expect(read([], 'member', { classroom: envelope(root([], 'owner')) }).result).rejects.toMatchObject({ statusCode: 403 })
  })

  it('retains immediate future-publication rows and includes the exact schedule cutoff', async () => {
    const future = announcement(1, '2026-12-01T00:00:00Z')
    const boundary = { ...announcement(2, now.toISOString()), scheduled_for: '2026-10-02T08:00:00.124000-04:00' }
    await expect(read([envelope(root([future, boundary])), envelope(root([]))]).result).resolves.toEqual({ announcements: [future, boundary] })
  })

  it.each([
    { ...announcement(), is_draft: true },
    { ...announcement(1, null), scheduled_for: timestamp },
    { ...announcement(), published_at: null },
    { ...announcement(), scheduled_for: '2026-10-02T12:00:00.123457Z' },
    { ...announcement(), scheduled_for: '2026-10-02T12:00:00.124001Z', published_at: '2026-10-02T12:00:00.124001Z' },
    announcement(1, null),
  ])('rejects invalid publication state or member visibility %#', async row => {
    await expect(read([envelope(root([row]))]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    undefined, { data: undefined, error: null }, { data: null }, { data: null, error: {} },
    envelope({ ...root([]), id: otherId }), envelope({ ...root([]), teacher_id: actorId }),
    envelope({ ...root([]), archived_at: timestamp }), envelope({ ...root([]), membership: [] }),
    envelope({ ...root([]), membership: [{ classroom_id: otherId, student_id: actorId }] }),
    envelope({ ...root([]), membership: [{ classroom_id: classroomId, student_id: otherId }] }),
    envelope({ ...root([]), membership: [{ classroom_id: classroomId, student_id: actorId }, { classroom_id: classroomId, student_id: actorId }] }),
    envelope(root([{ ...announcement(), classroom_id: otherId }])),
    envelope(root([{ ...announcement(), title: undefined }])), envelope(root([{ ...announcement(), content: null }])),
    envelope(root([{ ...announcement(), created_by: 'bad' }])), envelope(root([{ ...announcement(), updated_at: 'bad' }])),
    envelope(root([{ ...announcement(), published_at: 'bad', scheduled_for: 'bad' }])),
    envelope(root([{ ...announcement(), published_at: timestamp, scheduled_for: 'bad' }])),
    envelope(root([{ ...announcement(), published_at: '2026-99-99T12:00:00Z', scheduled_for: '2026-99-99T12:00:00Z' }])),
    envelope(root({})), envelope(root(Array.from({ length: 1001 }, (_, index) => announcement(index)))),
  ])('fails closed on malformed SDK evidence or bindings %#', async page => {
    await expect(read([page]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    [announcement(), announcement()],
    [announcement(2), announcement(1)],
    [announcement(1, '2026-10-02T12:00:00.123455Z'), announcement(2)],
    [announcement(), announcement(2, null)],
  ])('rejects duplicate and backward ordering within pages %#', async rows => {
    await expect(read([envelope(root(rows, 'owner'))], 'owner').result).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects duplicated identities across pages even when timestamps move forward', async () => {
    await expect(read([envelope(root([announcement()], 'owner')), envelope(root([announcement(1, '2026-10-01T12:00:00Z')], 'owner'))], 'owner').result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { preflight: { classroom: envelope(null) }, statusCode: 404 },
    { preflight: { classroom: { data: null } }, statusCode: 503 },
    { preflight: { classroom: envelope({ ...root([]), id: otherId }) }, statusCode: 503 },
    { preflight: { enrollment: envelope(null) }, statusCode: 403 },
    { preflight: { enrollment: { data: null } }, statusCode: 503 },
    { preflight: { enrollment: envelope({ classroom_id: otherId, student_id: actorId }) }, statusCode: 503 },
  ])('preserves strict preflight statuses %#', async ({ preflight, statusCode }) => {
    const { result, queries } = read([], 'member', preflight)
    await expect(result).rejects.toMatchObject({ statusCode })
    expect(queries).toHaveLength(0)
  })

  it('rejects wrong owner preflight before querying data', async () => {
    await expect(read([], 'owner', { classroom: envelope(root([])) }).result).rejects.toMatchObject({ statusCode: 403 })
  })

  it('maps rejected SDK reads and construction failures to generic 503', async () => {
    const fixture = client([], 'member')
    fixture.from.mockImplementationOnce(() => { throw new Error('private') })
    await expect(readContextualAnnouncements({ ...input, permission: 'member', supabase: fixture.supabase })).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify classroom announcements' })
    await expect(read([Promise.resolve().then(() => { throw new Error('private') })]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it('validates query UUIDs and rejects invalid captured dates', async () => {
    const fixture = client([])
    await expect(readContextualAnnouncements({ ...input, classroomId: 'bad', permission: 'member', supabase: fixture.supabase })).rejects.toMatchObject({ statusCode: 400 })
    await expect(readContextualAnnouncements({ ...input, now: new Date('bad'), permission: 'member', supabase: fixture.supabase })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([{ actorId: 'bad' }, { classroomId: 'bad' }])('rejects invalid UUIDs before any SDK query %#', async invalid => {
    const fixture = client([])
    await expect(readContextualAnnouncements({ ...input, ...invalid, permission: 'member', supabase: fixture.supabase })).rejects.toMatchObject({ statusCode: 400 })
    expect(fixture.from).not.toHaveBeenCalled()
  })
})
