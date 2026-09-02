import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-handler'
import { fetchSafeExternalDocument } from '@/lib/server/safe-external-document'
import {
  createProvisionalTestDocumentSnapshotCleanup,
} from '@/lib/server/test-document-snapshot-storage-cleanup'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'
import {
  normalizeSnapshotContentType,
  normalizeTestDocuments,
  isSupportedLinkSnapshotContentType,
  sanitizeSnapshotHtml,
  TEST_DOCUMENT_MAX_SIZE,
  getTestDocumentStoragePath,
  isAllowedTestDocumentType,
} from '@/lib/test-documents'
import {
  buildPublicStorageCompatibilityRedirect,
  buildPrivateStorageRedirect,
  getPrivateStorageContentType,
} from '@/lib/server/direct-storage-delivery'
import type { TestDocument } from '@/types'
import type { TestAccessRecord } from '@/lib/server/tests'

const TEST_DOCUMENTS_BUCKET = 'test-documents'

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
  const snapshotPath = `link-docs/${teacherId}/${testId}/${doc.id}/snapshots/${managedObjectId}`
  const reservation = await reserveManagedStorageUpload({
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
    allowLegacyCompatibility: true,
  })
  const cleanup = reservation ? null : await createProvisionalTestDocumentSnapshotCleanup({
    supabase,
    storagePath: snapshotPath,
  })
  if (!reservation && !cleanup) {
    throw new ApiError(
      503,
      'Test document snapshot cleanup requires migration 110 to be applied',
    )
  }

  const { error: uploadError } = await supabase.storage
    .from(TEST_DOCUMENTS_BUCKET)
    .upload(snapshotPath, body, {
      contentType,
      upsert: false,
    })

  if (uploadError) {
    if (reservation) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId: managedObjectId,
        errorCode: 'test_snapshot_upload_failed',
      })
    }
    const details = `${uploadError.message || ''} ${(uploadError as { details?: string }).details || ''}`.toLowerCase()
    if (details.includes('mime type') || details.includes('not supported')) {
      throw new ApiError(400, 'HTML link snapshots require migration 052 to be applied')
    }
    if (details.includes('bucket') || details.includes('not found')) {
      throw new ApiError(400, 'Test document uploads require migration 042 to be applied')
    }
    throw new ApiError(500, 'Failed to store synced document')
  }

  if (reservation) {
    try {
      await verifyManagedStorageUpload({ supabase, objectId: managedObjectId })
    } catch (error) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId: managedObjectId,
        errorCode: 'test_snapshot_verification_failed',
      })
      throw error
    }
  }

  return {
    snapshot_path: snapshotPath,
    ...(reservation ? { snapshot_managed_object_id: managedObjectId } : {}),
    snapshot_content_type: contentType,
    synced_at: new Date().toISOString(),
  }
}

export async function removeTestDocumentSnapshot(snapshotPath: string): Promise<void> {
  const supabase = getServiceRoleClient()
  const { error } = await supabase.storage
    .from(TEST_DOCUMENTS_BUCKET)
    .remove([snapshotPath])

  if (error) {
    throw new ApiError(500, 'Failed to remove synced document')
  }
}

export async function buildSnapshotResponse(doc: TestDocument): Promise<NextResponse> {
  if (!doc.snapshot_path) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  const supabase = getServiceRoleClient()
  const contentType = normalizeSnapshotContentType(doc.snapshot_content_type)
    || await getPrivateStorageContentType({
      supabase,
      bucket: TEST_DOCUMENTS_BUCKET,
      path: doc.snapshot_path,
    })
  if (!contentType || !isSupportedLinkSnapshotContentType(contentType)) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  // Preserve the same-origin CSP wrapper for sanitized HTML. Other snapshot
  // types can safely bypass the application function's response-size limit.
  if (contentType !== 'text/html') {
    return buildPrivateStorageRedirect({
      supabase,
      bucket: TEST_DOCUMENTS_BUCKET,
      path: doc.snapshot_path,
    })
  }

  const { data, error } = await supabase.storage
    .from(TEST_DOCUMENTS_BUCKET)
    .download(doc.snapshot_path)

  if (error || !data) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

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

export async function buildUploadedTestDocumentResponse(options: {
  testId: string
  classroomId: string
  doc: TestDocument
}): Promise<NextResponse> {
  const storagePath = getTestDocumentStoragePath(options.doc)
  if (!storagePath) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const supabase = getServiceRoleClient()
  let objectQuery = supabase
    .from('managed_storage_objects')
    .select('id,storage_path,status,purpose,classroom_id,provisional_owner_id,content_type')
    .eq('storage_bucket', TEST_DOCUMENTS_BUCKET)
  objectQuery = options.doc.managed_object_id
    ? objectQuery.eq('id', options.doc.managed_object_id)
    : objectQuery.eq('storage_path', storagePath)
  const { data: object, error: objectError } = await objectQuery.maybeSingle()

  if (objectError) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (!object && !options.doc.managed_object_id) {
    const contentType = await getPrivateStorageContentType({
      supabase,
      bucket: TEST_DOCUMENTS_BUCKET,
      path: storagePath,
    })
    if (contentType && isAllowedTestDocumentType(contentType)) {
      const compatibilityResponse = await buildPublicStorageCompatibilityRedirect({
        supabase,
        bucket: TEST_DOCUMENTS_BUCKET,
        path: storagePath,
      })
      if (compatibilityResponse) return compatibilityResponse
    }
  }

  if (!object || object.storage_path !== storagePath
    || object.status !== 'ready' || object.purpose !== 'teacher_test_material'
    || object.classroom_id !== options.classroomId || object.provisional_owner_id !== null) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { data: reference, error: referenceError } = await supabase
    .from('managed_storage_json_references')
    .select('managed_object_id')
    .eq('managed_object_id', object.id)
    .eq('test_id', options.testId)
    .maybeSingle()
  if (referenceError || !reference) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const contentType = await getPrivateStorageContentType({
    supabase,
    bucket: TEST_DOCUMENTS_BUCKET,
    path: storagePath,
    registeredContentType: object.content_type,
  })
  if (!contentType || !isAllowedTestDocumentType(contentType)) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  return buildPrivateStorageRedirect({
    supabase,
    bucket: TEST_DOCUMENTS_BUCKET,
    path: storagePath,
  })
}
