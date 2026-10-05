import { z } from 'zod'
import { isValidTiptapContent } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

export const COURSE_GUIDE_READ_PAGE_SIZE = 1000
export const COURSE_GUIDE_READ_COLLECTION_LIMIT = 10000
export const COURSE_GUIDE_READ_PAGE_LIMIT = 64
export const COURSE_GUIDE_READ_DEADLINE_MS = 20000
export const COURSE_GUIDE_READ_CONFIG_BYTES = 4 * 1024
export const COURSE_GUIDE_READ_RESOURCE_BYTES = 2 * 1024 * 1024
export const COURSE_GUIDE_READ_DTO_BYTES = 4 * 1024 * 1024

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualCourseGuideReadParamsSchema = z.object({ classroomId: uuid }).strict()
export const contextualCourseGuideReadIdentitySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()

/** Bound depth and work before Zod's recursive JSON clone or Tiptap's recursive text extraction. */
function boundedJson(value: unknown, maximumBytes: number): boolean {
  const stack = [{ value, depth: 0 }]
  const seen = new Set<object>()
  let nodes = 0
  while (stack.length) {
    const current = stack.pop()!
    if (++nodes > 30000 || current.depth > 100) return false
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') { if (!Number.isFinite(current.value)) return false; continue }
    if (typeof current.value !== 'object' || seen.has(current.value)) return false
    seen.add(current.value)
    if (!Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype) return false
    for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 })
  }
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximumBytes } catch { return false }
}
const config = z.unknown().refine(value => boundedJson(value, COURSE_GUIDE_READ_CONFIG_BYTES)).pipe(z.json())
const resourceContent = z.unknown().refine(value => boundedJson(value, COURSE_GUIDE_READ_RESOURCE_BYTES)).pipe(z.json())
export const contextualCourseGuideReadTiptapSchema = z.custom<TiptapContent>(value => (
  boundedJson(value, COURSE_GUIDE_READ_RESOURCE_BYTES) && isValidTiptapContent(value)
))
const classroom = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
const enrollment = z.object({ classroom_id: uuid, student_id: uuid }).strict()
export const contextualCourseGuideReadAssignmentSchema = z.object({
  id: uuid, classroom_id: uuid, title: z.string(), position: z.number().int(),
  is_draft: z.boolean(), released_at: timestamp.nullable(),
}).strict()
export const contextualCourseGuideReadTestSchema = z.object({
  id: uuid, classroom_id: uuid, title: z.string(), position: z.number().int(), status: z.enum(['active', 'closed']),
}).strict()
const control = classroom.extend({
  actual_site_config: config,
  feature_visibility: config,
  membership: z.array(enrollment).length(1).optional(),
}).strict()
const payload = control.extend({
  title: z.string().optional(),
  course_overview_markdown: z.string().optional(),
  resources: z.object({ id: uuid, classroom_id: uuid, content: resourceContent }).strict().nullable().optional(),
  assignments: z.array(contextualCourseGuideReadAssignmentSchema).max(COURSE_GUIDE_READ_PAGE_SIZE).optional(),
  tests: z.array(contextualCourseGuideReadTestSchema).max(COURSE_GUIDE_READ_PAGE_SIZE).optional(),
}).strict()
function sdkEnvelope<T extends z.ZodType>(data: T) {
  return z.unknown().refine(value => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'data')
    && Object.prototype.hasOwnProperty.call(value, 'error')
  )).pipe(z.object({
    data: data.nullable(), error: z.null(), count: z.number().int().nonnegative().nullable().optional(),
    status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
  }).strict())
}
export const contextualCourseGuideReadClassroomEnvelopeSchema = sdkEnvelope(classroom)
export const contextualCourseGuideReadEnrollmentEnvelopeSchema = sdkEnvelope(enrollment)
export const contextualCourseGuideReadControlEnvelopeSchema = sdkEnvelope(control)
export const contextualCourseGuideReadPayloadEnvelopeSchema = sdkEnvelope(payload)

/** JSONB object equality ignores key order; array order and every raw value still matter. */
export function courseGuideReadJsonFingerprint(value: z.infer<typeof config>): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(courseGuideReadJsonFingerprint).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${courseGuideReadJsonFingerprint(value[key])}`).join(',')}}`
}
