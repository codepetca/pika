import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireAuth } from '@/lib/auth'
import {
  assertStudentCanAccessClassroom,
  assertTeacherOwnsClassroom,
} from '@/lib/server/classrooms'
import { getClassroomCourseGuide } from '@/lib/server/course-guide'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetClassroomCourseGuide', async (_request, context) => {
  const user = await requireAuth()
  const { classroomId } = await context.params

  if (!classroomId) {
    return NextResponse.json({ error: 'classroomId is required' }, { status: 400 })
  }

  if (user.role === 'teacher') {
    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }
  } else if (user.role === 'student') {
    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    if (!access.classroom.feature_visibility.syllabus) {
      return NextResponse.json({ error: 'Course guide is not available' }, { status: 403 })
    }
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await getClassroomCourseGuide(classroomId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ guide: result.guide })
})
