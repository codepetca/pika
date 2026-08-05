import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { normalizeTestDocuments } from '@/lib/test-documents'
import {
  findTestDocument,
  syncExternalLinkTestDocument,
} from '@/lib/server/test-document-snapshots'
import {
  removeQueuedTestDocumentSnapshotPath,
} from '@/lib/server/test-document-snapshot-storage-cleanup'
import { queueManagedStorageCleanupBestEffort } from '@/lib/server/managed-storage'

export const dynamic = 'force-dynamic'

async function removeSnapshotAfterConflict(
  supabase: ReturnType<typeof getServiceRoleClient>,
  snapshotPath: string,
  managedObjectId?: string,
): Promise<void> {
  try {
    if (managedObjectId) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId: managedObjectId,
        errorCode: 'test_snapshot_attachment_failed',
      })
      return
    }
    await removeQueuedTestDocumentSnapshotPath({ supabase, storagePath: snapshotPath })
  } catch (error) {
    console.error('Failed to remove uncommitted test document snapshot:', error)
  }
}

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
    classroomId: access.test.classroom_id,
    testId,
    doc,
  })

  const supabase = getServiceRoleClient()
  const managedObjectId = 'snapshot_managed_object_id' in snapshot
    ? snapshot.snapshot_managed_object_id
    : undefined
  const { data: result, error } = await supabase.rpc(
    (managedObjectId
      ? 'sync_test_document_snapshot_managed_atomic'
      : 'sync_test_document_snapshot_atomic') as any,
    {
      p_document_id: docId,
      p_expected_url: doc.url,
      p_snapshot_content_type: snapshot.snapshot_content_type,
      p_snapshot_path: snapshot.snapshot_path,
      p_synced_at: snapshot.synced_at,
      p_teacher_id: user.id,
      p_test_id: testId,
      ...(managedObjectId ? { p_managed_object_id: managedObjectId } : {}),
    },
  )

  if (error) {
    await removeSnapshotAfterConflict(supabase, snapshot.snapshot_path, managedObjectId)
    const details = `${error.message || ''} ${error.details || ''}`.toLowerCase()
    if (
      details.includes('document_conflict')
      || details.includes('snapshot_cleanup_in_progress')
      || details.includes('snapshot_cleanup_evidence_missing')
    ) {
      return NextResponse.json(
        { error: 'The document changed while it was syncing. Try again.' },
        { status: 409 },
      )
    }
    if (details.includes('classroom_archived')) {
      return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
    }
    if (details.includes('forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (details.includes('test_not_found')) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }
    if (details.includes('sync_test_document_snapshot_atomic')) {
      return NextResponse.json(
        { error: 'Test document sync requires migrations 109 and 110 to be applied' },
        { status: 503 },
      )
    }
    console.error('Error updating synced test document:', error)
    return NextResponse.json({ error: 'Failed to save synced document' }, { status: 500 })
  }

  const atomicResult = result as {
    previous_snapshot_path?: unknown
    test?: Record<string, unknown>
  } | null
  const test = atomicResult?.test
  if (!test) {
    await removeSnapshotAfterConflict(supabase, snapshot.snapshot_path, managedObjectId)
    return NextResponse.json({ error: 'Failed to save synced document' }, { status: 500 })
  }

  const previousSnapshotPath = atomicResult?.previous_snapshot_path
  if (
    typeof previousSnapshotPath === 'string'
    && previousSnapshotPath
    && previousSnapshotPath !== snapshot.snapshot_path
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
