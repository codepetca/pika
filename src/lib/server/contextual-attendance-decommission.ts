import { ApiError } from '@/lib/api-error'
import { attendanceDecommissionStatusSchema } from '@/lib/validations/attendance-decommission'

/** SQL owns current ownership at begin and durable actor/class/operation scope thereafter. */
export async function runContextualAttendanceDecommission(operationId: string, run: () => Promise<unknown>) {
  const unavailable = () => new ApiError(503,
    'Attendance deletion outcome is unverified; reconcile using the same operation')
  let result: unknown
  try {
    result = await run()
  } catch (error) {
    // Request validation precedes this boundary. Zod errors here describe stored
    // RPC evidence, not invalid caller input; native/provider errors stay private.
    if (error instanceof ApiError) throw error
    throw unavailable()
  }
  const parsed = attendanceDecommissionStatusSchema.safeParse(result)
  if (!parsed.success || parsed.data.operation_id !== operationId
    || parsed.data.attendance_removed !== (parsed.data.state === 'local_deleted')) throw unavailable()
  return parsed.data
}
