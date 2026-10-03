import { z } from 'zod'
import { parseAnnouncementTitleInput } from '@/lib/announcements'
import { announcementReadRowSchema } from '@/lib/validations/announcement-reads'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const announcementCreateParamsSchema = z.object({ id: uuid }).strict()
export const announcementMutationParamsSchema = z.object({ id: uuid, announcementId: uuid }).strict()
export const announcementMutationActorSchema = uuid

const title = z.string().nullable().transform((value, context) => {
  const parsed = parseAnnouncementTitleInput(value)
  if (!parsed.ok) {
    context.addIssue({ code: 'custom', message: parsed.error })
    return z.NEVER
  }
  return parsed.value ?? null
})
const scheduledFor = z.string().transform((value, context) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    context.addIssue({ code: 'custom', message: 'Invalid scheduled date' })
    return z.NEVER
  }
  return date.toISOString()
}).refine(value => Date.parse(value) > Date.now(), 'Scheduled date must be in the future').nullable()
const fields = {
  content: z.string().trim().min(1, 'Content is required'),
  title: title.optional(),
  is_draft: z.boolean().optional(),
  scheduled_for: scheduledFor.optional(),
}
const publicationCheck = (value: { is_draft?: boolean; scheduled_for?: string | null }, context: z.RefinementCtx) => {
  if (value.is_draft === true && value.scheduled_for != null) {
    context.addIssue({ code: 'custom', message: 'A draft cannot also be scheduled', path: ['scheduled_for'] })
  }
}
export const announcementCreateBodySchema = z.object({
  ...fields,
  is_draft: z.boolean().default(false),
}).strict().superRefine(publicationCheck)
export const announcementUpdateBodySchema = z.object({
  ...fields,
  content: fields.content.optional(),
}).strict().superRefine((value, context) => {
  publicationCheck(value, context)
  if (!Object.values(value).some(field => field !== undefined)) {
    context.addIssue({ code: 'custom', message: 'At least one announcement field is required' })
  }
})
export type AnnouncementCreateInput = z.infer<typeof announcementCreateBodySchema>
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateBodySchema>

// The legacy branches still carry body-validation debt; these decoders cover only shared admission.
export const parseAnnouncementCreateParams = (value: unknown) => announcementCreateParamsSchema.parse(value)
export const parseAnnouncementMutationParams = (value: unknown) => announcementMutationParamsSchema.parse(value)
export const parseAnnouncementCreateBody = (value: unknown) => announcementCreateBodySchema.parse(value)
export const parseAnnouncementUpdateBody = (value: unknown) => announcementUpdateBodySchema.parse(value)

// Reuse the read contract's publication invariants, with exact mutation output keys.
export const announcementMutationRowSchema = announcementReadRowSchema.strict()
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
export const announcementMutationEnvelopeSchema = z.union([
  z.object({ data: z.object({ announcement: announcementMutationRowSchema }).strict(), error: z.null(), ...metadata }).strict(),
  failure,
])
export const announcementDeleteEnvelopeSchema = z.union([
  z.object({
    data: z.object({ deleted: z.literal(true), announcement_id: uuid, classroom_id: uuid }).strict(),
    error: z.null(),
    ...metadata,
  }).strict(),
  failure,
])
