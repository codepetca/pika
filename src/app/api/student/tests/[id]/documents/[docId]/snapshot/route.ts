import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { buildSnapshotResponse, findTestDocument } from '@/lib/server/test-document-snapshots'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentTestDocumentSnapshot', async (_request, context) => {
  const user = await requireRole('student')
  const { id: testId, docId } = await context.params

  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const doc = findTestDocument(access.test, docId)
  if (!doc || doc.source !== 'link' || !doc.snapshot_path) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  return buildSnapshotResponse(doc)
})
