import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { gradebookItemScoreSchema } from '@/lib/validations/gradebook-items'
import { setTeacherGradebookItemScore } from '@/lib/server/gradebook-items'

export const PUT = withErrorHandler('SetGradebookItemScore', async (request) => {
  const teacher = await requireRole('teacher')
  const command = gradebookItemScoreSchema.parse(await request.json())
  return NextResponse.json(await setTeacherGradebookItemScore(teacher.id, command))
})
