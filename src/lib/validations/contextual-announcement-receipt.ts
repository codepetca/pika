import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const announcementReceiptActorSchema = uuid
export const announcementReceiptParamsSchema = z.object({ id: uuid }).strict()

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const receipt = z.object({
  actor_id: uuid,
  classroom_id: uuid,
  marked: count,
  inserted: count,
}).strict().refine(value => value.inserted <= value.marked)
const metadata = {
  count: z.number().nullable().optional(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
}
const sdkEnvelope = z.union([
  z.object({ data: receipt, error: z.null(), ...metadata }).strict(),
  z.object({
    data: z.null(),
    error: z.object({
      code: z.string().min(1),
      message: z.string().nullable().optional(),
      details: z.string().nullable().optional(),
      hint: z.string().nullable().optional(),
    }).strict(),
    ...metadata,
  }).strict(),
])

// A missing/inherited SDK field cannot prove either success or an explicit denial.
export const announcementReceiptEnvelopeSchema = z.unknown().refine(value => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.prototype.hasOwnProperty.call(value, 'data')
  && Object.prototype.hasOwnProperty.call(value, 'error')
)).pipe(sdkEnvelope)
