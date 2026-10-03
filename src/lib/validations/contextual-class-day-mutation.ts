import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const contextualClassDayMutationParamsSchema = z.object({ classroomId: uuid }).strict()
// Compatibility bodies also contain operation fields and discarded client claims.
export const contextualClassDayMutationBodyIdentitySchema = z.object({ classroom_id: uuid })
export const contextualClassDayMutationIdentitySchema = z.object({ actorId: uuid, classroomId: uuid }).strict()
const rowSchema = z.object({
  id: uuid,
  classroom_id: uuid,
  date: z.iso.date(),
  is_class_day: z.boolean(),
  prompt_text: z.string().nullable(),
}).strict()
const successSchema = z.object({
  data: z.array(rowSchema).max(367),
  error: z.null(),
  count: z.number().int().nonnegative().nullable().optional(),
  status: z.number().int().min(200).max(299).optional(),
  statusText: z.string().optional(),
}).strict()
const failureSchema = z.object({
  data: z.null(),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.string().nullable().optional(),
    hint: z.string().nullable().optional(),
  }).strict(),
  count: z.null().optional(),
  status: z.union([z.literal(0), z.number().int().min(400).max(599)]).optional(),
  statusText: z.string().optional(),
}).strict()
export const contextualClassDayMutationEnvelopeSchema = z.unknown().refine(value => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.prototype.hasOwnProperty.call(value, 'data')
  && Object.prototype.hasOwnProperty.call(value, 'error')
)).pipe(z.union([successSchema, failureSchema]))
