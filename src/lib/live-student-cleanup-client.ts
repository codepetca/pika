import { z } from 'zod'
import { fetchJSONWithCache } from '@/lib/request-cache'
import { liveCleanupStatusSchema, type LiveCleanupTarget } from '@/lib/validations/live-student-cleanup'

const savedSchema = z.object({ operation_id: z.string().uuid(), policy: z.literal('pika-live-v1') }).strict()
export function cleanupKey(classroomId: string, target: LiveCleanupTarget) {
  return `pika-live-cleanup:${classroomId}:${target.student_id}:${target.generation_id}`
}
export function savedCleanup(key: string) {
  const raw = sessionStorage.getItem(key)
  if (!raw) return null
  return savedSchema.parse(JSON.parse(raw))
}
export function saveCleanup(key: string, operationId: string) {
  // Persist before mutation. Storage failure must prevent a destructive request.
  sessionStorage.setItem(key, JSON.stringify({ operation_id: operationId, policy: 'pika-live-v1' }))
}
export function parseCleanupStatus(raw: unknown, operationId: string) {
  const status = liveCleanupStatusSchema.parse(raw)
  if (status.operation_id !== operationId) throw new Error('Cleanup identity could not be verified.')
  return status
}
export class CleanupRequestError extends Error {
  constructor(readonly status: number) {
    super(status === 404 ? 'Cleanup is paused or unavailable. Saved progress can still be checked.'
      : status === 403 || status === 409 ? 'This membership cannot be cleaned up here. Refresh its status.'
        : 'The request could not be verified. Check saved progress before continuing.')
  }
}
export async function cleanupRequest(path: string, body?: unknown): Promise<unknown> {
  const perform = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 65_000)
    try {
      const response = await fetch(path, { cache: 'no-store', signal: controller.signal,
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      if (!response.ok) throw new CleanupRequestError(response.status)
      return await response.json() as unknown
    } finally { clearTimeout(timer) }
  }
  return body ? perform() : fetchJSONWithCache(`live-cleanup:${path}`, perform, 0)
}

// Prevent overlapping requests across dialog instances in this page, including reopen.
const working = new Set<string>()
export async function withCleanupLock<T>(key: string, action: () => Promise<T>) {
  if (working.has(key)) throw new Error('A cleanup request is still returning. Check progress shortly.')
  working.add(key)
  try { return await action() } finally { working.delete(key) }
}

/** Only opaque local recovery keys; never reconstruct erased public student metadata. */
export function recoverCleanupTargets(classroomId: string): LiveCleanupTarget[] {
  const prefix = `pika-live-cleanup:${classroomId}:`
  const targets: LiveCleanupTarget[] = []
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const [studentId, generationId, extra] = key.slice(prefix.length).split(':')
      if (extra || !z.string().uuid().safeParse(studentId).success || !z.string().uuid().safeParse(generationId).success) continue
      if (savedCleanup(key)) targets.push({ student_id: studentId, generation_id: generationId,
        email: '', name: 'Saved cleanup' })
    }
  } catch { return [] }
  return targets
}
