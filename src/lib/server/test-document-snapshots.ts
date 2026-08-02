import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-handler'
import { fetchSafeExternalDocument } from '@/lib/server/safe-external-document'
import {
  adoptManagedStorageUpload,
  queueManagedStorageCleanup,
  queueManagedStorageCleanupPath,
  reserveManagedStorageUpload,
} from '@/lib/server/managed-storage'
import {
  normalizeSnapshotContentType,
  normalizeTestDocuments,
  isSupportedLinkSnapshotContentType,
  sanitizeSnapshotHtml,
  TEST_DOCUMENT_MAX_SIZE,
} from '@/lib/test-documents'
import type { TestDocument } from '@/types'
import type { TestAccessRecord } from '@/lib/server/tests'

const TEST_DOCUMENTS_BUCKET = 'test-documents'

function buildSnapshotStoragePath(
  classroomId: string,
  testId: string,
  docId: string,
  objectId: string,
): string {
  return `classrooms/${classroomId}/tests/${testId}/documents/${docId}/snapshots/${objectId}`
}

export function findTestDocument(test: Pick<TestAccessRecord, 'documents'>, docId: string): TestDocument | null {
  return normalizeTestDocuments(test.documents).find((doc) => doc.id === docId) ?? null
}

export async function syncExternalLinkTestDocument(options: {
  teacherId: string
  classroomId: string
  testId: string
  doc: TestDocument
}) {
  const { teacherId, classroomId, testId, doc } = options
  if (doc.source !== 'link' || !doc.url) {
    throw new ApiError(400, 'Only link documents can be synced')
  }

  const response = await fetchSafeExternalDocument(doc.url, TEST_DOCUMENT_MAX_SIZE)
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(400, `Source returned ${response.status}`)
  }

  const contentType = normalizeSnapshotContentType(response.headers.get('content-type'))
  if (!isSupportedLinkSnapshotContentType(contentType)) {
    throw new ApiError(400, 'Unsupported document type')
  }

  let body = response.body

  if (contentType === 'text/html') {
    const html = body.toString('utf8')
    body = Buffer.from(sanitizeSnapshotHtml(html, response.finalUrl), 'utf8')
  }

  const supabase = getServiceRoleClient()
  const managedObjectId = randomUUID()
  const snapshotPath = buildSnapshotStoragePath(
    classroomId,
    testId,
    doc.id,
    managedObjectId,
  )
  await reserveManagedStorageUpload({
    supabase,
    objectId: managedObjectId,
    bucket: TEST_DOCUMENTS_BUCKET,
    path: snapshotPath,
    classroomId,
    purpose: 'test_execution_snapshot',
    createdByUserId: teacherId,
    resourceType: 'test',
    resourceId: testId,
    contentType,
    byteSize: body.byteLength,
  })

  const { error: uploadError } = await supabase.storage
    .from(TEST_DOCUMENTS_BUCKET)
    .upload(snapshotPath, body, {
      contentType,
      upsert: false,
    })

  if (uploadError) {
    await queueManagedStorageCleanup({
      supabase,
      objectId: managedObjectId,
      errorCode: 'test_snapshot_upload_failed',
    })
    const details = `${uploadError.message || ''} ${(uploadError as { details?: string }).details || ''}`.toLowerCase()
    if (details.includes('mime type') || details.includes('not supported')) {
      throw new ApiError(400, 'HTML link snapshots require migration 052 to be applied')
    }
    if (details.includes('bucket') || details.includes('not found')) {
      throw new ApiError(400, 'Test document uploads require migration 042 to be applied')
    }
    throw new ApiError(500, 'Failed to store synced document')
  }

  try {
    await adoptManagedStorageUpload({ supabase, objectId: managedObjectId })
  } catch (error) {
    await queueManagedStorageCleanup({
      supabase,
      objectId: managedObjectId,
      errorCode: 'test_snapshot_adoption_failed',
    })
    throw error
  }

  return {
    snapshot_path: snapshotPath,
    snapshot_managed_object_id: managedObjectId,
    snapshot_content_type: contentType,
    synced_at: new Date().toISOString(),
  }
}

export async function syncAndAdoptExternalLinkTestDocument(options: {
  teacherId: string
  classroomId: string
  testId: string
  doc: TestDocument
}) {
  const snapshot = await syncExternalLinkTestDocument(options)
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc(
    'sync_test_document_snapshot_managed_atomic' as any,
    {
      p_document_id: options.doc.id,
      p_expected_url: options.doc.url,
      p_snapshot_content_type: snapshot.snapshot_content_type,
      p_snapshot_path: snapshot.snapshot_path,
      p_managed_object_id: snapshot.snapshot_managed_object_id,
      p_synced_at: snapshot.synced_at,
      p_teacher_id: options.teacherId,
      p_test_id: options.testId,
    },
  )
  if (error) {
    await queueManagedStorageCleanup({
      supabase,
      objectId: snapshot.snapshot_managed_object_id,
      errorCode: 'test_snapshot_document_conflict',
    })
    const details = `${error.message || ''} ${error.details || ''}`.toLowerCase()
    if (details.includes('document_conflict')) {
      throw new ApiError(409, 'The document changed while it was syncing. Try again.')
    }
    if (details.includes('classroom_archived')) {
      throw new ApiError(403, 'Classroom is archived')
    }
    throw new ApiError(503, 'Failed to save the test document snapshot')
  }
  const atomicResult = data as {
    previous_snapshot_path?: unknown
    previous_snapshot_managed_object_id?: unknown
    test?: Record<string, unknown>
  } | null
  if (!atomicResult?.test) {
    await queueManagedStorageCleanup({
      supabase,
      objectId: snapshot.snapshot_managed_object_id,
      errorCode: 'test_snapshot_adoption_result_missing',
    })
    throw new ApiError(503, 'Failed to save the test document snapshot')
  }
  return {
    snapshot,
    previousSnapshotPath: atomicResult.previous_snapshot_path,
    previousManagedObjectId: atomicResult.previous_snapshot_managed_object_id,
    test: atomicResult.test,
  }
}

export async function removeTestDocumentSnapshot(snapshotPath: string): Promise<void> {
  const supabase = getServiceRoleClient()
  const queued = await queueManagedStorageCleanupPath({
    supabase,
    bucket: TEST_DOCUMENTS_BUCKET,
    path: snapshotPath,
    errorCode: 'test_snapshot_removed',
  })
  if (!queued) throw new ApiError(409, 'Synced document is still in use')
}

export async function buildSnapshotResponse(doc: TestDocument): Promise<NextResponse> {
  if (!doc.snapshot_path) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.storage
    .from(TEST_DOCUMENTS_BUCKET)
    .download(doc.snapshot_path)

  if (error || !data) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  const contentType = normalizeSnapshotContentType(doc.snapshot_content_type) || 'application/octet-stream'
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
    'Content-Type': contentType,
    'X-Frame-Options': 'SAMEORIGIN',
  })

  if (contentType === 'text/html') {
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; base-uri 'self'; script-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; img-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:; media-src * blob: data:"
    )
  }

  if (typeof (data as Blob).arrayBuffer === 'function') {
    return new NextResponse(await (data as Blob).arrayBuffer(), { headers })
  }

  if (typeof (data as Blob).stream === 'function') {
    return new NextResponse((data as Blob).stream(), { headers })
  }

  if (typeof (data as Blob).text === 'function') {
    return new NextResponse(await (data as Blob).text(), { headers })
  }

  return new NextResponse(data as BodyInit, { headers })
}
