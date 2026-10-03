import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const canonicalUuid = z.string().uuid().refine(value => value === value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualClassroomRosterParamsSchema = z.object({ id: uuid }).strict()
export const contextualClassroomRosterQuerySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()

const classroomSchema = z.object({ id: canonicalUuid, teacher_id: canonicalUuid, archived_at: timestamp.nullable() }).strict()
const bindingSchema = z.object({ classroom_id: canonicalUuid, roster_id: canonicalUuid, student_id: canonicalUuid }).strict()
export const contextualClassroomRosterRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  email: z.string(),
  student_number: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  counselor_email: z.string().nullable(),
  join_source: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  removed_at: timestamp.nullable(),
  binding: bindingSchema.nullable(),
}).strict()
export const contextualClassroomRosterEnrollmentSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  student_id: canonicalUuid,
  created_at: timestamp,
  student: z.object({ id: canonicalUuid, email: z.string() }).strict(),
}).strict()

/** Successful SDK results require their own data/error fields and no unknown envelope keys. */
function sdkEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.unknown().refine(value => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'data')
    && Object.prototype.hasOwnProperty.call(value, 'error')
  )).pipe(z.object({
    data: data.nullable(),
    error: z.null(),
    count: z.number().int().nonnegative().nullable().optional(),
    status: z.number().int().min(200).max(299).optional(),
    statusText: z.string().optional(),
  }).strict())
}

export const contextualClassroomRosterClassroomEnvelopeSchema = sdkEnvelope(classroomSchema)
export const contextualClassroomRosterPageEnvelopeSchema = sdkEnvelope(classroomSchema.extend({
  roster: z.array(contextualClassroomRosterRowSchema).max(1000),
}))
export const contextualClassroomRosterEnrollmentPageEnvelopeSchema = sdkEnvelope(classroomSchema.extend({
  enrollments: z.array(contextualClassroomRosterEnrollmentSchema).max(1000),
}))
export const contextualClassroomRosterPurgeAvailabilitySchema = z.array(canonicalUuid).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate student purge availability identity' })
  }
})
