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
    if (response.error.code === '55000' && response.error.message === 'student_provider_cleanup_disabled')
      throw new StudentProviderCleanupError('disabled')
    if (['42501', '22023', '55000'].includes(response.error.code ?? ''))
      throw new StudentProviderCleanupError('binding_invalid')
    throw new StudentProviderCleanupError('persistence_unavailable', true)
  }
  return response.data
}

/** Service-only entry point; no route, scheduler or removal hook invokes it. */
export function createStudentProviderCleanupDatabaseCoordinator(
  supabase: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'> = getServiceRoleClient(),
) {
  return createStudentProviderCleanupCoordinator({
    reserve: scope => result(supabase.rpc('reserve_student_provider_cleanup', args(scope))),
    read: scope => result(supabase.rpc('get_student_provider_cleanup', args(scope))),
    authorize: scope => result(supabase.rpc('authorize_student_provider_cleanup', args(scope))),
    record: (scope, provider, receipt) => result(supabase.rpc('record_student_provider_cleanup_receipt', {
      ...args(scope), p_provider: provider, p_receipt: { ...receipt },
    })),
  })
}
