import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { clearTestDocumentSnapshot, normalizeTestDocuments } from '@/lib/test-documents'
import { findTestDocument, syncExternalLinkTestDocument } from '@/lib/server/test-document-snapshots'

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler('SyncTeacherTestDocument', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, docId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const doc = findTestDocument(access.test, docId)
  if (!doc || doc.source !== 'link' || !doc.url) {
    return NextResponse.json({ error: 'Link document not found' }, { status: 404 })
  }

  const snapshot = await syncExternalLinkTestDocument({
    teacherId: user.id,
    testId,
    doc,
  })

  const nextDocuments = normalizeTestDocuments(access.test.documents).map((currentDoc) => {
    if (currentDoc.id !== docId) return currentDoc
    return {
      ...clearTestDocumentSnapshot(currentDoc),
      ...snapshot,
    }
  })

  const supabase = getServiceRoleClient()
  const { data: test, error } = await supabase
    .from('tests')
    .update({ documents: nextDocuments })
    .eq('id', testId)
    .select()
    .single()

  if (error) {
    console.error('Error updating synced test document:', error)
    return NextResponse.json({ error: 'Failed to save synced document' }, { status: 500 })
  }

  const syncedDoc = normalizeTestDocuments((test as { documents?: unknown }).documents).find(
    (currentDoc) => currentDoc.id === docId
  )

  return NextResponse.json({
    doc: syncedDoc,
    quiz: {
      ...test,
      documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
      assessment_type: 'test',
    },
  })
})
