import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-handler'
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

function buildSnapshotStoragePath(teacherId: string, testId: string, docId: string): string {
  return `link-docs/${teacherId}/${testId}/${docId}/snapshot`
}

export function findTestDocument(test: Pick<TestAccessRecord, 'documents'>, docId: string): TestDocument | null {
  return normalizeTestDocuments(test.documents).find((doc) => doc.id === docId) ?? null
}

export async function syncExternalLinkTestDocument(options: {
  teacherId: string
  testId: string
  doc: TestDocument
}) {
  const { teacherId, testId, doc } = options
  if (doc.source !== 'link' || !doc.url) {
    throw new ApiError(400, 'Only link documents can be synced')
  }

  let response: Response
  try {
    response = await fetch(doc.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': 'PikaLinkSnapshot/1.0',
      },
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(400, 'Failed to fetch source document')
  }

  if (!response.ok) {
    throw new ApiError(400, `Source returned ${response.status}`)
  }

  const contentType = normalizeSnapshotContentType(response.headers.get('content-type'))
  if (!isSupportedLinkSnapshotContentType(contentType)) {
    throw new ApiError(400, 'Unsupported document type')
  }

  const contentLengthHeader = response.headers.get('content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isNaN(contentLength) && contentLength > TEST_DOCUMENT_MAX_SIZE) {
      throw new ApiError(400, 'Document is too large to sync')
    }
  }

  let body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > TEST_DOCUMENT_MAX_SIZE) {
    throw new ApiError(400, 'Document is too large to sync')
  }

  if (contentType === 'text/html') {
    const html = body.toString('utf8')
    body = Buffer.from(sanitizeSnapshotHtml(html, doc.url), 'utf8')
  }

  const supabase = getServiceRoleClient()
  const snapshotPath = buildSnapshotStoragePath(teacherId, testId, doc.id)

  const { error: uploadError } = await supabase.storage
    .from(TEST_DOCUMENTS_BUCKET)
    .upload(snapshotPath, body, {
      contentType,
      upsert: true,
    })

  if (uploadError) {
    const details = `${uploadError.message || ''} ${(uploadError as { details?: string }).details || ''}`.toLowerCase()
    if (details.includes('mime type') || details.includes('not supported')) {
      throw new ApiError(400, 'HTML link snapshots require migration 052 to be applied')
    }
    if (details.includes('bucket') || details.includes('not found')) {
      throw new ApiError(400, 'Test document uploads require migration 042 to be applied')
    }
    throw new ApiError(500, 'Failed to store synced document')
  }

  return {
    snapshot_path: snapshotPath,
    snapshot_content_type: contentType,
    synced_at: new Date().toISOString(),
  }
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
