import { z } from 'zod'

export const materialScheduledForSchema = z.string().datetime({ offset: true })
  .transform(value => new Date(value).toISOString())
  .refine(value => Date.parse(value) > Date.now(), 'Scheduled date must be in the future')
  .nullable()

export function validateMaterialPublication(value: { is_draft?: boolean; scheduled_for?: string | null }, context: z.RefinementCtx) {
  if (value.is_draft === true && value.scheduled_for != null) {
    context.addIssue({ code: 'custom', message: 'A draft cannot also be scheduled', path: ['scheduled_for'] })
  }
}
