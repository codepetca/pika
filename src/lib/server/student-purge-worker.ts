import { advanceStudentPurge } from '@/lib/server/student-purge'

/**
 * Advances an already-authorized, durable operation after the response. Database
 * leases arbitrate concurrent browser/cron workers. This is a bounded head start,
 * not a queue: the existing cleanup cron owns recovery if the process is killed.
 * The elapsed-time check bounds new work; it cannot interrupt an in-flight RPC.
 */
export async function runStudentPurgeInBackground(teacherId: string, operationId: string) {
  const startedAt = Date.now()
  let ticks = 0
  while (ticks < 25 && Date.now() - startedAt < 20_000) {
    ticks += 1
    try {
      const { operation, advanced } = await advanceStudentPurge(teacherId, operationId)
      if (operation.status === 'completed') return { reason: 'completed' as const, ticks }
      if (operation.status === 'failed') return { reason: 'failed' as const, ticks }
      if (!advanced) return { reason: 'waiting' as const, ticks }
    } catch {
      // Error details can contain identifiers and provider responses. Durable
      // operation health is monitored by cleanup-history; return only a category.
      return { reason: 'failed' as const, ticks }
    }
  }
  return { reason: 'budget' as const, ticks }
}
