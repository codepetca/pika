import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { postBaraDecommission } from '@/lib/server/bara-attendance-client'
import { parseDecommissionReceipt } from '@/vendor/attendance-contract/decommission'
import type { Database } from '@/types/database'

const operationSchema = z.object({
  operation_id: z.string().uuid(),
  state: z.enum(['fenced', 'remote_deleted', 'local_deleted']),
  installation_ref: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  roster_ref: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  operation_ref: z.string().regex(/^decommission_[a-f0-9]{32}$/),
  actor_principal_ref: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  deleted_count: z.number().int().nonnegative(),
}).strict()
type Operation = z.infer<typeof operationSchema>
type Scope = { teacherId: string; classroomId: string; operationId: string }
type RpcName = 'begin_attendance_decommission' | 'get_attendance_decommission' |
  'authorize_attendance_decommission_advance' |
  'record_attendance_decommission_receipt' | 'tick_attendance_decommission'

type ExtraArgs<Name extends RpcName> = Omit<Database['public']['Functions'][Name]['Args'],
  'p_teacher_id' | 'p_classroom_id' | 'p_operation_id'>
type RpcCall = { [Name in RpcName]: keyof ExtraArgs<Name> extends never
  ? [name: Name] : [name: Name, extra: ExtraArgs<Name>]
}[RpcName]

async function call(scope: Scope, ...[name, extra]: RpcCall): Promise<Operation> {
  const db = getServiceRoleClient()
  const { data, error } = await db.rpc(name, {
    p_teacher_id: scope.teacherId, p_classroom_id: scope.classroomId,
    p_operation_id: scope.operationId, ...extra,
  })
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 :
      error.code === '22023' ? 400 : 503
    throw new ApiError(status, 'Attendance deletion could not proceed; its safety fence is preserved')
  }
  const op = operationSchema.parse(data)
  if (op.operation_id !== scope.operationId ||
    op.operation_ref !== `decommission_${scope.operationId.replaceAll('-', '')}`) {
    throw new ApiError(503, 'Attendance deletion returned an unverified operation')
  }
  return op
}
function status(op: Operation) {
  return { operation_id: op.operation_id, state: op.state, deleted_count: op.deleted_count,
    attendance_removed: op.state === 'local_deleted', classroom_deleted: false as const }
}
function gate() {
  if (!['canary', 'enabled'].includes(process.env.PIKA_BARA_DECOMMISSION_MODE ?? '')) {
    throw new ApiError(503, 'Attendance deletion is disabled')
  }
}

export async function beginAttendanceDecommission(scope: Scope & { confirmation: string }) {
  gate()
  // This commit must precede ALL remote requests, including replay requests.
  return status(await call(scope, 'begin_attendance_decommission', { p_confirmation: scope.confirmation }))
}

export async function getAttendanceDecommission(scope: Scope) {
  gate()
  return status(await call(scope, 'get_attendance_decommission'))
}

export async function tickAttendanceDecommission(scope: Scope) {
  gate()
  let op = await call(scope, 'authorize_attendance_decommission_advance')
  if (op.state === 'local_deleted') return status(op)
  if (op.state === 'fenced') {
    const request = { schema_version: 1 as const, message_type: 'roster.decommission' as const,
      installation_ref: op.installation_ref, roster_ref: op.roster_ref,
      operation_ref: op.operation_ref, actor_principal_ref: op.actor_principal_ref }
    // A lost begin response is reconciled by the same operation reference.
    let receipt = await postBaraDecommission({ ...request, action: 'begin' })
    if (receipt.state === 'deleting') {
      // The DB gate may have been paused or re-scoped during the begin request.
      await call(scope, 'authorize_attendance_decommission_advance')
      receipt = await postBaraDecommission({ ...request, action: 'tick' })
    }
    if (!parseDecommissionReceipt(receipt, request)) throw new ApiError(503, 'Unverified remote deletion')
    if (receipt.state !== 'deleted') return status(op)
    op = await call(scope, 'record_attendance_decommission_receipt', { p_receipt: { ...receipt } })
  }
  if (op.state === 'remote_deleted') op = await call(scope, 'tick_attendance_decommission')
  // This is attendance completion, never a claim that files/classroom are gone.
  // The existing independently gated permanent-purge workflow remains required.
  return status(op)
}
