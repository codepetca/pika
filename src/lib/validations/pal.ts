import { z } from 'zod'

export const palOutboxRequeueRequestSchema = z.object({
  outbox_id: z.string().uuid(),
}).strict()
