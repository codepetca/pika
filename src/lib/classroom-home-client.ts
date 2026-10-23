import { z } from 'zod'

const visibilityResultSchema = z.object({
  actor_id: z.string().uuid(), classroom_id: z.string().uuid(),
  enrollment_id: z.string().uuid(), hidden: z.boolean(),
}).strict()

export async function setJoinedClassroomHidden(classroomId: string, enrollmentId: string, hidden: boolean): Promise<void> {
  const response = await fetch(`/api/classrooms/home/${encodeURIComponent(classroomId)}/visibility`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId, hidden }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error('Unable to save classroom visibility. Try again.')
  const result = visibilityResultSchema.safeParse(body)
  if (!result.success || result.data.classroom_id !== classroomId
    || result.data.enrollment_id !== enrollmentId || result.data.hidden !== hidden) {
    throw new Error('Unable to verify classroom visibility. Refresh and try again.')
  }
}
