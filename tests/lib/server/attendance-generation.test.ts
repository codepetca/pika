import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeAttendanceGenerationDelivery, resolveAttendanceScanGeneration,
  sameAttendanceScanGeneration } from '@/lib/server/attendance-generation'

const classroomId = 'a0000000-0000-4000-8000-000000000001'
const studentId = 'a0000000-0000-4000-8000-000000000002'
const active = { status: 'active' as const, generation_id: 'a0000000-0000-4000-8000-000000000003',
  participant_ref: `participant_${'a'.repeat(32)}` }
function client(data: unknown, error: { code: string; message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error })
  return { rpc } as unknown as Parameters<typeof resolveAttendanceScanGeneration>[0]['supabase'] & { rpc: typeof rpc }
}
afterEach(() => vi.unstubAllEnvs())
describe('durable attendance generation authorization', () => {
  it('reads exact active generation without consulting the rollout gate', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    const supabase = client(active)
    expect(await resolveAttendanceScanGeneration({ supabase, classroomId, studentId })).toEqual(active)
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_attendance_scan_generation', {
      p_classroom_id: classroomId, p_student_id: studentId,
    })
    supabase.rpc.mockResolvedValue({ data: { status: 'forbidden' }, error: null })
    expect(await resolveAttendanceScanGeneration({ supabase, classroomId, studentId })).toEqual({ status: 'forbidden' })
  })
  it('allows only exact missing-RPC compatibility before rollout, never a permission or malformed-response fallback', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    const supabase = client(null, { code: 'PGRST202', message: 'Missing public.resolve_attendance_scan_generation' })
    expect(await resolveAttendanceScanGeneration({ supabase, classroomId, studentId })).toEqual({ status: 'legacy' })
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'true')
    await expect(resolveAttendanceScanGeneration({ supabase, classroomId, studentId })).rejects.toThrow(/authorization/)
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    for (const response of [
      { data: null, error: { code: '42501', message: 'resolve_attendance_scan_generation' } },
      { data: null, error: { code: 'PGRST202', message: 'Missing a different function' } },
      { data: { ...active, participant_ref: 'invalid' }, error: null },
      { data: { ...active, unexpected: true }, error: null },
    ]) {
      supabase.rpc.mockResolvedValue(response)
      await expect(resolveAttendanceScanGeneration({ supabase, classroomId, studentId })).rejects.toThrow(/authorization/)
    }
  })
  it('does not equate removed, replaced or differently mapped generations', () => {
    expect(sameAttendanceScanGeneration(active, active)).toBe(true)
    expect(sameAttendanceScanGeneration(active, { status: 'forbidden' })).toBe(false)
    expect(sameAttendanceScanGeneration(active, { ...active, participant_ref: `participant_${'b'.repeat(32)}` })).toBe(false)
    expect(sameAttendanceScanGeneration(active, { ...active, generation_id: classroomId })).toBe(false)
    expect(sameAttendanceScanGeneration(active, { status: 'legacy' })).toBe(false)
  })
  it('binds send and cached replay to the exact durable payload and lease', async () => {
    const supabase = client(false)
    const payload = { schema_version: 1, participants: [{ participant_ref: active.participant_ref }] }
    const input = { supabase, outboxId: classroomId, leaseToken: studentId, payload }
    expect(await authorizeAttendanceGenerationDelivery(input)).toBe(false)
    expect(supabase.rpc).toHaveBeenCalledWith('authorize_attendance_generation_delivery', {
      p_outbox_id: classroomId, p_lease_token: studentId, p_payload: payload,
    })
    supabase.rpc.mockResolvedValue({ data: true, error: null })
    expect(await authorizeAttendanceGenerationDelivery({ ...input, leaseToken: null })).toBe(true)
    expect(supabase.rpc).toHaveBeenLastCalledWith('authorize_attendance_generation_delivery', {
      p_outbox_id: classroomId, p_lease_token: null, p_payload: payload,
    })
    supabase.rpc.mockResolvedValue({ data: 'true', error: null })
    await expect(authorizeAttendanceGenerationDelivery(input)).rejects.toThrow(/authorization/)
  })
  it('permits pre171 delivery only while disabled and refuses authorization errors', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    const supabase = client(null, { code: 'PGRST202', message: 'Missing public.authorize_attendance_generation_delivery' })
    const input = { supabase, outboxId: classroomId, leaseToken: studentId, payload: {} }
    expect(await authorizeAttendanceGenerationDelivery(input)).toBe(true)
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'true')
    await expect(authorizeAttendanceGenerationDelivery(input)).rejects.toThrow(/authorization/)
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    supabase.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(authorizeAttendanceGenerationDelivery(input)).rejects.toThrow(/authorization/)
  })
})
