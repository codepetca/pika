import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeSharedTestDetailReadActor } from '@/lib/server/contextual-test-detail-read'
import { readContextualTestOwnerDocument } from '@/lib/server/contextual-test-owner-materials'
import { resolveContextualTestOwnerParams } from '@/lib/validations/contextual-test-owner-workflow'
import { contextualTestOwnerDocumentQuerySchema, TEST_OWNER_WORKFLOW_DEADLINE_MS } from '@/lib/validations/contextual-test-owner-workflow'
import {
  buildUploadedTestDocumentResponse,
  findTestDocument,
} from '@/lib/server/test-document-snapshots'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherUploadedTestDocument', async (_request, context) => {
  const shared = await authorizeSharedTestDetailReadActor()
  if (shared.mode === 'shared') {
    const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
    const { id, docId } = await resolveContextualTestOwnerParams(_request, context.params, deadline)
    const query = contextualTestOwnerDocumentQuerySchema.parse({ testId: id, documentId: docId })
    return readContextualTestOwnerDocument({ supabase: getServiceRoleClient(), actorId: shared.user.id, ...query, source: 'upload', deadline, signal: _request.signal })
  }
  const user = await requireRole('teacher')
  const { id: testId, docId } = await context.params
  const access = await assertTeacherOwnsTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const doc = findTestDocument(access.test, docId)
  if (!doc || doc.source !== 'upload') {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  return buildUploadedTestDocumentResponse({
    testId,
    classroomId: access.test.classroom_id,
    doc,
  })
})
