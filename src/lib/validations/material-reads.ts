import { z } from 'zod'
import { isValidTiptapContent } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const materialReadQuerySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()
const classroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
const enrollmentSchema = z.object({ classroom_id: uuid, student_id: uuid }).strict()
export const materialReadMembershipSchema = z.array(enrollmentSchema).length(1)

export const materialReadRowSchema = z.object({
  id: uuid,
  classroom_id: uuid,
  title: z.string(),
  content: z.custom<TiptapContent>(isValidTiptapContent),
  is_draft: z.boolean(),
  released_at: timestamp.nullable(),
  created_by: uuid,
  created_at: timestamp,
  updated_at: timestamp,
  position: z.number().int().min(-2147483648).max(2147483647),
  artifact_id: uuid.nullable(),
  source_artifact_id: uuid.nullable(),
  blueprint_archived_at: timestamp.nullable(),
  source_blueprint_version_id: uuid.nullable(),
}).strict()

function sdkEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.unknown().refine(value => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'data')
    && Object.prototype.hasOwnProperty.call(value, 'error')
  )).pipe(z.object({
    data: data.nullable(),
    error: z.null(),
    count: z.number().nullable().optional(),
    status: z.number().int().optional(),
    statusText: z.string().optional(),
  }).strict())
}

export const materialReadClassroomEnvelopeSchema = sdkEnvelope(classroomSchema)
export const materialReadEnrollmentEnvelopeSchema = sdkEnvelope(enrollmentSchema)
const rootSchema = classroomSchema.extend({ materials: z.array(materialReadRowSchema).max(1000) })
export const materialReadOwnerEnvelopeSchema = sdkEnvelope(rootSchema)
export const materialReadMemberEnvelopeSchema = sdkEnvelope(rootSchema.extend({ membership: materialReadMembershipSchema }))
