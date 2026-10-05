import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { markContextualAnnouncementsRead } from '@/lib/server/contextual-announcement-receipt'
import { announcementReceiptParamsSchema, announcementReceiptEnvelopeSchema } from '@/lib/validations/contextual-announcement-receipt'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.000Z'
const rpc = vi.fn()
const data = () => ({ actor_id: actorId, classroom_id: classroomId, marked: 3, inserted: 2 })
const success = () => ({ data: data(), error: null, status: 200, statusText: 'OK', count: null })
const markRead = () => markContextualAnnouncementsRead({ actorId, classroomId })

describe('contextual announcement member receipt RPC contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(timestamp))
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue(success())
  })
  afterEach(() => vi.useRealTimers())

  it('binds canonical actor/classroom and a trusted current ISO cutoff to exactly one RPC', async () => {
    expect(await markRead()).toEqual({ success: true, marked: 3 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('mark_announcements_read_for_member_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_cutoff: timestamp,
    })
  })

  it('captures cutoff immediately before the RPC after client initialization', async () => {
    const later = '2026-10-03T12:00:20.000Z'
    vi.mocked(getServiceRoleClient).mockImplementation(() => {
      vi.setSystemTime(new Date(later))
      return { rpc } as unknown as ReturnType<typeof getServiceRoleClient>
    })
    await markRead()
    expect(rpc).toHaveBeenCalledWith('mark_announcements_read_for_member_v1', expect.objectContaining({ p_cutoff: later }))
  })

  it('canonicalizes UUID casing before binding and exact response comparison', async () => {
    expect(await markContextualAnnouncementsRead({ actorId: actorId.toUpperCase(), classroomId: classroomId.toUpperCase() })).toEqual({ success: true, marked: 3 })
    expect(rpc).toHaveBeenCalledWith('mark_announcements_read_for_member_v1', expect.objectContaining({ p_actor_id: actorId, p_classroom_id: classroomId }))
  })

  it.each([[0, 0], [3, 0], [3, 3], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]])('returns eligible count %s rather than newly inserted count %s', async (marked, inserted) => {
    rpc.mockResolvedValue({ data: { ...data(), marked, inserted }, error: null })
    expect(await markRead()).toEqual({ success: true, marked })
  })

  it.each([
    ['42501', 403], ['P0002', 404], ['22023', 400], ['PT409', 409],
    ['PGRST202', 503], ['XX000', 503], ['40001', 503], ['55P03', 503], ['', 503],
  ] as const)('maps only the agreed SQL code %s to %s', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private details', details: null, hint: null }, status: 400, statusText: 'Bad Request', count: null })
    await expect(markRead()).rejects.toMatchObject({ statusCode })
    await expect(markRead()).rejects.not.toMatchObject({ message: 'private details' })
  })

  it.each([
    null, undefined, {}, [], { data: null, error: null }, { data: data() }, { error: null },
    { ...success(), unexpected: true }, { ...success(), error: undefined },
    { ...success(), error: { code: '42501' } },
    { data: null, error: false }, { data: null, error: '' }, { data: null, error: [] },
    { data: null, error: {} }, { data: null, error: { code: 42501 } },
    { data: null, error: { code: '42501', unexpected: true } },
    { data: null, error: { code: '42501', message: { private: true } } },
    { data: { ...data(), unexpected: true }, error: null },
    { data: { ...data(), actor_id: otherId }, error: null },
    { data: { ...data(), classroom_id: otherId }, error: null },
    { data: { ...data(), actor_id: 'bad' }, error: null },
    { data: { ...data(), classroom_id: 'bad' }, error: null },
    { data: { ...data(), marked: -1 }, error: null },
    { data: { ...data(), inserted: -1 }, error: null },
    { data: { ...data(), marked: 1.5 }, error: null },
    { data: { ...data(), inserted: 1.5 }, error: null },
    { data: { ...data(), marked: '3' }, error: null },
    { data: { ...data(), inserted: '2' }, error: null },
    { data: { ...data(), marked: Number.MAX_SAFE_INTEGER + 1 }, error: null },
    { data: { ...data(), inserted: Number.MAX_SAFE_INTEGER + 1 }, error: null },
    { data: { ...data(), marked: Infinity }, error: null },
    { data: { ...data(), inserted: NaN }, error: null },
    { data: { ...data(), marked: 1, inserted: 2 }, error: null },
    { ...success(), count: '3' }, { ...success(), status: '200' },
    Object.create({ data: data(), error: null }),
    Object.assign(Object.create({ error: null }), { data: data() }),
    Object.assign(Object.create({ data: null }), { error: { code: '42501' } }),
  ])('fails closed on malformed SDK evidence %#', async response => {
    rpc.mockResolvedValue(response)
    await expect(markRead()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects SDK and client initialization exceptions', async () => {
    rpc.mockRejectedValue(new Error('private transport details'))
    await expect(markRead()).rejects.toMatchObject({ statusCode: 503 })
    vi.mocked(getServiceRoleClient).mockImplementation(() => { throw new Error('private configuration details') })
    await expect(markRead()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects malformed actor before any SDK invocation', async () => {
    await expect(markContextualAnnouncementsRead({ actorId: 'bad', classroomId })).rejects.toMatchObject({ statusCode: 503 })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed classroom before any SDK invocation', async () => {
    await expect(markContextualAnnouncementsRead({ actorId, classroomId: 'bad' })).rejects.toThrow()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('announcement receipt transport schemas', () => {
  it('normalizes only valid UUID route parameters and rejects authority fields', () => {
    expect(announcementReceiptParamsSchema.parse({ id: classroomId.toUpperCase() })).toEqual({ id: classroomId })
    expect(announcementReceiptParamsSchema.safeParse({ id: 'bad' }).success).toBe(false)
    expect(announcementReceiptParamsSchema.safeParse({ id: classroomId, actor_id: actorId }).success).toBe(false)
  })

  it('requires an explicit own error and data envelope', () => {
    expect(announcementReceiptEnvelopeSchema.safeParse(success()).success).toBe(true)
    expect(announcementReceiptEnvelopeSchema.safeParse(Object.create(success())).success).toBe(false)
  })
})
