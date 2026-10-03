import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const canonicalUuid = z.string().uuid().refine(value => value === value.toLowerCase(), 'Expected canonical UUID')
export const contextualRosterRemovalActorSchema = uuid
export const contextualRosterRemovalParamsSchema = z.object({ id: uuid }).strict()
export const contextualRosterRemovalBodySchema = z.object({
  roster_ids: z.array(uuid).min(1).max(100).transform(ids => [...new Set(ids)].sort()),
}).strict()
const resultSchema = z.object({
  actor_id: canonicalUuid,
  classroom_id: canonicalUuid,
  roster_ids: z.array(canonicalUuid).min(1).max(100),
  requested_count: z.number().int().min(1).max(100),
  removed_count: z.number().int().min(0).max(100),
}).strict()
const metadata = {
  count: z.number().int().nullable().optional(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
}
export const contextualRosterRemovalEnvelopeSchema = z.union([
  z.object({ data: resultSchema, error: z.null(), ...metadata }).strict(),
  z.object({ data: z.null(), error: z.object({
    code: z.string(), message: z.string().nullable().optional(),
    details: z.string().nullable().optional(), hint: z.string().nullable().optional(),
  }).strict(), ...metadata }).strict(),
])
