import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { createStudentProviderCleanupDatabaseCoordinator } from '@/lib/server/student-provider-cleanup-database'
import { createRemovedStudentAcademicCleanupDatabaseCoordinator } from '@/lib/server/removed-student-academic-cleanup-database'
import { StudentProviderCleanupError, type StudentProviderScope } from '@/lib/server/student-provider-cleanup'

export function requireLiveStudentCleanupEnabled() {
  if (process.env.PIKA_LIVE_STUDENT_CLEANUP_ENABLED !== 'true') throw new ApiError(404, 'Live classroom cleanup is not enabled')
}

/** Bounded explicit progress: both providers get a chance, then at most one file.
 * The existing database owners retain every completion and rejoin decision.
 */
export function createLiveStudentCleanup(dependencies: {
  providers: ReturnType<typeof createStudentProviderCleanupDatabaseCoordinator>
  academic: ReturnType<typeof createRemovedStudentAcademicCleanupDatabaseCoordinator>
}) {
  return {
    read: (scope: StudentProviderScope) => dependencies.providers.read(scope),
    reserve: (scope: StudentProviderScope) => dependencies.providers.reserve(scope),
    async advance(scope: StudentProviderScope) {
      const before = await dependencies.providers.read(scope)
      if (before.cleanup_completed) return { ...before, errors: [] }
      const attempts = await Promise.allSettled([
        dependencies.providers.advance(scope, 'pal'), dependencies.providers.advance(scope, 'bara'),
      ])
      const errors = attempts.flatMap((result, index) => result.status === 'fulfilled' ? [] : [{
        stage: index === 0 ? 'pal' : 'bara',
        retryable: result.reason instanceof StudentProviderCleanupError && result.reason.retryable,
      }])
      const providers = await dependencies.providers.read(scope)
      // Pending and failed receipts never authorize an academic delete or rejoin.
      if (!errors.length && providers.pal === 'completed' && providers.bara === 'deleted') {
        const inventory = await dependencies.academic.inventory(scope)
        if (!inventory.blockers.length) {
          const local = await dependencies.academic.advance(scope)
          if (local.local_status === 'local_completed' && !local.blockers.length)
            return { ...await dependencies.providers.finish(scope), errors }
        }
      }
      return { ...await dependencies.providers.read(scope), errors }
    },
  }
}

export function liveStudentCleanup() {
  requireLiveStudentCleanupEnabled()
  const supabase = getServiceRoleClient()
  return createLiveStudentCleanup({
    providers: createStudentProviderCleanupDatabaseCoordinator(supabase, { live: true }),
    academic: createRemovedStudentAcademicCleanupDatabaseCoordinator(supabase),
  })
}

/** Discovery is read-only, scoped to the current teacher and retained removal. */
export async function getLiveStudentCleanupTarget(teacherId: string, classroomId: string, studentId: string) {
  requireLiveStudentCleanupEnabled()
  const supabase = getServiceRoleClient()
  const classroom = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', teacherId).maybeSingle()
  if (classroom.error) throw new ApiError(503, 'Classroom cleanup is unavailable')
  if (!classroom.data) throw new ApiError(403, 'Classroom cleanup is not permitted')
  const removed = await supabase.from('classroom_roster').select('removed_enrollment_id')
    .eq('classroom_id', classroomId).eq('removed_student_id', studentId).not('removed_at', 'is', null).maybeSingle()
  if (removed.error) throw new ApiError(503, 'Classroom cleanup is unavailable')
  if (!removed.data?.removed_enrollment_id) throw new ApiError(409, 'An exact removed membership is required')
  return { generation_id: removed.data.removed_enrollment_id }
}
