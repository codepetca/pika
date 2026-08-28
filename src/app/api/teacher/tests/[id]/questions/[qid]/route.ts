import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Question authoring is document-based. Portable question IDs live in the
// version-fenced draft and are resolved to physical rows only inside the
// atomic draft RPC.
export const PATCH = withErrorHandler('UpdateTeacherTestQuestion', async (_request, context) => {
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

// DELETE /api/teacher/tests/[id]/questions/[qid] - Delete a question
export const DELETE = withErrorHandler('DeleteTeacherTestQuestion', async (_request, context) => {
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
