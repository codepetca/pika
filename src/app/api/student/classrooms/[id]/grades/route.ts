import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getStudentGrades } from '@/lib/server/student-grades'
import { studentGradesParamsSchema } from '@/lib/validations/student-grades'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentGrades', async (_request, context) => {
  const user = await requireRole('student')
  const { id } = studentGradesParamsSchema.parse(await context.params)
  const grades = await getStudentGrades(user.id, id)
  return NextResponse.json(grades, { headers: { 'Cache-Control': 'private, no-store' } })
})
