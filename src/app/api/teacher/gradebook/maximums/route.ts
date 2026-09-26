import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { saveGradebookMaximum } from '@/lib/server/gradebook-maximum'
import { gradebookMaximumPutSchema } from '@/lib/validations/gradebook-maximum'

export const PUT = withErrorHandler('PutGradebookMaximum', async (request: NextRequest) => {
  const teacher = await requireRole('teacher')
  const command = gradebookMaximumPutSchema.parse(await request.json())
  return NextResponse.json(await saveGradebookMaximum(teacher.id, command))
})
