import { z } from 'zod'
import { MARKDOWN_IMAGE_MAX_SIZE } from '@/lib/markdown-images'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { getEffectiveStudentTestAccess, getTestStudentAvailabilityState } from '@/lib/server/tests'
import { isSurveyVisibleToStudents, canStudentViewSurveyResults } from '@/lib/surveys'
import { parsePngDimensions, parseJpegDimensions } from '@/lib/server/test-document-image-validation'
import { isAssignmentVisibleToStudents } from '@/lib/assignments'
import { compareAnnouncementReadTimestamps } from '@/lib/validations/announcement-reads'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import type { TableRow } from '@/types/database'

export const AUTHORING_IMAGE_MAX_SIZE = MARKDOWN_IMAGE_MAX_SIZE
export const authoringImageReservationSchema = z.object({
  classroom_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255),
  content_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  byte_size: z.number().int().positive().max(AUTHORING_IMAGE_MAX_SIZE),
}).strict()
export const authoringImageIdentitySchema = z.object({
  classroom_id: z.string().uuid(), managed_object_id: z.string().uuid(),
}).strict()
export const authoringImageUrl = (id: string) => `/api/storage/authoring-images?object_id=${encodeURIComponent(id)}`

/** Only owners may preview removed images during the unclaimed undo window. */
export function isRetainedAuthoringImage(object: Pick<TableRow<'managed_storage_objects'>,
  'purpose' | 'status' | 'cleanup_reason_code' | 'attempt_count' | 'next_attempt_at' |
  'lease_token' | 'lease_expires_at' | 'verified_at' | 'ready_at'>, now = new Date()): boolean {
  return object.purpose === 'teacher_authoring_image' && object.status === 'cleanup_pending'
    && object.cleanup_reason_code === 'authoring_image_reference_removed' && object.attempt_count === 0
    && object.lease_token === null && object.lease_expires_at === null
    && typeof object.verified_at === 'string' && typeof object.ready_at === 'string'
    && Date.parse(object.next_attempt_at) > now.getTime()
}

/** Validate the declared raster format; SVG and active content are never accepted. */
export function validateAuthoringImageHeader(type: string, bytes: Uint8Array): void {
  if (type === 'image/png') { parsePngDimensions(bytes); return }
  if (type === 'image/jpeg') { parseJpegDimensions(bytes); return }
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (type === 'image/gif' && bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) {
    const width = bytes[6] | bytes[7] << 8, height = bytes[8] | bytes[9] << 8
    if (width > 0 && height > 0 && width <= 10000 && height <= 10000 && width * height <= 40000000) return
  }
  if (type === 'image/webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF'
    && ascii(8, 4) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 4))) return
  throw new ApiError(400, 'Uploaded file is not a supported raster image')
}

export async function validateStoredAuthoringImage(path: string, type: string) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.storage.from('test-documents').createSignedUrl(path, 30)
  if (error || !data?.signedUrl) throw new ApiError(503, 'Unable to verify uploaded image')
  // The URL comes only from our Storage client, never from a caller-supplied URL.
  const response = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-65535' }, cache: 'no-store', signal: AbortSignal.timeout(5000) })
  if (!response.ok || !response.body) throw new ApiError(400, 'Unable to read uploaded image')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < 65536) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, 65536 - total); chunks.push(chunk); total += chunk.length
    }
  } finally { await reader.cancel().catch(() => undefined) }
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  validateAuthoringImageHeader(type, bytes)
}

function containsAuthoringImageReference(source: string | undefined, objectId: string): boolean {
  if (!source) return false
  // Route and query names are literal; only the UUID identity is case-insensitive.
  const references = source.matchAll(/\/api\/storage\/authoring-images\?object_id=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?![0-9a-fA-F-])/g)
  for (const [, id] of references) if (id.toLowerCase() === objectId.toLowerCase()) return true
  return false
}

/**
 * Classroom assets are private until referenced by content the member may read.
 * A random object identifier is never a substitute for publication/access checks.
 */
export async function memberCanReadAuthoringImage(classroomId: string, studentId: string, objectId: string): Promise<boolean> {
  const db = getServiceRoleClient(), url = authoringImageUrl(objectId), now = new Date()
  const [assignments, materials, surveyQuestions, testQuestions] = await Promise.all([
    db.from('assignments').select('instructions_markdown,released_at').eq('classroom_id', classroomId).eq('is_draft', false).ilike('instructions_markdown', `%${url}%`),
    db.from('classwork_materials').select('content,released_at').eq('classroom_id', classroomId).eq('is_draft', false),
    db.from('survey_questions').select('question_text,surveys!inner(id,classroom_id,status,opens_at,show_results)').eq('surveys.classroom_id', classroomId).ilike('question_text', `%${url}%`),
    db.from('test_questions').select('question_text,tests!inner(id,classroom_id,status)').eq('tests.classroom_id', classroomId).ilike('question_text', `%${url}%`),
  ])
  // Fail closed if any required visibility query is unavailable.
  if ([assignments, materials, surveyQuestions, testQuestions].some(result => result.error)) throw new ApiError(503, 'Unable to verify image access')
  const materialContains = (content: unknown) => {
    if (content && typeof content === 'object' && 'attrs' in content) {
      const attrs = content.attrs
      if (attrs && typeof attrs === 'object' && 'authoring_markdown' in attrs && typeof attrs.authoring_markdown === 'string') return containsAuthoringImageReference(attrs.authoring_markdown, objectId)
    }
    return containsAuthoringImageReference(JSON.stringify(content), objectId)
  }
  if (assignments.data?.some(row => isAssignmentVisibleToStudents({ is_draft: false, released_at: row.released_at }, now) && containsAuthoringImageReference(row.instructions_markdown ?? undefined, objectId))
    || materials.data?.some(row => (row.released_at === null || (typeof row.released_at === 'string'
      && compareAnnouncementReadTimestamps(row.released_at, now.toISOString()) <= 0)) && materialContains(row.content))) return true
  for (const row of surveyQuestions.data || []) {
    if (!containsAuthoringImageReference(row.question_text, objectId)) continue
    const survey = row.surveys
    if (survey.status !== 'active' && survey.status !== 'closed') continue
    const typed = { ...survey, status: survey.status as 'active' | 'closed' }
    if (isSurveyVisibleToStudents(typed) || canStudentViewSurveyResults(typed)) return true
    const response = await db.from('survey_responses').select('question_id').eq('survey_id', survey.id).eq('student_id', studentId).limit(1)
    if (response.error) throw new ApiError(503, 'Unable to verify survey image access')
    if (response.data?.length) return true
  }
  for (const row of testQuestions.data || []) {
    if (!containsAuthoringImageReference(row.question_text, objectId)) continue
    const test = row.tests
    if (test.status !== 'active' && test.status !== 'closed') continue
    const [availability, attempt, responses] = await Promise.all([
      getTestStudentAvailabilityState(db, test.id, studentId),
      db.from('test_attempts').select('is_submitted,returned_at,closed_for_grading_at').eq('test_id', test.id).eq('student_id', studentId).maybeSingle(),
      db.from('test_responses').select('selected_option,response_text').eq('test_id', test.id).eq('student_id', studentId),
    ])
    if (availability.error || attempt.error || responses.error) throw new ApiError(503, 'Unable to verify test image access')
    const isLockedForGrading = Boolean(attempt.data?.closed_for_grading_at)
    const hasSubmitted = Boolean(attempt.data?.is_submitted) || (!isLockedForGrading && hasAnyMeaningfulTestResponse(responses.data))
    const access = getEffectiveStudentTestAccess({ testStatus: test.status, accessState: availability.state, hasSubmitted, returnedAt: attempt.data?.returned_at, isLockedForGrading })
    if (access.can_start_or_continue || access.can_view_submitted) return true
  }
  return false
}
