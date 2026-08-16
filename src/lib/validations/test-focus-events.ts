import { z } from 'zod'

const telemetryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9:_-]+$/, 'must contain only letters, numbers, colons, underscores, or hyphens')

const metadataSchema = z
  .record(z.string().min(1).max(80), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 4_096, 'metadata must be at most 4096 bytes')

export const postTestFocusEventSchema = z
  .object({
    event_type: z.enum([
      'away_start',
      'away_end',
      'route_exit_attempt',
      'window_unmaximize_attempt',
    ]),
    session_id: telemetryIdSchema,
    incident_id: telemetryIdSchema.optional(),
    client_event_id: telemetryIdSchema.optional(),
    client_occurred_at: z.iso.datetime({ offset: true }).optional(),
    metadata: metadataSchema.nullish(),
  })
  .superRefine((value, context) => {
    const versionedFieldCount = [
      value.incident_id,
      value.client_event_id,
      value.client_occurred_at,
    ].filter(Boolean).length
    if (versionedFieldCount === 0 || versionedFieldCount === 3) return

    context.addIssue({
      code: 'custom',
      message: 'incident_id, client_event_id, and client_occurred_at must be provided together',
      path: ['incident_id'],
    })
  })

export type PostTestFocusEventInput = z.infer<typeof postTestFocusEventSchema>
