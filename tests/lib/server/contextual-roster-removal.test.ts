import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { removeContextualRosterStudents } from '@/lib/server/contextual-roster-removal'
import { contextualRosterRemovalBodySchema } from '@/lib/validations/contextual-roster-removal'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rosterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const rpc = vi.fn(), from = vi.fn()
const data = { actor_id: actorId, classroom_id: classroomId, roster_ids: [rosterId], requested_count: 1, removed_count: 1 }
const remove = () => removeContextualRosterStudents({ actorId, classroomId, rosterIds: [rosterId] })

describe('contextual preserving roster removal boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue({ data, error: null })
  })
  it('makes one exact preserving call with canonical distinct sorted IDs', async () => {
    rpc.mockResolvedValue({ data: { ...data, roster_ids: [rosterId, otherId], requested_count: 2 }, error: null })
    expect(await removeContextualRosterStudents({ actorId: actorId.toUpperCase(), classroomId: classroomId.toUpperCase(),
      rosterIds: [otherId.toUpperCase(), rosterId, otherId] })).toEqual({ success: true, requested_count: 2, removed_count: 1 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('remove_classroom_students_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_roster_ids: [rosterId, otherId],
    })
    expect(from).not.toHaveBeenCalled()
  })
  it('accepts zero removed rows for an already removed selection', async () => {
    rpc.mockResolvedValue({ data: { ...data, removed_count: 0 }, error: null })
    expect(await remove()).toEqual({ success: true, requested_count: 1, removed_count: 0 })
  })
  it.each(['42501', '22023', 'PT409', '40001', '40P01', '55P03', '55000', 'PT503', 'PGRST202', '42883', 'P0002', 'XX000'])('maps %s without details or retry', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private student detail' } })
    const statusCode = ({ '42501': 403, '22023': 400, PT409: 409, '40001': 409, '40P01': 409, '55P03': 409, '55000': 409 } as Record<string, number>)[code] ?? 503
    await expect(remove()).rejects.toMatchObject({ statusCode, message: expect.not.stringContaining('private') })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('maps only the exact safe duplicate-selection guidance', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.' } })
    await expect(remove()).rejects.toMatchObject({ statusCode: 409, message: 'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.' })
  })
  it.each([null, {}, { data: null, error: null }, { data: [data], error: null },
    { data: { ...data, actor_id: otherId }, error: null }, { data: { ...data, classroom_id: otherId }, error: null },
    { data: { ...data, roster_ids: [otherId] }, error: null }, { data: { ...data, roster_ids: [rosterId, rosterId] }, error: null },
    { data: { ...data, roster_ids: [rosterId.toUpperCase()] }, error: null },
    { data: { ...data, requested_count: 2 }, error: null }, { data: { ...data, removed_count: 2 }, error: null },
    { data: { ...data, removed_count: -1 }, error: null }, { data: { ...data, removed_count: 0.5 }, error: null },
    { data: { ...data, extra: true }, error: null }, { data, error: { code: '42501' } },
    { data, error: null, extra: true }, { data, error: null, status: 503 }, { data, error: null, count: 2 },
  ])('fails closed on malformed or substituted transport %#', async response => {
    rpc.mockResolvedValue(response)
    await expect(remove()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(Object.keys(data))('requires evidence %s', async key => {
    const incomplete: Record<string, unknown> = { ...data }
    delete incomplete[key]
    rpc.mockResolvedValue({ data: incomplete, error: null })
    await expect(remove()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('returns uncertainty on a thrown transport error without claiming rollback', async () => {
    rpc.mockRejectedValue(new Error('private response failure'))
    await expect(remove()).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('Refresh') })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects bad trusted actor before accessing the client', async () => {
    await expect(removeContextualRosterStudents({ actorId: 'bad', classroomId, rosterIds: [rosterId] })).rejects.toMatchObject({ statusCode: 503 })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})

describe('contextual roster removal request contract', () => {
  it('normalizes and deduplicates bounded UUID selections', () => {
    expect(contextualRosterRemovalBodySchema.parse({ roster_ids: [otherId.toUpperCase(), rosterId, otherId] })).toEqual({ roster_ids: [rosterId, otherId] })
  })
  it.each([null, {}, { roster_ids: [] }, { roster_ids: ['invalid'] }, { roster_ids: [null] },
    { roster_ids: Array(101).fill(rosterId) }, { roster_ids: [rosterId], actorId }, { roster_ids: [rosterId], role: 'teacher' },
    { roster_ids: [rosterId], purge: true }, { roster_ids: [rosterId], classroom_id: classroomId }])('rejects malformed or forged request %#', value => {
    expect(contextualRosterRemovalBodySchema.safeParse(value).success).toBe(false)
  })
})
