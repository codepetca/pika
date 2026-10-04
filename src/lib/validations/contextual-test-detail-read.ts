import { z } from 'zod'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { MAX_TEST_DOCUMENTS, MAX_TEST_DOCUMENT_TEXT_LENGTH, TEST_DOCUMENT_MAX_SIZE } from '@/lib/test-documents'

export const TEST_DETAIL_PAGE_SIZE = 1000
export const TEST_DETAIL_COLLECTION_LIMIT = 10000
export const TEST_DETAIL_STATEMENT_LIMIT = 128
export const TEST_DETAIL_DEADLINE_MS = 20000
export const TEST_DETAIL_DTO_BYTES = 8 * 1024 * 1024
export const TEST_DETAIL_TOTAL_BYTES = 64 * 1024 * 1024
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const json = z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json())
export const contextualTestDetailQuerySchema = z.object({ testId: inputUuid }).strict()
export const contextualTestDetailIdentitySchema = contextualTestDetailQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualTestDetailClassroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
export const contextualTestDetailControlSchema = z.object({ id: uuid, classroom_id: uuid, classrooms: contextualTestDetailClassroomSchema }).strict()
const document = z.object({
  id: z.string().min(1), title: z.string(), source: z.enum(['upload', 'text', 'link']).optional(), url: z.string().optional(),
  content: z.string().max(MAX_TEST_DOCUMENT_TEXT_LENGTH).optional(), storage_bucket: z.literal('test-documents').optional(), storage_path: z.string().optional(),
  managed_object_id: uuid.optional(), upload_content_type: z.string().optional(), snapshot_path: z.string().optional(),
  snapshot_managed_object_id: uuid.optional(), snapshot_content_type: z.string().optional(), synced_at: z.string().nullable().optional(),
}).strict()
export const contextualTestDetailTestSchema = contextualTestDetailControlSchema.extend({
  title: z.string(), status: z.enum(['draft', 'active', 'closed']), show_results: z.boolean(), documents: z.array(document).max(MAX_TEST_DOCUMENTS),
  position: z.number().int(), points_possible: z.number().finite(), include_in_final: z.boolean(), created_by: uuid, created_at: timestamp, updated_at: timestamp,
}).strict()
export const contextualTestDetailQuestionSchema = z.object({
  id: uuid, test_id: uuid, artifact_id: uuid, source_artifact_id: uuid.nullable(), question_type: z.enum(['multiple_choice', 'open_response']),
  question_text: z.string(), options: z.array(z.string()), correct_option: z.number().int().nullable(), answer_key: z.string().nullable(),
  sample_solution: z.string().nullable(), points: z.number().finite(), response_max_chars: z.number().int().positive(), response_monospace: z.boolean(),
  position: z.number().int(), created_at: timestamp, updated_at: timestamp, ai_reference_cache_answers: z.array(z.string()).nullable(),
  ai_reference_cache_generated_at: timestamp.nullable(), ai_reference_cache_key: z.string().nullable(), ai_reference_cache_model: z.string().nullable(),
}).strict()
export const contextualTestDetailDraftSchema = z.object({
  id: uuid, assessment_id: uuid, assessment_type: z.literal('test'), classroom_id: uuid, version: z.number().int().positive(), content: json,
}).strict()
export const contextualTestDetailReferenceSchema = z.object({
  id: uuid, test_id: uuid, managed_object_id: uuid, storage_bucket: z.literal('test-documents'), storage_path: z.string(), reference_role: z.literal('teacher_document'),
  managed_object: z.object({ id: uuid, classroom_id: uuid, course_blueprint_id: z.null(), provisional_owner_id: z.null(),
    storage_bucket: z.literal('test-documents'), storage_path: z.string(), purpose: z.literal('teacher_test_material'), status: z.literal('ready'),
    content_type: z.string().nullable(),
  }).strict(),
}).strict()
export function contextualTestDetailEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data: data.nullable(), error: z.null(), count: z.number().int().nonnegative().nullable().optional(),
    status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
  }).strict()
}
// Storage.info returns the installed SDK's camelized FileObjectV2. Only a
// successful exact bucket/name identity can provide a MIME presentation hint.
export const contextualTestDetailStorageInfoSchema = z.object({ data: z.object({
  name: z.string(), bucketId: z.literal('test-documents'), id: z.string().optional(), version: z.string().optional(),
  updatedAt: z.string().optional(), createdAt: z.string().optional(), lastAccessedAt: z.string().optional(), size: z.number().int().nonnegative().max(TEST_DOCUMENT_MAX_SIZE).optional(),
  cacheControl: z.string().optional(), contentType: z.string().optional(), etag: z.string().optional(), lastModified: z.string().optional(),
  metadata: z.record(z.string(), z.json()).optional(),
}).strict(), error: z.null() }).strict()
export const contextualTestDetailPublicBucketSchema = z.object({ data: z.object({
  id: z.literal('test-documents'), name: z.literal('test-documents'), public: z.literal(true), type: z.literal('STANDARD').optional(), owner: z.string().nullable().optional(),
  file_size_limit: z.number().int().nonnegative().nullable().optional(), allowed_mime_types: z.array(z.string()).nullable().optional(),
  created_at: z.string().optional(), updated_at: z.string().optional(),
}).strict(), error: z.null() }).strict()
