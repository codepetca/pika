import { z } from 'zod'
import { courseBlueprintAuthoringGuidanceSchema } from '@/lib/course-blueprint-authoring-guidance'

export const CLASSROOM_AUTHORING_GUIDANCE_WIRE_BYTES = 8 * 1024 * 1024
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const contextualClassroomAuthoringGuidanceParamsSchema = z.object({ id: uuid }).strict()
export const contextualClassroomAuthoringGuidanceQuerySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()

// Private complete-projection bounds, not subscription quotas or UI notices.
const course = z.object({
  title: z.string(), subject: z.string(), grade_level: z.string(), outline_markdown: z.string(),
  assignment_titles: z.array(z.string().min(1)).max(10_000),
  test_titles: z.array(z.string().min(1)).max(10_000),
}).strict().refine(value => value.assignment_titles.length + value.test_titles.length <= 10_000)
const context = z.object({
  blueprint_id: uuid,
  content_version_id: uuid,
  content_version_number: positive,
  source_blueprint_version_id: uuid,
  source_blueprint_version_number: positive,
  source_draft_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  guidance: courseBlueprintAuthoringGuidanceSchema.nullable(),
  course,
}).strict()
export const contextualClassroomAuthoringGuidanceProjectionSchema = z.object({
  actor_id: uuid,
  classroom_id: uuid,
  classroom: z.object({
    id: uuid, teacher_id: uuid, source_blueprint_id: uuid.nullable(),
    source_blueprint_version_id: uuid.nullable(), authoring_guidance_version_id: uuid.nullable(),
  }).strict(),
  version_parents: z.object({ content: uuid, guidance: uuid }).strict().nullable(),
  context: context.nullable(),
}).strict()

export const contextualClassroomAuthoringGuidanceSuccessSchema = z.object({
  data: contextualClassroomAuthoringGuidanceProjectionSchema,
  error: z.null(), status: z.number().int().min(200).max(299), statusText: z.string(),
  count: z.union([z.null(), z.literal(1)]),
}).strict()
export const contextualClassroomAuthoringGuidanceFailureSchema = z.object({
  data: z.null(),
  error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict(),
  status: z.number().int().min(400).max(599), statusText: z.string(), count: z.null(),
}).strict()
