import { getServiceRoleClient } from '@/lib/supabase'
import { createRemovedStudentAcademicCleanup } from '@/lib/server/removed-student-academic-cleanup'

/** Explicit service-only entry point. No route, scheduler or removal hook invokes it. */
export function createRemovedStudentAcademicCleanupDatabaseCoordinator(
  supabase: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc' | 'storage'> = getServiceRoleClient(),
) {
  return createRemovedStudentAcademicCleanup({
    storage: supabase.storage,
    async execute(scope, command) {
      const response = await supabase.rpc('advance_removed_student_academic_cleanup', {
        p_operation_id: scope.operationId, p_teacher_id: scope.teacherId,
        p_classroom_id: scope.classroomId, p_student_id: scope.studentId,
        p_generation_id: scope.generationId, p_action: command.action,
        p_revision: command.revision, p_object_id: command.objectId, p_lease_token: command.leaseToken,
      })
      if (response.error) {
        // Database details can contain identifiers; expose only fixed failure categories.
        const code = response.error.code
        if (code === '40001') throw new Error('academic_cleanup_retry_required')
        if (code === '42501' || code === '22023') throw new Error('academic_cleanup_binding_invalid')
        if (code === '55000') throw new Error('academic_cleanup_precondition_failed')
        throw new Error('academic_cleanup_persistence_unavailable')
      }
      return response.data
    },
  })
}
