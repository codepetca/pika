import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { loadTeacherGradebook, updateTeacherGradebook } from '@/lib/server/gradebook'
import { gradebookPatchSchema, gradebookQuerySchema } from '@/lib/validations/gradebook'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetGradebook', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const query = gradebookQuerySchema.parse({
    classroom_id: request.nextUrl.searchParams.get('classroom_id') ?? '',
    student_id: request.nextUrl.searchParams.get('student_id'),
  })
  const gradebook = await loadTeacherGradebook({
    teacherId: user.id,
    classroomId: query.classroom_id,
    selectedStudentId: query.student_id,
  })
  return NextResponse.json(gradebook)
})

export const PATCH = withErrorHandler('PatchGradebook', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const command = gradebookPatchSchema.parse(rawBody)
  const result = await updateTeacherGradebook({ teacherId: user.id, command })
  return NextResponse.json(result)
})
