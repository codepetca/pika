import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { saveAssignmentGradesAtomic } from '@/lib/server/assignment-grades'
import { saveAssignmentGradeSchema } from '@/lib/validations/assignment-grading'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade - Save grade for a student
export const POST = withErrorHandler('PostTeacherAssignmentGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const id = assignmentIdSchema.parse((await context.params).id)
  const { studentId, expectedDocUpdatedAt, grade } = saveAssignmentGradeSchema.parse(await request.json())

  const supabase = getServiceRoleClient()
  const docs = await saveAssignmentGradesAtomic({
    supabase,
    assignmentId: id,
    teacherId: user.id,
    studentIds: [studentId],
    expectedDocUpdatedAtByStudent:
      expectedDocUpdatedAt === undefined ? {} : { [studentId]: expectedDocUpdatedAt },
    grade,
  })

  return NextResponse.json({ doc: docs[0] })
})
