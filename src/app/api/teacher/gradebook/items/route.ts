import { authorizeSharedGradebookActor, mutateContextualGradebookItem } from '@/lib/server/contextual-gradebook'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { gradebookItemMutationSchema } from '@/lib/validations/gradebook-items'
import { mutateTeacherGradebookItem } from '@/lib/server/gradebook-items'

export const POST = withErrorHandler('MutateGradebookItem', async (request) => {
  const access = await authorizeSharedGradebookActor()
  const teacher = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const command = gradebookItemMutationSchema.parse(await request.json())
  return NextResponse.json((access.mode === 'shared' ? await mutateContextualGradebookItem(teacher.id, command, request.signal) : await mutateTeacherGradebookItem(teacher.id, command)))
})
