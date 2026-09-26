import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'

const checkoutRequestSchema = z.object({
  offeringVersionId: z.string().uuid(),
  operationId: z.string().uuid(),
}).strict()
const attemptIdSchema = z.string().uuid()
const publicCatalogItemSchema = z.object({
  offeringVersionId: z.string().uuid(),
  plan: z.enum(['basic', 'pro', 'max']),
  name: z.enum(['Basic', 'Pro', 'Max']),
  currency: z.enum(['usd', 'cad']),
  interval: z.enum(['month', 'year']),
  unitAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  classroomLimit: z.number().int().positive(),
}).strict()
const checkoutUrlSchema = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com'
    && !url.username && !url.password && !url.port
}, 'Invalid checkout destination')
const publicCheckoutSchema = z.object({
  attemptId: attemptIdSchema,
  status: z.enum(['pending', 'checkout_open', 'payment_pending', 'synchronizing', 'active', 'expired', 'attention']),
  checkoutUrl: checkoutUrlSchema.nullable(),
}).strict()

export type BillingCatalogItem = z.infer<typeof publicCatalogItemSchema>
export type BillingPurchaseStatus = z.infer<typeof publicCheckoutSchema>
export type BillingPurchaseRuntime = {
  listCatalog(subjectUserId: string): Promise<BillingCatalogItem[]>
  startCheckout(input: {
    subjectUserId: string; offeringVersionId: string; operationId: string
  }): Promise<BillingPurchaseStatus>
  getCheckout(input: { subjectUserId: string; attemptId: string }): Promise<BillingPurchaseStatus | null>
}

/** Cookie-authenticated purchase endpoints; redirects are never payment proof. */
export function createBillingPurchaseHandlers(deps: {
  configuration(): { appOrigin: string } | null
  authenticate(): Promise<{ id: string }>
  loadRuntime(): Promise<BillingPurchaseRuntime>
}) {
  function configuration() {
    const config = deps.configuration()
    if (!config) throw new ApiError(404, 'Not found')
    return config
  }
  const json = (value: unknown) => NextResponse.json(value, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
  return {
    catalog: withErrorHandler('BillingCatalog', async () => {
      configuration()
      const user = await deps.authenticate()
      const runtime = await deps.loadRuntime()
      const items = z.array(publicCatalogItemSchema).max(12).parse(await runtime.listCatalog(user.id))
      return json({ items })
    }),
    start: withErrorHandler('BillingCheckoutStart', async request => {
      const config = configuration()
      const user = await deps.authenticate()
      if (request.headers.get('origin') !== config.appOrigin) {
        throw new ApiError(403, 'Invalid request origin')
      }
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new ApiError(415, 'Expected JSON request')
      }
      // Bound the actual stream, including requests without Content-Length.
      const reader = request.body?.getReader()
      if (!reader) throw new ApiError(400, 'Missing request body')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 4096) {
            await reader.cancel()
            throw new ApiError(413, 'Request body is too large')
          }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        throw new ApiError(400, 'Malformed JSON body')
      }
      const input = checkoutRequestSchema.parse(body)
      const runtime = await deps.loadRuntime()
      const result = publicCheckoutSchema.parse(await runtime.startCheckout({
        ...input, subjectUserId: user.id,
      }))
      return json(result)
    }),
    status: withErrorHandler('BillingCheckoutStatus', async (_request, context) => {
      configuration()
      const user = await deps.authenticate()
      const attemptId = attemptIdSchema.parse((await context.params).id)
      const runtime = await deps.loadRuntime()
      const result = await runtime.getCheckout({ subjectUserId: user.id, attemptId })
      if (!result) throw new ApiError(404, 'Not found')
      return json(publicCheckoutSchema.parse(result))
    }),
  }
}
