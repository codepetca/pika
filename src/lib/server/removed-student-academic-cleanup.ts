import { z } from 'zod'
import { deleteStudentPurgeStorageObject } from '@/lib/server/student-purge'
import type { StudentProviderScope } from '@/lib/server/student-provider-cleanup'

const receiptSchema = z.object({
  schema_version: z.literal(1),
  operation_id: z.string().uuid(), teacher_id: z.string().uuid(),
  classroom_id: z.string().uuid(), student_id: z.string().uuid(), generation_id: z.string().uuid(),
  overall_status: z.literal('provider_pending'),
  local_status: z.enum(['inventoried', 'deleting', 'local_completed']),
  revision: z.number().int().positive(),
  relational_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storage_inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  blockers: z.array(z.string().min(1)),
  object: z.object({
    id: z.string().uuid(),
    storage_bucket: z.enum(['assignment-artifacts', 'submission-images']),
    storage_path: z.string().min(1).refine(path => !path.startsWith('/')
      && !path.includes('\\') && !path.split('/').some(part => part === '.' || part === '..')),
    lease_token: z.string().uuid(),
  }).strict().nullable(),
}).strict()

export type AcademicCleanupCommand = {
  action: 'inventory' | 'claim' | 'acknowledge' | 'fail'
  revision?: number
  objectId?: string
  leaseToken?: string
}

/** Explicit server-only orchestration. No route, removal hook or worker invokes it.
 * The database owns scope, inventory, leases, absence and completion authority.
 */
export function createRemovedStudentAcademicCleanup(dependencies: {
  execute(scope: StudentProviderScope, command: AcademicCleanupCommand): Promise<unknown>
  storage: Parameters<typeof deleteStudentPurgeStorageObject>[0]
  enabled?: () => boolean
}) {
  const enabled = dependencies.enabled ?? (() => process.env.PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED === 'true')
  async function execute(scope: StudentProviderScope, command: AcademicCleanupCommand) {
    if (!enabled()) throw new Error('academic_cleanup_disabled')
    const result = receiptSchema.parse(await dependencies.execute(scope, command))
    if (result.operation_id !== scope.operationId || result.teacher_id !== scope.teacherId
      || result.classroom_id !== scope.classroomId || result.student_id !== scope.studentId
      || result.generation_id !== scope.generationId) throw new Error('academic_cleanup_binding_invalid')
    return result
  }
  return {
    inventory: (scope: StudentProviderScope) => execute(scope, { action: 'inventory' }),
    async advance(scope: StudentProviderScope) {
      const claim = await execute(scope, { action: 'claim' })
      if (claim.blockers.length || !claim.object) return claim
      if (claim.local_status !== 'deleting') throw new Error('academic_cleanup_claim_invalid')
      const object = claim.object
      const callback = { revision: claim.revision, objectId: object.id, leaseToken: object.lease_token }
      try {
        await deleteStudentPurgeStorageObject(dependencies.storage, object.storage_bucket, object.storage_path)
      } catch {
        return execute(scope, { action: 'fail', ...callback })
      }
      // A lost callback response must be retried using durable SQL lease state.
      // Never reinterpret it as a failed physical delete or as local completion.
      return execute(scope, { action: 'acknowledge', ...callback })
    },
  }
}
