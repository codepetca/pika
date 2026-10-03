import { z } from 'zod'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'
import { materialReadRowSchema } from '@/lib/validations/material-reads'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const materialMutationActorSchema = uuid
export const materialCreateParamsSchema = z.object({ id: uuid }).strict()
export const materialMutationParamsSchema = z.object({ id: uuid, materialId: uuid }).strict()
export const materialUpdateBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: assignmentSubmissionContentSchema.optional(),
  is_draft: z.boolean().optional(),
}).strict().refine(value => Object.values(value).some(field => field !== undefined), 'No changes provided')
export type MaterialUpdateInput = z.infer<typeof materialUpdateBodySchema>

// These decoders cover shared admission; the retained legacy branch still has validation debt.
export const parseMaterialCreateParams = (value: unknown) => materialCreateParamsSchema.parse(value)
export const parseMaterialMutationParams = (value: unknown) => materialMutationParamsSchema.parse(value)
export const parseMaterialUpdateBody = (value: unknown) => materialUpdateBodySchema.parse(value)

const metadata = {
  count: z.number().nullable().optional(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
}
const failure = z.object({
  data: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string().nullable().optional(),
    details: z.string().nullable().optional(),
    hint: z.string().nullable().optional(),
  }).strict(),
  ...metadata,
}).strict()
const evidence = { actor_id: uuid, classroom_id: uuid }
export const materialMutationEnvelopeSchema = z.union([
  z.object({
    data: z.object({ ...evidence, material: materialReadRowSchema }).strict(),
    error: z.null(), ...metadata,
  }).strict(),
  failure,
])
export const materialDeleteEnvelopeSchema = z.union([
  z.object({
    data: z.object({ ...evidence, deleted: z.literal(true), material_id: uuid }).strict(),
    error: z.null(), ...metadata,
  }).strict(),
  failure,
])
