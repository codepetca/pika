import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readClassroomHomeVisibility, setClassroomHomeVisibility } from '@/lib/server/classroom-home-visibility'
import { classroomHomeVisibilitySchema } from '@/lib/validations/classroom-home-visibility'

const actorId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000001'
const enrollmentId = '30000000-0000-4000-8000-000000000001'
const otherId = '40000000-0000-4000-8000-000000000001'
const rpc = vi.fn()
const abortSignal = vi.fn()
const supabase = { rpc } as never
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const read = () => readClassroomHomeVisibility({ supabase, actorId })
const write = (hidden = true) => setClassroomHomeVisibility({ supabase, actorId, classroomId, enrollmentId, hidden })
const writeResult = (hidden = true) => ({ actor_id: actorId, classroom_id: classroomId, enrollment_id: enrollmentId, hidden })

describe('personal classroom home visibility boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockReturnValue({ abortSignal })
  })

  it('requires the displayed enrollment and refuses client identity or unknown fields', () => {
    expect(classroomHomeVisibilitySchema.parse({ enrollmentId, hidden: true })).toEqual({ enrollmentId, hidden: true })
    for (const input of [{ hidden: true }, { enrollmentId, hidden: 'true' }, { enrollmentId, hidden: true, actorId }]) {
      expect(classroomHomeVisibilitySchema.safeParse(input).success).toBe(false)
    }
  })

  it('reads the authenticated actor once with a bounded RPC and preserves empty results', async () => {
    abortSignal.mockResolvedValue(envelope({ actor_id: actorId, hidden_enrollment_ids: [] }))
    await expect(read()).resolves.toEqual({ actor_id: actorId, hidden_enrollment_ids: [] })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_classroom_home_visibility_v1', { p_actor_id: actorId })
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
  })

  it('does not truncate the complete hidden set above the ordinary REST page size', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
    abortSignal.mockResolvedValue(envelope({ actor_id: actorId, hidden_enrollment_ids: ids }))
    await expect(read()).resolves.toEqual({ actor_id: actorId, hidden_enrollment_ids: ids })
  })

  it('fails closed instead of truncating an oversized hidden set', async () => {
    const ids = Array.from({ length: 4097 }, (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
    abortSignal.mockResolvedValue(envelope({ actor_id: actorId, hidden_enrollment_ids: ids }))
    await expect(read()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(['missing_contract', 'transport'])('never substitutes an empty hidden set for %s read failure', async failure => {
    if (failure === 'transport') abortSignal.mockRejectedValue(new Error('private failure'))
    else abortSignal.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'private failure', details: null, hint: null }, status: 404, statusText: 'Error', count: null })
    await expect(read()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledOnce()
  })

  it.each([true, false])('binds a %s write to actor, classroom and expected enrollment', async hidden => {
    abortSignal.mockResolvedValue(envelope(writeResult(hidden)))
    await expect(write(hidden)).resolves.toEqual(writeResult(hidden))
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_classroom_home_visibility_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_expected_enrollment_id: enrollmentId, p_hidden: hidden,
    })
  })

  it.each([
    ['PT400', 'invalid_request', 400], ['PT403', 'forbidden', 403],
    ['PT409', 'busy', 409], ['PT409', 'membership_changed', 409],
    ['PT503', 'unavailable', 503],
  ])('maps only exact established %s/%s failures', async (code, message, status) => {
    abortSignal.mockResolvedValue({ data: null, error: { code, message: `classroom_home_visibility_${message}`, details: null, hint: null }, status, statusText: 'Error', count: null })
    await expect(write()).rejects.toMatchObject({ statusCode: status })
    expect(rpc).toHaveBeenCalledOnce()
  })

  it.each([
    null, {}, { actor_id: otherId, hidden_enrollment_ids: [] },
    { actor_id: actorId, hidden_enrollment_ids: [enrollmentId, enrollmentId] },
    { actor_id: actorId, hidden_enrollment_ids: ['bad'] },
    { actor_id: actorId, hidden_enrollment_ids: [], private: true },
  ])('fails closed for malformed or rebound reads %#', async data => {
    abortSignal.mockResolvedValue(envelope(data))
    await expect(read()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledOnce()
  })

  it.each([
    null, { ...writeResult(), actor_id: otherId }, { ...writeResult(), classroom_id: otherId },
    { ...writeResult(), enrollment_id: otherId }, { ...writeResult(), hidden: false },
    { ...writeResult(), private: true }, { ...writeResult(), hidden: 'true' },
  ])('does not certify malformed or substituted writes %#', async data => {
    abortSignal.mockResolvedValue(envelope(data))
    await expect(write()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledOnce()
  })

  it.each(['read', 'write'])('rejects invalid server identity before %s RPC', async operation => {
    const input = { supabase, actorId: 'invalid', classroomId, enrollmentId, hidden: true }
    await expect(operation === 'read' ? readClassroomHomeVisibility(input) : setClassroomHomeVisibility(input))
      .rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an invalid expected enrollment before making a write', async () => {
    await expect(setClassroomHomeVisibility({ supabase, actorId, classroomId, enrollmentId: 'invalid', hidden: true }))
      .rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['missing', 'unknown', 'mismatched_status', 'partial_envelope', 'rejected'])('sanitizes %s failures without a retry', async kind => {
    const failure = { data: null, error: { code: 'PGRST202', message: 'private failure', details: null, hint: null }, status: 404, statusText: 'Error', count: null }
    if (kind === 'unknown') failure.error.code = '42501'
    if (kind === 'mismatched_status') { failure.error.code = 'PT403'; failure.error.message = 'classroom_home_visibility_forbidden'; failure.status = 400 }
    if (kind === 'rejected') abortSignal.mockRejectedValue(new Error('private failure'))
    else abortSignal.mockResolvedValue(kind === 'partial_envelope' ? { data: writeResult(), error: null } : failure)
    await expect(write()).rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private failure') })
    expect(rpc).toHaveBeenCalledOnce()
  })
})
