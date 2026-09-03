import { z } from 'zod'

const scopeSchema = z.object({ teacherId: z.string().uuid(), classroomId: z.string().uuid() })

/** Additional rollout restriction; never replaces ownership, enrollment or Bara access checks. */
export function isClassroomQrRolloutAllowed(
  scope: { teacherId: string; classroomId: string },
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const parsed = scopeSchema.safeParse(scope)
  if (!parsed.success) return false
  if (environment.PIKA_CLASSROOM_QR_MODE === 'enabled') return true
  if (environment.PIKA_CLASSROOM_QR_MODE !== 'canary') return false
  const canary = scopeSchema.safeParse({
    teacherId: environment.PIKA_CLASSROOM_QR_CANARY_TEACHER_ID,
    classroomId: environment.PIKA_CLASSROOM_QR_CANARY_CLASSROOM_ID,
  })
  return canary.success
    && parsed.data.teacherId === canary.data.teacherId
    && parsed.data.classroomId === canary.data.classroomId
}
