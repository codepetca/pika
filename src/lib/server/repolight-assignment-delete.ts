import { logServerError } from '@/lib/server/diagnostics'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { advanceReservedRepoLightCleanup } from '@/lib/server/repolight-decommission-database'

const contextSchema = z.object({
  assignment_id: z.string().uuid(), classroom_id: z.string().uuid(),
  assignment_updated_at: z.string().datetime({ offset: true }),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  pending_operation_id: z.string().uuid().nullable(),
  subject_count: z.number().int().nonnegative(),
})
const statusSchema = z.object({
  operation_id: z.string().uuid(), kind: z.literal('assignment_delete'),
  status: z.enum(['cleanup_pending', 'completed']), pending_subject_count: z.number().int().nonnegative(),
})
export const assignmentDeleteCleanupRequestSchema = z.object({ operationId: z.string().uuid() }).strict()

type Response = { data: unknown; error: { code?: string } | null }
async function checked(response: PromiseLike<Response>) {
  const result = await response
  if (result.error) {
    const status = result.error.code === '42501' ? 403 : ['40001', '55000'].includes(result.error.code ?? '') ? 409 : 503
    if (status >= 500) logServerError('assignment.delete', result.error)
    throw new ApiError(status, 'Assignment deletion could not continue. Retry the confirmed operation.')
  }
  return result.data
}

/** The existing DELETE action supplies consent; SQL locks current ownership and
 * reserves its exact source before this bounded step makes any provider call. */
export async function deleteAssignmentWithRepoLightCleanup(input: {
  actorId: string; assignmentId: string; operationId?: string
}, dependencies: {
  client?: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>
  cleanup?: typeof advanceReservedRepoLightCleanup
} = {}) {
  const client = dependencies.client ?? getServiceRoleClient()
  const context = contextSchema.parse(await checked(client.rpc('get_repolight_assignment_delete_context_v1', {
    p_actor_id: input.actorId, p_assignment_id: input.assignmentId,
  })))
  if (context.assignment_id !== input.assignmentId) throw new ApiError(409, 'Assignment deletion context changed')
  // Reopening a confirmation cannot capture a different snapshot while an older
  // confirmed deletion is pending. Its original CAS and operation are retained.
  let operationId = context.pending_operation_id ?? input.operationId ?? randomUUID()
  const reservation = statusSchema.parse(await checked(client.rpc('reserve_repolight_assignment_delete_v1', {
    p_actor_id: input.actorId, p_assignment_id: input.assignmentId, p_operation_id: operationId,
    p_expected_updated_at: context.assignment_updated_at, p_expected_source_fingerprint: context.source_fingerprint,
  })))
  operationId = reservation.operation_id
  if (reservation.status !== 'completed' && !await (dependencies.cleanup ?? advanceReservedRepoLightCleanup)(input.actorId, operationId, 'decommission')) {
    return { complete: false, operationId }
  }
  const finalized = z.object({ ok: z.literal(true), deleted: z.literal(true) }).safeParse(
    await checked(client.rpc('finalize_repolight_assignment_delete_v1', { p_actor_id: input.actorId, p_operation_id: operationId, p_assignment_id: input.assignmentId })),
  )
  if (!finalized.success) throw new ApiError(503, 'Assignment deletion outcome could not be verified')
  return { complete: true, operationId }
}

/** Deleted assignments can only replay a receipt bound to this exact target. */
export async function replayCompletedAssignmentDeletion(actorId: string, assignmentId: string, operationId: string) {
  const response = await getServiceRoleClient().rpc('finalize_repolight_assignment_delete_v1', {
    p_actor_id: actorId, p_assignment_id: assignmentId, p_operation_id: operationId,
  })
  return !response.error && z.object({ ok: z.literal(true), deleted: z.literal(true), replayed: z.literal(true) }).safeParse(response.data).success
}

export async function readAssignmentDeleteOperation(request: Request): Promise<string | undefined> {
  const reader = request.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > 4096) { await reader.cancel(); throw new ApiError(413, 'Deletion request is too large') }
      chunks.push(next.value)
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    if (!text.trim()) return undefined
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new ApiError(400, 'Invalid deletion request') }
    const parsed = assignmentDeleteCleanupRequestSchema.safeParse(value)
    if (!parsed.success) throw new ApiError(400, 'Invalid deletion operation')
    return parsed.data.operationId
  } finally { reader.releaseLock() }
}
