import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import { createManagedUploadAuthorization, assertDirectUploadMatchesReservation, buildPrivateStorageRedirect, getPrivateStorageContentType } from '@/lib/server/direct-storage-delivery'
import { validateStoredTestDocumentImage } from '@/lib/server/test-document-image-validation'
import { buildSnapshotResponse, syncExternalLinkTestDocument } from '@/lib/server/test-document-snapshots'
import { isAllowedTestDocumentType, isSupportedLinkSnapshotContentType, normalizeTestDocuments, preserveCurrentTestDocumentSnapshots } from '@/lib/test-documents'
import {
  contextualTestOwnerMetadataSchema, contextualTestOwnerStudentAccessSchema, contextualTestOwnerReservationSchema,
  contextualTestOwnerFinalizationSchema, contextualTestOwnerCancellationSchema,
} from '@/lib/validations/contextual-test-owner-workflow'

type Input = { supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; testId: string; deadline?: number; signal?: AbortSignal }
const unavailable = () => new ApiError(503, 'Unable to verify test operation')
const objectSchema = z.object({
  id: z.string().uuid(), classroom_id: z.string().uuid(), storage_bucket: z.literal('test-documents'), storage_path: z.string().min(1),
  purpose: z.enum(['teacher_test_material', 'test_execution_snapshot']), created_by_user_id: z.string().uuid(),
  resource_type: z.literal('test'), resource_id: z.string().uuid(), status: z.enum(['reserved', 'verified']),
  content_type: z.string().min(1), byte_size: z.number().int().positive().max(25 * 1024 * 1024),
}).strict()
const accessCountsSchema = z.object({ updated_count: z.number().int().min(1).max(100), skipped_count: z.number().int().min(0).max(100),
  locked_count: z.number().int().min(0).max(100), unlocked_count: z.number().int().min(0).max(100), state: z.enum(['open', 'closed']) }).strict()
const documentSchema = z.object({ document: z.json(), content_type: z.string().nullable() }).strict()

function decodeObject(raw: unknown, input: Input, classroomId: string, objectId: string, purpose: 'teacher_test_material' | 'test_execution_snapshot') {
  const parsed = objectSchema.safeParse(raw)
  if (!parsed.success) throw unavailable()
  const object = parsed.data
  if (object.id !== objectId || object.classroom_id !== classroomId || object.created_by_user_id !== input.actorId
    || object.resource_id !== input.testId || object.purpose !== purpose) throw unavailable()
  return object
}
function responseTest(test: Awaited<ReturnType<ReturnType<typeof createContextualTestOwnerWorkflow>['inspect']>>) {
  return { test: { ...test, documents: normalizeTestDocuments(test.documents), assessment_type: 'test' as const } }
}

export async function patchContextualTestOwnerMetadata(input: Input & { body: z.infer<typeof contextualTestOwnerMetadataSchema> }) {
  const flow = createContextualTestOwnerWorkflow(input); const before = await flow.inspect()
  const payload = { ...input.body, ...(input.body.documents === undefined ? {} : { documents: preserveCurrentTestDocumentSnapshots(before.documents, input.body.documents) }) }
  const witness = await flow.run('update', z.json().parse(payload))
  if ((payload.title !== undefined && witness.test.title !== payload.title)
    || (payload.show_results !== undefined && witness.test.show_results !== payload.show_results)
    || !isDeepStrictEqual(witness.test.documents, payload.documents ?? before.documents)) throw unavailable()
  // The database's existing durable cleanup ledgers own removed objects; an
  // ambiguous acknowledgement never authorizes immediate Storage deletion.
  return responseTest(witness.test)
}

export async function updateContextualTestOwnerStudentAccess(input: Input & { body: z.infer<typeof contextualTestOwnerStudentAccessSchema> }) {
  const flow = createContextualTestOwnerWorkflow(input); await flow.inspect()
  const witness = await flow.run('student-access', input.body)
  const parsed = accessCountsSchema.safeParse(witness.result)
  if (!parsed.success || parsed.data.state !== input.body.state
    || parsed.data.updated_count + parsed.data.skipped_count !== input.body.student_ids.length
    || parsed.data.locked_count > parsed.data.updated_count || parsed.data.unlocked_count > parsed.data.updated_count) throw unavailable()
  return parsed.data
}

export async function reserveContextualTestOwnerDocument(input: Input & { body: z.infer<typeof contextualTestOwnerReservationSchema> }) {
  const flow = createContextualTestOwnerWorkflow(input); const test = await flow.inspect(); const objectId = randomUUID()
  const { document_id: docId, file_name: name, content_type: mime, byte_size: size } = input.body
  const image = mime === 'image/png' || mime === 'image/jpeg'
  const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpeg' : (name.split('.').pop()?.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf')
  const path = `classrooms/${test.classroom_id}/tests/${input.testId}/documents/${docId}/${image ? 'images/' : ''}${objectId}.${extension}`
  const reserved = await flow.run('reserve', { document_id: docId, object_id: objectId, storage_path: path,
    content_type: mime, byte_size: size, purpose: 'teacher_test_material' })
  const object = decodeObject(reserved.result, input, test.classroom_id, objectId, 'teacher_test_material')
  if (object.storage_path !== path || object.content_type !== mime || object.byte_size !== size || object.status !== 'reserved') throw unavailable()
  const authorization = await flow.within(() => createManagedUploadAuthorization({ supabase: input.supabase, bucket: 'test-documents', path }))
  const confirmed = await flow.run('upload', { managed_object_id: objectId, document_id: docId })
  if (!isDeepStrictEqual(confirmed.result, reserved.result)) throw unavailable()
  return { bucket: 'test-documents' as const, storage_path: path, upload_url: authorization.signedUrl, managed_object_id: objectId }
}

export async function finalizeContextualTestOwnerDocument(input: Input & { body: z.infer<typeof contextualTestOwnerFinalizationSchema> }) {
  const flow = createContextualTestOwnerWorkflow(input); const test = await flow.inspect()
  const current = await flow.run('upload', input.body)
  const object = decodeObject(current.result, input, test.classroom_id, input.body.managed_object_id, 'teacher_test_material')
  if (!isAllowedTestDocumentType(object.content_type)) throw unavailable()
  if (object.status === 'reserved') {
    await flow.within(() => assertDirectUploadMatchesReservation({ supabase: input.supabase, bucket: 'test-documents', path: object.storage_path,
      expectedByteSize: object.byte_size, expectedContentType: object.content_type }))
    if (object.content_type === 'image/png' || object.content_type === 'image/jpeg') {
      const contentType = object.content_type
      await flow.within(() => validateStoredTestDocumentImage({ supabase: input.supabase, path: object.storage_path, contentType }))
    }
  }
  const verified = await flow.run('verify', input.body)
  const result = decodeObject(verified.result, input, test.classroom_id, object.id, 'teacher_test_material')
  if (result.status !== 'verified' || !isDeepStrictEqual({ ...object, status: 'verified' }, result)) throw unavailable()
  return { document_id: input.body.document_id, storage_bucket: 'test-documents' as const, storage_path: result.storage_path, managed_object_id: result.id }
}

export async function cancelContextualTestOwnerDocument(input: Input & { body: z.infer<typeof contextualTestOwnerCancellationSchema> }) {
  const flow = createContextualTestOwnerWorkflow(input); await flow.inspect()
  const cancelled = await flow.run('cancel', input.body)
  if (typeof cancelled.result !== 'boolean') throw unavailable()
}

export async function syncContextualTestOwnerDocument(input: Input & { documentId: string }) {
  const flow = createContextualTestOwnerWorkflow(input); const before = await flow.inspect()
  const doc = normalizeTestDocuments(before.documents).find(value => value.id === input.documentId)
  if (!doc || doc.source !== 'link' || !doc.url) throw new ApiError(404, 'Link document not found')
  let reservedSnapshot: ReturnType<typeof decodeObject> | undefined
  const snapshot = await flow.within(() => syncExternalLinkTestDocument({ teacherId: input.actorId, classroomId: before.classroom_id, testId: input.testId, doc,
    managedStorage: {
      reserve: async reservation => {
        const result = await flow.run('reserve', { document_id: input.documentId, object_id: reservation.objectId, storage_path: reservation.path,
          purpose: 'test_execution_snapshot', expected_url: doc.url!, content_type: reservation.contentType!, byte_size: reservation.byteSize! })
        const object = decodeObject(result.result, input, before.classroom_id, reservation.objectId, 'test_execution_snapshot')
        if (object.storage_path !== reservation.path || object.content_type !== reservation.contentType || object.byte_size !== reservation.byteSize
          || object.status !== 'reserved') throw unavailable()
        reservedSnapshot = object
        return object
      },
      verify: async objectId => {
        const result = await flow.run('verify', { managed_object_id: objectId, document_id: input.documentId, expected_url: doc.url! })
        const object = decodeObject(result.result, input, before.classroom_id, objectId, 'test_execution_snapshot')
        if (!reservedSnapshot || !isDeepStrictEqual(object, { ...reservedSnapshot, status: 'verified' })) throw unavailable()
        return object
      },
    },
  }))
  if (!snapshot.snapshot_managed_object_id) throw unavailable()
  const attached = await flow.run('sync', { managed_object_id: snapshot.snapshot_managed_object_id, document_id: input.documentId,
    expected_url: doc.url, synced_at: snapshot.synced_at })
  const updated = normalizeTestDocuments(attached.test.documents).find(value => value.id === input.documentId)
  if (!updated || updated.snapshot_managed_object_id !== snapshot.snapshot_managed_object_id || updated.snapshot_path !== snapshot.snapshot_path
    || updated.snapshot_content_type !== snapshot.snapshot_content_type
    || !updated.synced_at || Date.parse(updated.synced_at) !== Date.parse(snapshot.synced_at) || updated.url !== doc.url) throw unavailable()
  return { ...responseTest(attached.test), document: updated }
}

export async function readContextualTestOwnerDocument(input: Input & { documentId: string; source: 'upload' | 'link' }) {
  const flow = createContextualTestOwnerWorkflow(input); await flow.inspect()
  const payload = { document_id: input.documentId, source: input.source }
  const source = await flow.run('document', payload)
  const parsed = documentSchema.safeParse(source.result)
  if (!parsed.success) throw unavailable()
  const docs = normalizeTestDocuments([parsed.data.document]); const doc = docs[0]
  if (docs.length !== 1 || doc.id !== input.documentId || doc.source !== input.source) throw unavailable()
  const path = doc.source === 'upload' ? doc.storage_path : doc.snapshot_path
  if (!path) throw unavailable()
  const contentType = parsed.data.content_type ?? await flow.within(() => getPrivateStorageContentType({ supabase: input.supabase, bucket: 'test-documents', path }))
  if (!contentType || (input.source === 'upload' ? !isAllowedTestDocumentType(contentType) : !isSupportedLinkSnapshotContentType(contentType))) throw new ApiError(404, 'Document not found')
  const response = await flow.within(() => input.source === 'link'
    ? buildSnapshotResponse({ ...doc, snapshot_content_type: contentType })
    : buildPrivateStorageRedirect({ supabase: input.supabase, bucket: 'test-documents', path }))
  const confirmed = await flow.run('document', payload)
  if (!isDeepStrictEqual(confirmed.result, source.result)) throw new ApiError(409, 'Document changed; reload and retry')
  return response
}
