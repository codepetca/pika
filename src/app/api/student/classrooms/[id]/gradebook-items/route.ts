import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getStudentReturnedGradebookItems } from '@/lib/server/gradebook-student-items'
import { studentGradebookItemsParamsSchema } from '@/lib/validations/gradebook-student-items'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentReturnedGradebookItems', async (_request, context) => {
  const user = await requireRole('student')
  const { id } = studentGradebookItemsParamsSchema.parse(await context.params)
  const items = await getStudentReturnedGradebookItems(user.id, id)
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } })
})
