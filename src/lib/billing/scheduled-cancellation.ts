import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const ScheduledCancellationRequestSchema = z.strictObject({
  action: z.enum(['cancel', 'undo']), scheduleOperationId: uuid, operationId: uuid,
})
export const ScheduledCancellationStatusSchema = z.strictObject({
  scheduleOperationId: uuid, cancellationOperationId: uuid.nullable(),
  state: z.enum(['install_pending', 'scheduled', 'cancel_pending', 'cancel_scheduled', 'undo_pending', 'undone', 'completed', 'attention']),
  effectiveAt: z.string().datetime({ offset: true }), canCancel: z.boolean(), canUndo: z.boolean(),
})
export type ScheduledCancellationStatus = z.infer<typeof ScheduledCancellationStatusSchema>
