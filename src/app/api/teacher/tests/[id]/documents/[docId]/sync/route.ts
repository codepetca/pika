import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { normalizeTestDocuments } from '@/lib/test-documents'
import {
  findTestDocument,
  syncAndAdoptExternalLinkTestDocument,
} from '@/lib/server/test-document-snapshots'
import {
  removeQueuedTestDocumentSnapshotPath,
} from '@/lib/server/test-document-snapshot-storage-cleanup'

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

  const synchronized = await syncAndAdoptExternalLinkTestDocument({
    teacherId: user.id,
    classroomId: access.test.classroom_id,
    testId,
    doc,
  })

  const supabase = getServiceRoleClient()
  const test = synchronized.test
  const previousSnapshotPath = synchronized.previousSnapshotPath
  const previousManagedObjectId = synchronized.previousManagedObjectId
  if (
    typeof previousManagedObjectId !== 'string'
    &&
    typeof previousSnapshotPath === 'string'
    && previousSnapshotPath
    && previousSnapshotPath !== synchronized.snapshot.snapshot_path
  ) {
    try {
      await removeQueuedTestDocumentSnapshotPath({
        supabase,
        storagePath: previousSnapshotPath,
      })
    } catch (cleanupError) {
      console.error('Failed to remove superseded test document snapshot:', cleanupError)
    }
  }
  const syncedDoc = normalizeTestDocuments((test as { documents?: unknown }).documents).find(
    (currentDoc) => currentDoc.id === docId
  )

  const responseTest = {
    ...test,
    documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
    assessment_type: 'test',
  }

  return NextResponse.json({
    doc: syncedDoc,
    test: responseTest,
  })
})
