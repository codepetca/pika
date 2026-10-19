import { authorizeSharedGradebookActor, maximumContextualGradebook } from '@/lib/server/contextual-gradebook'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { saveGradebookMaximum } from '@/lib/server/gradebook-maximum'
import { gradebookMaximumPutSchema } from '@/lib/validations/gradebook-maximum'

export const PUT = withErrorHandler('PutGradebookMaximum', async (request: NextRequest) => {
  const access = await authorizeSharedGradebookActor()
  const teacher = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const command = gradebookMaximumPutSchema.parse(await request.json())
  return NextResponse.json((access.mode === 'shared' ? await maximumContextualGradebook(teacher.id, command, request.signal) : await saveGradebookMaximum(teacher.id, command)))
})
