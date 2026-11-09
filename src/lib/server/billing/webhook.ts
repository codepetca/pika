import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'

export const BILLING_WEBHOOK_MAX_BYTES = 262144
const providerReferenceSchema = z.union([
  z.string(), z.object({ id: z.string() }),
]).transform(value => typeof value === 'string' ? value : value.id)
const stripeEventEnvelopeSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
  object: z.literal('event').optional(),
  type: z.string().min(1).max(100),
  livemode: z.boolean(),
  account: z.string().nullish(),
  context: z.string().nullish(),
  created: z.number().int().nonnegative().max(8640000000000),
  data: z.object({ object: z.object({
    id: z.string().min(1).max(255),
    livemode: z.boolean().optional(),
    customer: providerReferenceSchema.nullish(),
    subscription: providerReferenceSchema.nullish(),
    parent: z.object({ subscription_details: z.object({
      subscription: providerReferenceSchema.nullish(),
    }).nullish() }).nullish(),
  }) }),
})

export type BillingEventReceipt = {
  stripe_account: string
  event_id: string
  payload_hash: string
  event_type: string
  payload: { object_id: string; customer_id: string | null; subscription_id: string | null }
  received_at: string
  event_created_at: string
} & ({ provider_mode: 'live' } | { provider_mode?: never })

/** Verifier must authenticate the original bytes using Stripe's official SDK. */
export async function acceptBillingWebhook<T>(input: {
  raw: Buffer
  signature: string | null
  stripeAccount: string
  providerMode?: 'test' | 'live'
  verify: (raw: Buffer, signature: string) => unknown
  record: (receipt: BillingEventReceipt) => Promise<T>
}): Promise<T> {
  if (input.raw.byteLength > BILLING_WEBHOOK_MAX_BYTES) {
    throw new ApiError(413, 'Webhook body is too large')
  }
  if (!input.signature) throw new ApiError(400, 'Invalid Stripe signature')
  let verified: unknown
  try { verified = input.verify(input.raw, input.signature) } catch {
    throw new ApiError(400, 'Invalid Stripe signature')
  }
  const parsed = stripeEventEnvelopeSchema.safeParse(verified)
  if (!parsed.success) throw new ApiError(400, 'Unsupported Stripe event envelope')
  const event = parsed.data
  const live = input.providerMode === 'live'
  const object = event.data.object
  const objectModeMatches = object.livemode === undefined ? !live : object.livemode === live
  if (event.livemode !== live || !objectModeMatches || (live && event.object !== 'event')) {
    throw new ApiError(400, 'Unsupported Stripe event envelope')
  }
  // Live ingress is a dedicated account endpoint. Reject Connect and
  // organization context even when the event has a valid endpoint signature.
  if (event.context != null || (event.account != null && (live || event.account !== input.stripeAccount))) {
    throw new ApiError(400, 'Stripe account mismatch')
  }
  const subscriptionId = event.type.startsWith('customer.subscription.')
    ? object.id : object.parent?.subscription_details?.subscription ?? object.subscription ?? null
  return input.record({
    stripe_account: input.stripeAccount,
    ...(live ? { provider_mode: 'live' } as const : {}),
    event_id: event.id,
    payload_hash: createHash('sha256').update(input.raw).digest('hex'),
    event_type: event.type,
    payload: { object_id: object.id, customer_id: object.customer ?? null, subscription_id: subscriptionId },
    received_at: new Date().toISOString(),
    event_created_at: new Date(event.created * 1000).toISOString(),
  })
}

/** Bound the stream itself; Content-Length alone is not a trustworthy limit. */
export async function readBillingWebhookBody(request: Request): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > BILLING_WEBHOOK_MAX_BYTES) {
        await reader.cancel()
        throw new ApiError(413, 'Webhook body is too large')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally { reader.releaseLock() }
}
