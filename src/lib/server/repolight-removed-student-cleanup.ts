import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { advanceReservedRepoLightCleanup } from '@/lib/server/repolight-decommission-database'
import type { StudentProviderScope } from '@/lib/server/student-provider-cleanup'

export const repoLightRemovedContextSchema = z.object({
  schema_version: z.literal(1), classroom_id: z.string().uuid(), student_id: z.string().uuid(), generation_id: z.string().uuid(),
  scope: z.literal('repolight_only'), provider_bound: z.boolean(), other_providers: z.literal('out_of_scope'),
  operation_id: z.string().uuid().nullable(), status: z.enum(['not_reserved', 'cleanup_pending', 'completed']),
  pending_subject_count: z.number().int().nonnegative(), total_subject_count: z.number().int().nonnegative(),
  academic_preserved: z.literal(true), email: z.string(), name: z.string(),
}).refine(row => row.pending_subject_count <= row.total_subject_count
  && (row.status === 'not_reserved') === (row.operation_id === null)
  && (row.status !== 'completed' || row.pending_subject_count === 0))

type Client = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>
async function checked(response: PromiseLike<{ data: unknown; error: { code?: string } | null }>) {
  const result = await response
  if (result.error) throw new ApiError(result.error.code === '42501' ? 403 : ['22023', '55000', '40001'].includes(result.error.code ?? '') ? 409 : 503,
    'Repository report cleanup could not be verified. Check the saved operation before retrying.')
  return result.data
}
export async function getRepoLightRemovedContext(scope: Omit<StudentProviderScope, 'operationId' | 'generationId'> & { generationId?: string }, client: Client = getServiceRoleClient()) {
  const row = repoLightRemovedContextSchema.parse(await checked(client.rpc('get_repolight_removed_student_cleanup_context_v1', {
    p_actor_id: scope.teacherId, p_classroom_id: scope.classroomId, p_student_id: scope.studentId,
    ...(scope.generationId ? { p_generation_id: scope.generationId } : {}),
  })))
  if (row.classroom_id !== scope.classroomId || row.student_id !== scope.studentId || (scope.generationId && row.generation_id !== scope.generationId))
    throw new ApiError(409, 'The retained membership changed')
  return row
}
export function projectRepoLightRemovedStatus(row: z.infer<typeof repoLightRemovedContextSchema>) {
  if (!row.operation_id || row.status === 'not_reserved') throw new ApiError(409, 'A confirmed repository report cleanup is required')
  return { operation_id: row.operation_id, scope: 'repolight_only' as const, academic_preserved: true as const,
    status: row.status === 'completed' ? 'completed' as const : 'provider_pending' as const,
    pal: 'out_of_scope' as const, bara: 'out_of_scope' as const,
    local_status: 'not_started' as const, cleanup_completed: row.status === 'completed',
    repolight_cleanup_pending: row.status !== 'completed', blockers: [] }
}
export async function reserveRepoLightRemovedCleanup(scope: StudentProviderScope, client: Client = getServiceRoleClient()) {
  const context = await getRepoLightRemovedContext(scope, client)
  if (context.operation_id && context.operation_id !== scope.operationId) throw new ApiError(409, 'Check the existing saved cleanup operation before retrying')
  const reserved = z.object({ operation_id: z.string().uuid(), kind: z.literal('removed_student'),
    status: z.enum(['cleanup_pending', 'completed']), pending_subject_count: z.number().int().nonnegative() }).parse(
    await checked(client.rpc('reserve_repolight_removed_student_cleanup_v1', {
      p_actor_id: scope.teacherId, p_classroom_id: scope.classroomId, p_student_id: scope.studentId,
      p_generation_id: scope.generationId, p_operation_id: context.operation_id ?? scope.operationId,
    })),
  )
  if (reserved.operation_id !== (context.operation_id ?? scope.operationId)) throw new ApiError(409, 'Cleanup operation changed')
  return projectRepoLightRemovedStatus({ ...context, operation_id: reserved.operation_id,
    status: reserved.status, pending_subject_count: reserved.pending_subject_count })
}
export async function advanceRepoLightRemovedCleanup(scope: StudentProviderScope) {
  const context = await getRepoLightRemovedContext(scope)
  if (context.operation_id !== scope.operationId) throw new ApiError(409, 'Cleanup operation does not match this membership')
  if (context.status !== 'completed') await advanceReservedRepoLightCleanup(scope.teacherId, scope.operationId, 'decommission')
  return projectRepoLightRemovedStatus(await getRepoLightRemovedContext(scope))
}

export async function readRepoLightRemovedTargetsPage(teacherId: string, classroomId: string, cursor: string | null = null) {
  const client = getServiceRoleClient()
  const page = z.object({ schema_version: z.literal(1), teacher_id: z.string().uuid(), classroom_id: z.string().uuid(),
      after_student_id: z.string().uuid().nullable(), targets: repoLightRemovedContextSchema.array().max(100),
      target_count: z.number().int().nonnegative().max(100), next_student_id: z.string().uuid().nullable() }).parse(
      await checked(client.rpc('discover_repolight_removed_student_cleanup_groups_v1', {
        p_actor_id: teacherId, p_classroom_id: classroomId, ...(cursor ? { p_after_student_id: cursor } : {}),
      })),
    )
  if (page.teacher_id !== teacherId || page.classroom_id !== classroomId || page.after_student_id !== cursor
      || page.target_count !== page.targets.length || page.targets.some(row => row.classroom_id !== classroomId)
      || page.targets.some((row, i) => row.student_id <= (i ? page.targets[i-1].student_id : cursor ?? ''))
      || (page.next_student_id !== null && (page.targets.length !== 100 || page.next_student_id !== page.targets.at(-1)?.student_id)))
      throw new ApiError(503, 'Repository report cleanup discovery could not be verified')
  return page
}
