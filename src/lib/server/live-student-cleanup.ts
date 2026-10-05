import { discoverRetainedStudentCleanupGroups } from '@/lib/server/retained-student-cleanup-discovery'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { createStudentProviderCleanupDatabaseCoordinator } from '@/lib/server/student-provider-cleanup-database'
import { createRemovedStudentAcademicCleanupDatabaseCoordinator } from '@/lib/server/removed-student-academic-cleanup-database'
import { StudentProviderCleanupError, type StudentProviderScope } from '@/lib/server/student-provider-cleanup'

export function requireLiveStudentCleanupEnabled() {
  if (!isLiveStudentCleanupEnabled()) throw new ApiError(404, 'Live classroom cleanup is not enabled')
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
      if (errors.some(error => !error.retryable))
        throw new StudentProviderCleanupError('terminal_failure')
      const providers = await dependencies.providers.read(scope)
      // Pending and failed receipts never authorize an academic delete or rejoin.
      if (!errors.length && providers.pal === 'completed' && providers.bara === 'deleted') {
        const inventory = await dependencies.academic.inventory(scope)
        if (inventory.blockers.some(blocker => ![
          'provider_completion_required', 'managed_storage_enforcement_required', 'live_copy_work_pending',
        ].includes(blocker))) throw new StudentProviderCleanupError('terminal_failure')
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
  const coordinator = createLiveStudentCleanup({
    providers: createStudentProviderCleanupDatabaseCoordinator(supabase, { live: true }),
    academic: createRemovedStudentAcademicCleanupDatabaseCoordinator(supabase),
  })
  return {
    reserve: (scope: StudentProviderScope) => {
      requireLiveStudentCleanupEnabled()
      return publicLiveCleanupResult(() => coordinator.reserve(scope))
    },
    advance: (scope: StudentProviderScope) => {
      requireLiveStudentCleanupEnabled()
      return publicLiveCleanupResult(() => coordinator.advance(scope))
    },
  }
}

async function publicLiveCleanupResult<T>(work: () => Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    if (error instanceof StudentProviderCleanupError) {
      if (error.code === 'binding_invalid') throw new ApiError(409,
        'This operation does not match the live membership policy. It cannot be continued here.')
      if (error.code === 'terminal_failure') throw new ApiError(409,
        'This cleanup requires operator investigation before it can continue.')
      if (error.code === 'disabled') throw new ApiError(404, 'Live classroom cleanup is not enabled')
      throw new ApiError(503, 'Classroom cleanup is unavailable')
    }
    throw error
  }
}

/** Discovery is read-only, scoped to the current teacher and retained removal. */
export async function getLiveStudentCleanupTarget(teacherId: string, classroomId: string, studentId: string) {
  const targets = await discoverRetainedStudentCleanupGroups(teacherId, classroomId, isLiveStudentCleanupEnabled(), studentId)
  const target = targets[0]
  if (!target) throw new ApiError(409, 'An exact removed membership is required')
  const generationId = target.generation_id
  // Existing operations are verified by the immutable binding, including policy.
  const operation = target.operation_id ? await readLiveStudentCleanup({ teacherId, classroomId, studentId,
    generationId, operationId: target.operation_id }) : null
  if (!operation) requireLiveStudentCleanupEnabled()
  return { generation_id: generationId, operation, enabled: isLiveStudentCleanupEnabled() }
}

/** Pausing activation must not hide durable evidence or progress a provider. */
export function readLiveStudentCleanup(scope: StudentProviderScope) {
  return publicLiveCleanupResult(() => createStudentProviderCleanupDatabaseCoordinator(undefined, { live: true }).read(scope))
}

export function isLiveStudentCleanupEnabled() {
  return process.env.PIKA_LIVE_STUDENT_CLEANUP_ENABLED === 'true'
    && process.env.STUDENT_PROVIDER_CLEANUP_ENABLED === 'true'
    && process.env.PAL_PROFILE_ERASURE_ENABLED === 'true'
    && process.env.PIKA_BARA_PARTICIPANT_ERASURE_ENABLED === 'true'
    && process.env.PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED === 'true'
}

/** Teacher-only selector projection. Completed operations never repopulate identity. */
export async function listLiveStudentCleanupTargets(teacherId: string, classroomId: string) {
  const groups = await discoverRetainedStudentCleanupGroups(teacherId, classroomId, isLiveStudentCleanupEnabled())
  return groups.map(group => ({ student_id: group.student_id, generation_id: group.generation_id,
    email: group.email, name: group.name }))
}
