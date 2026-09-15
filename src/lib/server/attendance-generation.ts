import { z } from 'zod'
import type { getServiceRoleClient } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'

type Client = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>
const generationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), generation_id: z.string().uuid(),
    participant_ref: z.string().regex(/^participant_[a-f0-9]{32}$/) }).strict(),
  z.object({ status: z.literal('forbidden') }).strict(),
])
export type AttendanceScanGeneration = z.infer<typeof generationSchema> | { status: 'legacy' }

export class AttendanceGenerationError extends Error {
  constructor() { super('Attendance membership authorization is unavailable'); this.name = 'AttendanceGenerationError' }
}

function missingBeforeRollout(error: { code?: string; message?: string } | null, functionName: string) {
  return process.env.STUDENT_PROVIDER_CLEANUP_ENABLED !== 'true'
    && ['PGRST202', '42883'].includes(error?.code ?? '')
    && (error?.message ?? '').includes(functionName)
}

/** Schema absence preserves the pre171 path only while cleanup remains disabled.
 * Once present, durable generation fences apply even when application gates pause.
 */
export async function resolveAttendanceScanGeneration(input: {
  supabase: Client; classroomId: string; studentId: string
}): Promise<AttendanceScanGeneration> {
  const { data, error } = await input.supabase.rpc('resolve_attendance_scan_generation', {
    p_classroom_id: input.classroomId, p_student_id: input.studentId,
  })
  if (missingBeforeRollout(error, 'resolve_attendance_scan_generation')) return { status: 'legacy' }
  const parsed = generationSchema.safeParse(data)
  if (error || !parsed.success) throw new AttendanceGenerationError()
  return parsed.data
}

export function sameAttendanceScanGeneration(before: AttendanceScanGeneration, after: AttendanceScanGeneration) {
  if (before.status === 'forbidden' || after.status === 'forbidden') return false
  if (before.status === 'legacy' || after.status === 'legacy') return before.status === after.status
  return before.generation_id === after.generation_id && before.participant_ref === after.participant_ref
}

export async function authorizeAttendanceGenerationDelivery(input: {
  supabase: Client; outboxId: string; leaseToken: string | null; payload: Json
}): Promise<boolean> {
  const { data, error } = await input.supabase.rpc('authorize_attendance_generation_delivery', {
    p_outbox_id: input.outboxId, p_lease_token: input.leaseToken, p_payload: input.payload,
  })
  if (missingBeforeRollout(error, 'authorize_attendance_generation_delivery')) return true
  if (error || typeof data !== 'boolean') throw new AttendanceGenerationError()
  return data
}
