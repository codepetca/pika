import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'

export const BILLING_WEBHOOK_MAX_BYTES = 262144
const providerReferenceSchema = z.union([
  z.string(), z.object({ id: z.string() }),
]).transform(value => typeof value === 'string' ? value : value.id)
const stripeEventEnvelopeSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
  type: z.string().min(1).max(100),
  livemode: z.literal(false),
  account: z.string().optional(),
  context: z.string().optional(),
  created: z.number().int().nonnegative().max(8640000000000),
  data: z.object({ object: z.object({
    id: z.string().min(1).max(255),
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
}

/** Verifier must authenticate the original bytes using Stripe's official SDK. */
export async function acceptBillingWebhook<T>(input: {
  raw: Buffer
  signature: string | null
  stripeAccount: string
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
  if ((event.account && event.account !== input.stripeAccount) || event.context) {
    throw new ApiError(400, 'Stripe account mismatch')
  }
  const object = event.data.object
  const subscriptionId = event.type.startsWith('customer.subscription.')
    ? object.id : object.parent?.subscription_details?.subscription ?? object.subscription ?? null
  return input.record({
    stripe_account: input.stripeAccount,
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
