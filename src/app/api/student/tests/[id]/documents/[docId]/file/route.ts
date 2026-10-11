import { NextResponse } from 'next/server'
import { handleContextualTestLearnerRequest } from '@/lib/server/contextual-test-learner-workflow'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getStudentTestMaterialAccess } from '@/lib/server/student-test-material-access'
import {
  buildUploadedTestDocumentResponse,
  findTestDocument,
} from '@/lib/server/test-document-snapshots'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentUploadedTestDocument', async (_request, context) => {
  const contextual = await handleContextualTestLearnerRequest('document', _request, context.params, 'upload')
  if (contextual) return contextual
  const user = await requireRole('student')
  const { id: testId, docId } = await context.params
  const access = await getStudentTestMaterialAccess(user.id, testId)
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
