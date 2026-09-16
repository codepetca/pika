import { getServiceRoleClient } from '@/lib/supabase'
import {
  createStudentProviderCleanupCoordinator, StudentProviderCleanupError,
  type StudentProviderScope,
} from '@/lib/server/student-provider-cleanup'

function args(scope: StudentProviderScope) {
  return { p_operation_id: scope.operationId, p_teacher_id: scope.teacherId,
    p_classroom_id: scope.classroomId, p_student_id: scope.studentId, p_generation_id: scope.generationId }
}

async function result(request: PromiseLike<{
  data: unknown; error: { code?: string; message?: string } | null
}>) {
  const response = await request
  if (response.error) {
    if (response.error.code === '55000' && [
      'student_provider_cleanup_disabled', 'student_live_cleanup_disabled',
      'student_live_cleanup_prerequisite_paused',
    ].includes(response.error.message ?? ''))
      throw new StudentProviderCleanupError('disabled', true)
    if (response.error.code === '55000' && [
      'student_provider_operation_conflict', 'student_provider_copy_policy_required',
    ].includes(response.error.message ?? ''))
      throw new StudentProviderCleanupError('persistence_unavailable', true)
    if (['42501', '22023', '55000'].includes(response.error.code ?? ''))
      throw new StudentProviderCleanupError('binding_invalid')
    throw new StudentProviderCleanupError('persistence_unavailable', true)
  }
  return response.data
}

/** Service-only entry point; no route, scheduler or removal hook invokes it. */
export function createStudentProviderCleanupDatabaseCoordinator(
  supabase: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'> = getServiceRoleClient(),
  options: { live?: boolean } = {},
) {
  return createStudentProviderCleanupCoordinator({
    liveOnly: options.live,
    reserve: scope => options.live
      ? result(supabase.rpc('advance_removed_student_academic_cleanup', { ...args(scope), p_action: 'live_reserve' }))
      : result(supabase.rpc('reserve_student_provider_cleanup', args(scope))),
    ...(options.live ? { finish: (scope: StudentProviderScope) => result(supabase.rpc('advance_removed_student_academic_cleanup',
      { ...args(scope), p_action: 'live_complete' })) } : {}),
    read: scope => result(supabase.rpc('get_student_provider_cleanup', args(scope))),
    authorize: scope => result(supabase.rpc('authorize_student_provider_cleanup', args(scope))),
    record: (scope, provider, receipt) => result(supabase.rpc('record_student_provider_cleanup_receipt', {
      ...args(scope), p_provider: provider, p_receipt: { ...receipt },
    })),
  })
}
