import { z } from 'zod'
import { courseBlueprintAuthoringGuidanceSchema } from '@/lib/course-blueprint-authoring-guidance'

export const CLASSROOM_GUIDANCE_PREVIEW_WIRE_BYTES = 8 * 1024 * 1024
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const contextualClassroomGuidancePreviewParamsSchema = z.object({ id: uuid }).strict()
export const contextualClassroomGuidancePreviewQuerySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()
const version = z.object({ id: uuid, course_blueprint_id: uuid }).strict()
export const contextualClassroomGuidancePreviewProjectionSchema = z.object({
  actor_id: uuid, classroom_id: uuid,
  classroom: z.object({ id: uuid, teacher_id: uuid, archived_at: z.null(), source_blueprint_id: uuid,
    source_blueprint_version_id: uuid, authoring_guidance_version_id: uuid.nullable() }).strict(),
  blueprint: z.object({ id: uuid, teacher_id: uuid, content_revision: positive }).strict(),
  versions: z.object({ content: version, guidance: version.extend({ version_number: positive }).strict() }).strict(),
  current_guidance: courseBlueprintAuthoringGuidanceSchema.nullable(),
  guidance: courseBlueprintAuthoringGuidanceSchema.nullable(),
}).strict()
export const contextualClassroomGuidancePreviewSuccessSchema = z.object({
  data: contextualClassroomGuidancePreviewProjectionSchema, error: z.null(),
  status: z.number().int().min(200).max(299), statusText: z.string(), count: z.union([z.null(), z.literal(1)]),
}).strict()
export const contextualClassroomGuidancePreviewFailureSchema = z.object({
  data: z.null(), error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict(),
  status: z.number().int().min(400).max(599), statusText: z.string(), count: z.null(),
}).strict()
