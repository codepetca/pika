import { z } from 'zod'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const canonicalUuid = z.string().uuid().refine(value => value === value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
})
const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.string(), z.number().finite(), z.boolean(), z.array(jsonSchema), z.record(z.string(), jsonSchema),
]))
export const contextualClassroomDetailParamsSchema = z.object({ id: uuid }).strict()
export const contextualClassroomDetailQuerySchema = z.object({
  actorId: uuid, classroomId: uuid, permission: z.enum(['owner', 'member']),
}).strict()

const classroomSchema = z.object({
  id: canonicalUuid, teacher_id: canonicalUuid, archived_at: timestamp.nullable(),
}).strict()

// JSONB remains persisted JSON here; the existing hydrator owns compatibility
// defaults for site configuration, visibility and historical theme values.
export const contextualClassroomDetailRowSchema = z.object({
  id: canonicalUuid,
  teacher_id: canonicalUuid,
  title: z.string(),
  class_code: z.string(),
  term_label: z.string().nullable(),
  allow_enrollment: z.boolean(),
  join_policy: z.string(),
  archived_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  start_date: date.nullable(),
  end_date: date.nullable(),
  position: z.number().int(),
  theme_color: z.string(),
  lesson_plan_visibility: z.string(),
  blueprint_source_revision: z.number().int(),
  source_blueprint_id: canonicalUuid.nullable(),
  source_blueprint_origin: jsonSchema,
  source_blueprint_version_id: canonicalUuid.nullable(),
  authoring_guidance_version_id: canonicalUuid.nullable(),
  actual_site_slug: z.string().nullable(),
  actual_site_published: z.boolean(),
  actual_site_config: jsonSchema,
  feature_visibility: jsonSchema,
  course_overview_markdown: z.string(),
  course_outline_markdown: z.string(),
  manual_attendance_revision: z.number().int(),
  manual_attendance_session_starts_local: z.string().nullable(),
  manual_attendance_session_ends_local: z.string().nullable(),
  manual_attendance_source_mode: z.string(),
} satisfies Record<keyof TableRow<'classrooms'>, z.ZodTypeAny>).strict()

const membershipSchema = z.object({
  classroom_id: canonicalUuid, student_id: canonicalUuid,
}).strict()

/** Validate successful SDK envelopes, including own data/error and exact shape. */
function sdkEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.unknown().refine(value => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'data')
    && Object.prototype.hasOwnProperty.call(value, 'error')
  )).pipe(z.object({
    data: data.nullable(), error: z.null(),
    count: z.number().int().nonnegative().nullable().optional(),
    status: z.number().int().min(200).max(299).optional(),
    statusText: z.string().optional(),
  }).strict().superRefine((envelope, context) => {
    const { count } = envelope
    if (count !== undefined && count !== null && 'data' in envelope && count !== (envelope.data === null ? 0 : 1)) {
      context.addIssue({ code: 'custom', message: 'SDK cardinality does not match classroom evidence' })
    }
  }))
}

export const contextualClassroomDetailClassroomEnvelopeSchema = sdkEnvelope(classroomSchema)
export const contextualClassroomDetailOwnerEnvelopeSchema = sdkEnvelope(contextualClassroomDetailRowSchema)
export const contextualClassroomDetailMemberEnvelopeSchema = sdkEnvelope(contextualClassroomDetailRowSchema.extend({
  membership: z.array(membershipSchema).length(1),
}))
