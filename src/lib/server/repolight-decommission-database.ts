import { ApiError } from '@/lib/api-error'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { createRepoLightClient } from '@/lib/server/repolight-client'
import { parseRepoLightConfig, resolveRepoLightConnection } from '@/lib/server/repolight-config'
import { createRepoLightDecommission, RepoLightDecommissionError } from '@/lib/server/repolight-decommission'

async function result(request: PromiseLike<{
  data: unknown; error: { code?: string } | null
}>) {
  const response = await request
  if (response.error) {
    if (['42501', '22023'].includes(response.error.code ?? '')) {
      throw new RepoLightDecommissionError('repolight_cleanup_binding_invalid')
    }
    throw new RepoLightDecommissionError('repolight_cleanup_pending', true)
  }
  return response.data
}

/** Explicit service-only cleanup. Call only after the owning lifecycle has
 * validated and reserved the teacher's destructive intent. Reads never call it.
 * A paused Analyze flag does not waive any saved provider subject.
 */
export function createRepoLightDecommissionDatabaseCoordinator(
  supabase: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'> = getServiceRoleClient(),
  options: {
    operation?: { id: string; kind: 'purge' | 'decommission' }
    config?: typeof parseRepoLightConfig
    client?: typeof createRepoLightClient
  } = {},
) {
  return createRepoLightDecommission({
    requireReservedOperation: Boolean(options.operation),
    read: scope => options.operation ? result(options.operation.kind === 'purge'
      ? supabase.rpc('read_repolight_purge_cleanup_subjects_v1', { p_actor_id: scope.teacherId, p_operation_id: options.operation.id })
      : supabase.rpc('read_repolight_decommission_subjects_v1', { p_actor_id: scope.teacherId, p_operation_id: options.operation.id })) : result(supabase.rpc('read_repolight_cleanup_subjects_v1', {
      p_actor_id: scope.teacherId,
      ...(scope.classroomId ? { p_classroom_id: scope.classroomId } : {}),
      ...(scope.studentId ? { p_student_id: scope.studentId } : {}),
      ...(scope.assignmentId ? { p_assignment_id: scope.assignmentId } : {}),
    })),
    reserve: (scope, binding, operationId) => result(supabase.rpc('begin_repolight_subject_erasure_v1', {
      p_actor_id: scope.teacherId, p_binding_id: binding.id, p_operation_id: operationId,
    })),
    erase: (binding, request) => {
      let config: ReturnType<typeof parseRepoLightConfig>, connection: ReturnType<typeof resolveRepoLightConnection>
      try {
        config = (options.config ?? parseRepoLightConfig)()
        connection = resolveRepoLightConnection(config, binding.teacher_id, binding.connection_ref)
      } catch { throw new RepoLightDecommissionError('repolight_cleanup_unavailable', true) }
      if (connection.workspaceRef !== binding.workspace_ref || connection.installationRef !== binding.installation_ref) {
        throw new RepoLightDecommissionError('repolight_cleanup_binding_invalid')
      }
      return (options.client ?? createRepoLightClient)(connection, { apiOrigin: config.apiOrigin! }).eraseSubject(request)
    },
    record: (scope, binding, operationId, receipt) => result(supabase.rpc('record_repolight_subject_erasure_v1', {
      p_actor_id: scope.teacherId, p_binding_id: binding.id, p_operation_id: operationId,
      p_receipt: { ...receipt },
    })),
  })
}

/** Only a durable, actor-bound parent reservation may authorize lifecycle egress. */
export async function advanceReservedRepoLightCleanup(
  teacherId: string, operationId: string, kind: 'purge' | 'decommission' = 'purge',
): Promise<boolean> {
  try {
    const progress = await createRepoLightDecommissionDatabaseCoordinator(undefined, {
      operation: { id: operationId, kind },
    }).advance({ teacherId }, { maxSubjects: 5 })
    return progress.complete
  } catch (error) {
    if (error instanceof RepoLightDecommissionError && error.code === 'repolight_cleanup_unavailable') throw new ApiError(503, 'Repository report cleanup is unavailable. Saved progress is retained.')
    if (error instanceof RepoLightDecommissionError && error.retryable) return false
    throw error
  }
}

/** Read-only policy gate: automatic cleanup cannot expand into a newly linked
 * provider. Failure or malformed scope evidence is never interpreted as absence. */
export async function hasUnresolvedRepoLightSubjects(scope: {
  teacherId: string; classroomId: string; studentId: string
}, client: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'> = getServiceRoleClient()) {
  const rows = z.array(z.object({
    teacher_id: z.string().uuid(), classroom_id: z.string().uuid(), student_id: z.string().uuid(),
    state: z.enum(['active', 'erasing']),
  }).passthrough()).max(10000).parse(await result(client.rpc('read_repolight_cleanup_subjects_v1', {
    p_actor_id: scope.teacherId, p_classroom_id: scope.classroomId, p_student_id: scope.studentId,
  })))
  if (rows.some(row => row.teacher_id !== scope.teacherId || row.classroom_id !== scope.classroomId || row.student_id !== scope.studentId)) {
    throw new RepoLightDecommissionError('repolight_cleanup_binding_invalid')
  }
  return rows.length > 0
}

export class RepoLightManualCleanupRequiredError extends Error {
  constructor() { super('Repository report cleanup requires explicit confirmation'); this.name = 'RepoLightManualCleanupRequiredError' }
}
