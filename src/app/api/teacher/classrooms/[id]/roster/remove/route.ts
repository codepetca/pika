import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { classroomStudentRemovalRequestSchema, removeClassroomStudents } from '@/lib/server/classroom-student-removal'
import { authorizeSharedRosterMutationActor } from '@/lib/server/contextual-roster-mutation'
import { removeContextualRosterStudents } from '@/lib/server/contextual-roster-removal'
import { contextualRosterRemovalBodySchema, contextualRosterRemovalParamsSchema } from '@/lib/validations/contextual-roster-removal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('RemoveStudentsFromClassroom', async (request, context) => {
  const shared = await authorizeSharedRosterMutationActor()
  if (shared.mode === 'shared') {
    const { id } = contextualRosterRemovalParamsSchema.parse(await context.params)
    const input = contextualRosterRemovalBodySchema.parse(await request.json())
    const result = await removeContextualRosterStudents({ actorId: shared.user.id, classroomId: id, rosterIds: input.roster_ids })
    return NextResponse.json(result)
  }
  const user = await requireRole('teacher')
  const { id } = await context.params
  const classroomId = z.string().uuid().parse(id)
  const input = classroomStudentRemovalRequestSchema.parse(await request.json())
  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  const result = await removeClassroomStudents(user.id, classroomId, input.roster_ids)
  return NextResponse.json({ success: true, ...result })
})
