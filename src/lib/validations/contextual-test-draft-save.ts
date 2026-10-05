import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestDraftGetIdentitySchema, contextualTestDraftGetSnapshotSchema, contextualTestDraftGetRowSchema, contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'
import { MAX_TEST_DOCUMENTS, MAX_TEST_DOCUMENT_TEXT_LENGTH, TEST_DOCUMENT_ALLOWED_TYPES, isValidHttpUrl, validateTestDocumentsPayload } from '@/lib/test-documents'
import { MAX_TEST_OPTIONS } from '@/lib/tests'

export const TEST_DRAFT_SAVE_QUESTION_LIMIT = 10000
export const TEST_DRAFT_SAVE_PATCH_LIMIT = 10000
export const TEST_DRAFT_SAVE_CONTENT_BYTES = 2 * 1024 * 1024
export const TEST_DRAFT_SAVE_DOCUMENT_BYTES = 2 * 1024 * 1024
export const TEST_DRAFT_SAVE_BODY_BYTES = 2 * 1024 * 1024
export const TEST_DRAFT_SAVE_ENVELOPE_BYTES = 8 * 1024 * 1024
export const TEST_DRAFT_SAVE_TOTAL_BYTES = 64 * 1024 * 1024
export const TEST_DRAFT_SAVE_DEADLINE_MS = 20000
export const TEST_DRAFT_SAVE_MAX_VERSION = 2147483647
const version = z.number().int().positive().max(TEST_DRAFT_SAVE_MAX_VERSION)
const boundedJson = (bytes: number) => z.unknown().refine(value => boundedAssignmentListJson(value, bytes), 'JSON exceeds draft save limits').pipe(z.json())
const question = z.object({
  id: z.string().uuid(), question_type: z.enum(['multiple_choice', 'open_response']), question_text: z.string(),
  options: z.array(z.string()).max(MAX_TEST_OPTIONS), correct_option: z.number().int().nullable(), answer_key: z.string().nullable(), sample_solution: z.string().nullable(),
  points: z.number().finite().positive().max(9999.99), response_max_chars: z.number().int().min(1).max(20000), response_monospace: z.boolean(),
}).strict()
export const contextualTestDraftSaveContentSchema = boundedJson(TEST_DRAFT_SAVE_CONTENT_BYTES).pipe(z.object({
  title: z.string().refine(value => value.trim().length > 0), show_results: z.boolean(),
  question_identity_version: z.literal(1).optional(), questions: z.array(question).max(TEST_DRAFT_SAVE_QUESTION_LIMIT),
  source_format: z.literal('markdown').optional(), source_markdown: z.string().optional(),
}).strict()).refine(value => new Set(value.questions.map(q => q.id.toLowerCase())).size === value.questions.length, 'Duplicate question id')

const pointer = z.string().max(4096).refine(value => value === '' || (value.startsWith('/') && !/~(?:[^01]|$)/.test(value)
  && value.split('/').length <= 101 && value.split('/').slice(1).every(token => !['__proto__', 'constructor', 'prototype'].includes(token.replace(/~1/g, '/').replace(/~0/g, '~')))), 'Invalid JSON pointer')
const patchOperation = z.union([
  z.object({ op: z.enum(['add', 'replace', 'test']), path: pointer, value: boundedJson(TEST_DRAFT_SAVE_CONTENT_BYTES) }).strict().refine(value => Object.hasOwn(value, 'value'), 'value is required'),
  z.object({ op: z.literal('remove'), path: pointer }).strict(),
  z.object({ op: z.enum(['copy', 'move']), path: pointer, from: pointer }).strict(),
])
const path = z.string().min(1).max(4096).refine(value => !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'))
const document = z.object({
  id: z.string().min(1).max(4096).refine(value => value === value.trim() && !value.includes('\0')),
  title: z.string().min(1).max(120).refine(value => value.trim().length > 0), source: z.enum(['link', 'upload', 'text']),
  url: z.string().max(4096).refine(isValidHttpUrl).optional(), storage_bucket: z.literal('test-documents').optional(), storage_path: path.optional(),
  managed_object_id: z.string().uuid().optional(), upload_content_type: z.enum(TEST_DOCUMENT_ALLOWED_TYPES).optional(), content: z.string().max(MAX_TEST_DOCUMENT_TEXT_LENGTH).optional(),
  // Caller snapshot fields are decoded but never trusted; bound source identity
  // determines whether any snapshot metadata survives the save.
  snapshot_path: z.string().max(4096).optional(), snapshot_managed_object_id: z.string().max(4096).optional(),
  snapshot_content_type: z.string().max(256).optional(), synced_at: z.string().max(256).nullable().optional(),
}).strict().superRefine((value, context) => {
  if ((value.source === 'text' && !value.content?.trim()) || (value.source === 'link' && !value.url)
    || (value.source === 'upload' && !value.storage_path)) context.addIssue({ code: 'custom', message: 'Invalid document identity or content' })
})
export const contextualTestDraftSaveDocumentsSchema = boundedJson(TEST_DRAFT_SAVE_DOCUMENT_BYTES).pipe(z.array(document).max(MAX_TEST_DOCUMENTS))
  .refine(value => new Set(value.map(doc => doc.id)).size === value.length, 'Duplicate document id')
  .refine(value => validateTestDocumentsPayload(value).valid, 'Invalid documents')
export const contextualTestDraftSaveRequestSchema = z.unknown().refine(value => boundedAssignmentListJson(value, TEST_DRAFT_SAVE_BODY_BYTES), 'Draft save body exceeds limits').pipe(z.object({
  version, content: contextualTestDraftSaveContentSchema.optional(), patch: z.array(patchOperation).max(TEST_DRAFT_SAVE_PATCH_LIMIT).optional(),
  documents: contextualTestDraftSaveDocumentsSchema.optional(),
}).strict()).refine(value => value.content !== undefined || value.patch !== undefined, 'content or patch is required')
export type ContextualTestDraftSaveInput = z.infer<typeof contextualTestDraftSaveRequestSchema>
export const contextualTestDraftSaveIdentitySchema = contextualTestDraftGetIdentitySchema
export const contextualTestDraftSaveQuerySchema = contextualTestDraftGetIdentitySchema.pick({ testId: true })
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualTestDraftSaveTestSchema = contextualTestDraftGetSnapshotSchema.shape.test.extend({ documents: boundedJson(TEST_DRAFT_SAVE_DOCUMENT_BYTES), updated_at: timestamp }).strict()
export const contextualTestDraftSaveRowSchema = contextualTestDraftGetRowSchema.extend({ version }).strict()
export const contextualTestDraftSaveSnapshotSchema = contextualTestDraftGetSnapshotSchema.extend({ test: contextualTestDraftSaveTestSchema, draft: contextualTestDraftSaveRowSchema.nullable() }).strict()
export const contextualTestDraftSaveFinalSchema = z.object({
  version: z.literal(1), actor_id: contextualTestDraftGetSnapshotSchema.shape.actor_id,
  classroom_id: contextualTestDraftSaveTestSchema.shape.classroom_id, test_id: contextualTestDraftSaveTestSchema.shape.id,
  operation: z.enum(['inspect', 'save']), draft: contextualTestDraftSaveRowSchema.nullable(), test: contextualTestDraftSaveTestSchema,
  editingPolicy: z.object({ structureLocked: z.boolean() }).strict(),
}).strict()
export const contextualTestDraftSaveRpcEnvelopeSchema = contextualTestDraftGetRpcEnvelopeSchema

/** Bound the actual UTF8 stream, including untrusted content-length, before
 * JSON decoding. The route owns the single named request schema boundary. */
export async function readContextualTestDraftSaveBody(request: Request, deadline = Date.now() + TEST_DRAFT_SAVE_DEADLINE_MS): Promise<unknown> {
  const invalid = () => new ApiError(400, 'Invalid test draft save body')
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TEST_DRAFT_SAVE_BODY_BYTES)) throw invalid()
  if (!request.body) throw invalid()
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const reading = async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0; let text = ''
      for (;;) {
        if (Date.now() >= deadline) throw new ApiError(503, 'Unable to verify test draft save')
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > TEST_DRAFT_SAVE_BODY_BYTES) throw invalid()
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      return JSON.parse(text) as unknown
    }
    return await Promise.race([reading(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ApiError(503, 'Unable to verify test draft save')), Math.max(0, deadline - Date.now()))
    })])
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw invalid()
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
}
