import { authorizeSharedGradebookActor, scoreContextualGradebookItem } from '@/lib/server/contextual-gradebook'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { gradebookItemScoreSchema } from '@/lib/validations/gradebook-items'
import { setTeacherGradebookItemScore } from '@/lib/server/gradebook-items'

export const PUT = withErrorHandler('SetGradebookItemScore', async (request) => {
  const access = await authorizeSharedGradebookActor()
  const teacher = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const command = gradebookItemScoreSchema.parse(await request.json())
  return NextResponse.json((access.mode === 'shared' ? await scoreContextualGradebookItem(teacher.id, command, request.signal) : await setTeacherGradebookItemScore(teacher.id, command)))
})
