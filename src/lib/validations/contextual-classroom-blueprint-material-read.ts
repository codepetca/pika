import { z } from 'zod'
import { classroomBlueprintMaterialsSchema } from '@/lib/validations/classroom-blueprint-materials'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const contextualBlueprintMaterialReadParamsSchema = z.object({ id: uuid }).strict()
export const contextualBlueprintMaterialReadQuerySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()

const classroomIdentitySchema = z.object({ id: uuid, teacher_id: uuid }).strict()
const versionSchema = z.object({
  id: uuid,
  course_blueprint_id: uuid,
  version_number: z.number().int().positive(),
  // Keep the complete object boundary: JSON-path projection loses absent-vs-null evidence.
  snapshot_json: z.record(z.string(), z.unknown()),
}).strict()
const blueprintSchema = z.object({
  id: uuid,
  teacher_id: uuid,
  versions: z.array(versionSchema).max(1),
}).strict()
const payloadSchema = classroomIdentitySchema.extend({
  source_blueprint_id: uuid.nullable(),
  blueprint: blueprintSchema.nullable(),
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

export const contextualBlueprintMaterialReadClassroomEnvelopeSchema = sdkEnvelope(classroomIdentitySchema)
export const contextualBlueprintMaterialReadPayloadEnvelopeSchema = sdkEnvelope(payloadSchema)
export const contextualBlueprintMaterialReadProjectionSchema = z.object({
  version_id: uuid,
  version_number: z.number().int().positive(),
  materials: z.array(classroomBlueprintMaterialsSchema.shape.materials.element.strict()).max(500),
}).strict()
