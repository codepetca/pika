import { z } from 'zod'
import { contextualClassroomMetadataPatchSchema } from '@/lib/validations/contextual-classroom-metadata'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const contextualClassroomHotLifecycleIdentitySchema = z.object({
  actorId: uuid, classroomId: uuid, archived: z.boolean(),
}).strict()
export const contextualClassroomHotLifecyclePatchSchema = z.object({ archived: z.boolean() }).strict()

// Lifecycle and metadata are distinct operations; mixed requests cannot bypass either contract.
export const contextualClassroomUpdatePatchSchema = z.union([
  contextualClassroomHotLifecyclePatchSchema, contextualClassroomMetadataPatchSchema,
])

export const contextualClassroomHotLifecycleErrorEnvelopeSchema = z.unknown().refine(value => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.prototype.hasOwnProperty.call(value, 'data') && Object.prototype.hasOwnProperty.call(value, 'error')
)).pipe(z.object({
  data: z.null(),
  error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict(),
  count: z.number().int().nonnegative().nullable().optional(),
  status: z.number().int().min(400).max(599).optional(), statusText: z.string().optional(),
}).strict())
