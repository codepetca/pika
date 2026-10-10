import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { buildSnapshotResponse, findTestDocument } from '@/lib/server/test-document-snapshots'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeSharedTestDetailReadActor } from '@/lib/server/contextual-test-detail-read'
import { readContextualTestOwnerDocument } from '@/lib/server/contextual-test-owner-materials'
import { resolveContextualTestOwnerParams } from '@/lib/validations/contextual-test-owner-workflow'
import { contextualTestOwnerDocumentQuerySchema, TEST_OWNER_WORKFLOW_DEADLINE_MS } from '@/lib/validations/contextual-test-owner-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherTestDocumentSnapshot', async (_request, context) => {
  const shared = await authorizeSharedTestDetailReadActor()
  if (shared.mode === 'shared') {
    const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
    const { id, docId } = await resolveContextualTestOwnerParams(_request, context.params, deadline)
    const query = contextualTestOwnerDocumentQuerySchema.parse({ testId: id, documentId: docId })
    return readContextualTestOwnerDocument({ supabase: getServiceRoleClient(), actorId: shared.user.id, ...query, source: 'link', deadline, signal: _request.signal })
  }
  const user = await requireRole('teacher')
  const { id: testId, docId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const doc = findTestDocument(access.test, docId)
  if (!doc || doc.source !== 'link' || !doc.snapshot_path) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  return buildSnapshotResponse(doc)
})
