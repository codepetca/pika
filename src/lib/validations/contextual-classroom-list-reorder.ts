import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
// Private wire/work ceiling, not a plan quota. Complete sets are never truncated.
export const contextualClassroomListOrderSchema = z.array(uuid).max(4096)
  .refine(ids => new Set(ids).size === ids.length,'classroom_ids must be unique')
export const contextualClassroomListReorderSchema = z.object({classroom_ids:contextualClassroomListOrderSchema}).strict()
export const contextualClassroomListReorderIdentitySchema = z.object({actorId:uuid,classroomIds:contextualClassroomListOrderSchema}).strict()
