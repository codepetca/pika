import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualClassDayReadParamsSchema = z.object({ classroomId: uuid }).strict()
export const contextualClassDayReadQuerySchema = z.object({ classroom_id: uuid }).strict()
export const contextualClassDayReadIdentitySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()
const classroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
const enrollmentSchema = z.object({ classroom_id: uuid, student_id: uuid }).strict()
export const contextualClassDayReadMembershipSchema = z.array(enrollmentSchema).length(1)
export const contextualClassDayReadRowSchema = z.object({
  id: uuid,
  classroom_id: uuid,
  date: z.iso.date(),
  is_class_day: z.boolean(),
  prompt_text: z.string().nullable(),
}).strict()

function sdkEnvelope<T extends z.ZodType>(data: T) {
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

export const contextualClassDayReadClassroomEnvelopeSchema = sdkEnvelope(classroomSchema)
export const contextualClassDayReadEnrollmentEnvelopeSchema = sdkEnvelope(enrollmentSchema)
const rootSchema = classroomSchema.extend({ class_days: z.array(contextualClassDayReadRowSchema).max(1000) })
export const contextualClassDayReadOwnerEnvelopeSchema = sdkEnvelope(rootSchema)
export const contextualClassDayReadMemberEnvelopeSchema = sdkEnvelope(rootSchema.extend({ membership: contextualClassDayReadMembershipSchema }))
