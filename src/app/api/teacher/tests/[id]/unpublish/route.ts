import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { returnTestToDraft } from '@/lib/server/test-unpublication'
import { testUnpublicationBodySchema, testUnpublicationParamsSchema } from '@/lib/validations/test-unpublication'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('ReturnTestToDraft', async (request, context) => {
  const actor = await requireRole('teacher')
  const { id } = testUnpublicationParamsSchema.parse(await context.params)
  const access = await assertTeacherOwnsTest(actor.id, id, { checkArchived: true })
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  testUnpublicationBodySchema.parse(await request.json())
  return NextResponse.json(await returnTestToDraft(actor.id, id, access.test.classroom_id))
})
