import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/types/database'
import { patchContextualTestOwnerMetadata, updateContextualTestOwnerStudentAccess, reserveContextualTestOwnerDocument,
  finalizeContextualTestOwnerDocument, cancelContextualTestOwnerDocument, readContextualTestOwnerDocument, syncContextualTestOwnerDocument } from '@/lib/server/contextual-test-owner-materials'
import { syncExternalLinkTestDocument } from '@/lib/server/test-document-snapshots'
import { createManagedUploadAuthorization, assertDirectUploadMatchesReservation, buildPrivateStorageRedirect } from '@/lib/server/direct-storage-delivery'
import { validateStoredTestDocumentImage } from '@/lib/server/test-document-image-validation'

const actor = '11111111-1111-4111-8111-111111111111'
const classroom = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const objectId = '55555555-5555-4555-8555-555555555555'
const stamp = '2026-10-09T12:00:00Z'
const test = { id: testId, classroom_id: classroom, title: 'Test', status: 'closed', show_results: false, documents: [],
  position: 0, points_possible: 100, include_in_final: true, created_by: actor, created_at: stamp, updated_at: stamp,
  artifact_id: documentId, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10, questions_locked_at: null }
const path = `classrooms/${classroom}/tests/${testId}/documents/${documentId}/${objectId}.pdf`
const object = { id: objectId, classroom_id: classroom, storage_bucket: 'test-documents', storage_path: path,
  purpose: 'teacher_test_material', created_by_user_id: actor, resource_type: 'test', resource_id: testId,
  status: 'reserved', content_type: 'application/pdf', byte_size: 20 }
let stored: typeof test
let state: typeof object
let calls: string[]
let override: (operation: string, witness: Record<string, unknown>) => Record<string, unknown>
let network: ReturnType<typeof vi.fn<typeof fetch>>
vi.mock('node:crypto', async () => ({ ...await vi.importActual('node:crypto'), randomUUID: () => '55555555-5555-4555-8555-555555555555' }))
vi.mock('@/lib/server/direct-storage-delivery', () => ({ createManagedUploadAuthorization: vi.fn(), assertDirectUploadMatchesReservation: vi.fn(),
  buildPrivateStorageRedirect: vi.fn(), getPrivateStorageContentType: vi.fn() }))
vi.mock('@/lib/server/test-document-image-validation', () => ({ validateStoredTestDocumentImage: vi.fn() }))
vi.mock('@/lib/server/test-document-snapshots', async () => ({ ...await vi.importActual('@/lib/server/test-document-snapshots'), syncExternalLinkTestDocument: vi.fn() }))
const input = () => ({ actorId: actor, testId, supabase: createClient<Database>('https://example.test', 'offline-key', {
  global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } }) })
describe('owner Test material workflow strict bindings and retained reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(stamp); stored = { ...test }; state = { ...object }; calls = []
    override = (_operation, witness) => witness
    vi.mocked(createManagedUploadAuthorization).mockResolvedValue({ signedUrl: 'https://example.test/signed', token: 'token' })
    vi.mocked(assertDirectUploadMatchesReservation).mockResolvedValue(undefined)
    vi.mocked(buildPrivateStorageRedirect).mockResolvedValue(new NextResponse(null, { status: 302, headers: { location: 'https://example.test/signed' } }))
    network = vi.fn<typeof fetch>(async (_url, options) => {
      const args = JSON.parse(String(options?.body)); const operation = args.p_operation; calls.push(operation)
      let result: unknown = null
      if (operation === 'update') { stored = { ...stored, ...args.p_payload }; result = { cleanup_paths: [] } }
      if (operation === 'student-access') result = { updated_count: 1, skipped_count: 1, locked_count: 0, unlocked_count: 0, state: 'open' }
      if (operation === 'reserve' || operation === 'upload') result = state
      if (operation === 'verify') { state = { ...state, status: 'verified' }; result = state }
      if (operation === 'cancel') result = false
      if (operation === 'document') result = { document: { id: documentId, title: 'Reference', source: 'upload', storage_bucket: 'test-documents', storage_path: path, managed_object_id: objectId }, content_type: 'application/pdf' }
      return new Response(JSON.stringify(override(operation, { version: 1, actor_id: actor, classroom_id: classroom, test_id: testId, operation, test: stored, result })), { headers: { 'Content-Type': 'application/json' } })
    })
  })
  afterEach(() => vi.useRealTimers())
  it('uses the atomic metadata path for metadata-only edits', async () => {
    const result = await patchContextualTestOwnerMetadata({ ...input(), body: { title: 'Renamed' } })
    expect(result.test.title).toBe('Renamed'); expect(calls).toEqual(['inspect', 'update'])
  })
  it('preserves selected outsiders in the result count while accepting only transaction-bound counts', async () => {
    expect((await updateContextualTestOwnerStudentAccess({ ...input(), body: { state: 'open', student_ids: [documentId, actor] } })).skipped_count).toBe(1)
    override = (operation, witness) => operation === 'student-access' ? { ...witness, result: { updated_count: 2, skipped_count: 1, locked_count: 0, unlocked_count: 0, state: 'open' } } : witness
    await expect(updateContextualTestOwnerStudentAccess({ ...input(), body: { state: 'open', student_ids: [documentId, actor] } })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('reserves and revalidates one immutable object before returning a signed upload', async () => {
    const result = await reserveContextualTestOwnerDocument({ ...input(), body: { document_id: documentId, file_name: 'a.pdf', content_type: 'application/pdf', byte_size: 20 } })
    expect(result.managed_object_id).toBe(objectId); expect(calls).toEqual(['inspect', 'reserve', 'upload'])
  })
  it.each(['classroom_id', 'created_by_user_id', 'resource_id', 'id', 'storage_path'])('refuses a forged reservation %s before signing', async key => {
    override = (operation, witness) => operation === 'reserve' ? { ...witness, result: { ...state, [key]: documentId } } : witness
    await expect(reserveContextualTestOwnerDocument({ ...input(), body: { document_id: documentId, file_name: 'a.pdf', content_type: 'application/pdf', byte_size: 20 } })).rejects.toMatchObject({ statusCode: 503 })
    expect(createManagedUploadAuthorization).not.toHaveBeenCalled(); expect(calls).toEqual(['inspect', 'reserve'])
  })
  it('does not queue or delete objects after signing or verification failures', async () => {
    vi.mocked(createManagedUploadAuthorization).mockRejectedValue(new Error('signing unavailable'))
    await expect(reserveContextualTestOwnerDocument({ ...input(), body: { document_id: documentId, file_name: 'a.pdf', content_type: 'application/pdf', byte_size: 20 } })).rejects.toThrow()
    expect(calls).toEqual(['inspect', 'reserve']); calls = []
    vi.mocked(assertDirectUploadMatchesReservation).mockRejectedValue(new Error('verification unavailable'))
    await expect(finalizeContextualTestOwnerDocument({ ...input(), body: { document_id: documentId, managed_object_id: objectId } })).rejects.toThrow()
    expect(calls).toEqual(['inspect', 'upload'])
  })
  it('retries an already verified image without another Storage read or invalidation', async () => {
    state = { ...state, content_type: 'image/png', storage_path: path.replace(`${objectId}.pdf`, `images/${objectId}.png`), status: 'verified' }
    expect((await finalizeContextualTestOwnerDocument({ ...input(), body: { document_id: documentId, managed_object_id: objectId } })).managed_object_id).toBe(objectId)
    expect(assertDirectUploadMatchesReservation).not.toHaveBeenCalled(); expect(validateStoredTestDocumentImage).not.toHaveBeenCalled()
    expect(calls).toEqual(['inspect', 'upload', 'verify'])
  })
  it('delegates cancellation once and accepts a reserved-to-verified race refusal', async () => {
    await cancelContextualTestOwnerDocument({ ...input(), body: { managed_object_id: objectId } })
    expect(calls).toEqual(['inspect', 'cancel'])
  })
  it('revalidates the exact document after preparing private delivery', async () => {
    expect((await readContextualTestOwnerDocument({ ...input(), documentId, source: 'upload' })).status).toBe(302)
    expect(calls).toEqual(['inspect', 'document', 'document']); calls = []
    override = (operation, witness) => operation === 'document' && calls.length === 3 ? { ...witness, result: { document: {}, content_type: 'application/pdf' } } : witness
    await expect(readContextualTestOwnerDocument({ ...input(), documentId, source: 'upload' })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('bounds a hung Storage authorization without issuing another mutation', async () => {
    vi.mocked(createManagedUploadAuthorization).mockImplementation(() => new Promise(() => {}))
    const pending = expect(reserveContextualTestOwnerDocument({ ...input(), body: { document_id: documentId, file_name: 'a.pdf', content_type: 'application/pdf', byte_size: 20 } })).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(30000); await pending; expect(calls).toEqual(['inspect', 'reserve']); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['storage_path', 'content_type', 'byte_size'])('rejects changed snapshot verification %s before attachment', async key => {
    const snapshotPath = `link-docs/${actor}/${testId}/${documentId}/snapshots/${objectId}`
    const link = { id: documentId, title: 'Reference', source: 'link', url: 'https://example.test/document' }
    state = { ...object, storage_path: snapshotPath, purpose: 'test_execution_snapshot', content_type: 'text/html' }
    override = (operation, witness) => ({ ...witness, test: { ...test, documents: [link] },
      ...(operation === 'verify' ? { result: { ...state, [key]: key === 'byte_size' ? 21 : 'forged' } } : {}) })
    vi.mocked(syncExternalLinkTestDocument).mockImplementation(async options => {
      await options.managedStorage!.reserve({ supabase: input().supabase, objectId, bucket: 'test-documents', path: snapshotPath,
        classroomId: classroom, purpose: 'test_execution_snapshot', createdByUserId: actor, resourceType: 'test', resourceId: testId,
        contentType: 'text/html', byteSize: 20 })
      await options.managedStorage!.verify(objectId)
      return { snapshot_path: snapshotPath, snapshot_managed_object_id: objectId, snapshot_content_type: 'text/html', synced_at: stamp }
    })
    await expect(syncContextualTestOwnerDocument({ ...input(), documentId })).rejects.toMatchObject({ statusCode: 503 })
    expect(calls).toEqual(['inspect', 'reserve', 'verify'])
  })
  it('accepts the database timestamp serialization for an exactly bound snapshot', async () => {
    const snapshotPath = `link-docs/${actor}/${testId}/${documentId}/snapshots/${objectId}`
    const link = { id: documentId, title: 'Reference', source: 'link', url: 'https://example.test/document' }
    state = { ...object, storage_path: snapshotPath, purpose: 'test_execution_snapshot', content_type: 'text/html' }
    override = (operation, witness) => ({ ...witness, test: { ...test, documents: [{ ...link,
      ...(operation === 'sync' ? { snapshot_path: snapshotPath, snapshot_managed_object_id: objectId,
        snapshot_content_type: 'text/html', synced_at: '2026-10-09T12:00:00+00:00' } : {}) }] } })
    vi.mocked(syncExternalLinkTestDocument).mockImplementation(async options => {
      await options.managedStorage!.reserve({ supabase: input().supabase, objectId, bucket: 'test-documents', path: snapshotPath,
        classroomId: classroom, purpose: 'test_execution_snapshot', createdByUserId: actor, resourceType: 'test', resourceId: testId,
        contentType: 'text/html', byteSize: 20 })
      await options.managedStorage!.verify(objectId)
      return { snapshot_path: snapshotPath, snapshot_managed_object_id: objectId, snapshot_content_type: 'text/html', synced_at: stamp }
    })
    const result = await syncContextualTestOwnerDocument({ ...input(), documentId })
    expect(result.document.snapshot_managed_object_id).toBe(objectId)
    expect(calls).toEqual(['inspect', 'reserve', 'verify', 'sync'])
  })
})
