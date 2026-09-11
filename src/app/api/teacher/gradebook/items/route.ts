import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { gradebookItemMutationSchema } from '@/lib/validations/gradebook-items'
import { mutateTeacherGradebookItem } from '@/lib/server/gradebook-items'

export const POST = withErrorHandler('MutateGradebookItem', async (request) => {
  const teacher = await requireRole('teacher')
  const command = gradebookItemMutationSchema.parse(await request.json())
  return NextResponse.json(await mutateTeacherGradebookItem(teacher.id, command))
})
