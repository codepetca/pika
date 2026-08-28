import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Question authoring is document-based. Keeping a second row-based write path
// would allow test_questions to diverge from the version-fenced draft that
// activation treats as authoritative.
export const POST = withErrorHandler('CreateTeacherTestQuestion', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  return NextResponse.json(
    {
      error: 'Direct question writes are retired; save the versioned Test draft instead',
      draft_endpoint: `/api/teacher/tests/${testId}/draft`,
    },
    { status: 410 },
  )
})
