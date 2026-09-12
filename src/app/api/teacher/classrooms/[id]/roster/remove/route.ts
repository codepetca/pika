import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { classroomStudentRemovalRequestSchema, removeClassroomStudents } from '@/lib/server/classroom-student-removal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('RemoveStudentsFromClassroom', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const classroomId = z.string().uuid().parse(id)
  const input = classroomStudentRemovalRequestSchema.parse(await request.json())
  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  const result = await removeClassroomStudents(user.id, classroomId, input.roster_ids)
  return NextResponse.json({ success: true, ...result })
})
