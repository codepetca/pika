import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { reconcileBillingSubscriptions } from '@/lib/server/billing/reconcile'
import type { BillingProvider, BillingStore } from '@/lib/server/billing/synchronize'
import { acceptBillingWebhook, readBillingWebhookBody, type BillingEventReceipt } from '@/lib/server/billing/webhook'

export type BillingHandlerRuntime = {
  store: BillingStore
  provider: BillingProvider
  verify(raw: Buffer, signature: string): unknown
  record(receipt: BillingEventReceipt): Promise<unknown>
}

/** Runtime wiring is separate so no SDK/client is constructed while disabled. */
export function createBillingHandlers(
  configuration: () => { stripeAccount: string; workerSecret: string } | null,
  loadRuntime: () => Promise<BillingHandlerRuntime>,
  loadPurchases?: () => Promise<{ reconcileCheckouts(input: { limit: number }): Promise<unknown> } | null>,
) {
  function requireConfiguration() {
    const config = configuration()
    if (!config) throw new ApiError(404, 'Not found')
    return config
  }
  return {
    webhook: withErrorHandler('StripeBillingWebhook', async request => {
      const config = requireConfiguration()
      const raw = await readBillingWebhookBody(request)
      const runtime = await loadRuntime()
      await acceptBillingWebhook({ raw, signature: request.headers.get('stripe-signature'),
        stripeAccount: config.stripeAccount, verify: runtime.verify, record: runtime.record })
      return NextResponse.json({ received: true })
    }),
    process: withErrorHandler('StripeBillingWorker', async request => {
      const config = requireConfiguration()
      const expected = Buffer.from(`Bearer ${config.workerSecret}`)
      const actual = Buffer.from(request.headers.get('authorization') ?? '')
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new ApiError(401, 'Unauthorized')
      }
      const runtime = await loadRuntime()
      const result = await reconcileBillingSubscriptions({
        store: runtime.store, provider: runtime.provider, limit: 1, leaseSeconds: 120,
      })
      // A newly completed purchase is bound here; the next worker pass verifies
      // its captured invoice before applying paid access. Neither needs a redirect.
      const purchaseRuntime = loadPurchases ? await loadPurchases() : null
      const purchases = purchaseRuntime ? await purchaseRuntime.reconcileCheckouts({ limit: 1 }) : undefined
      return NextResponse.json(purchases ? { ...result, purchases } : result)
    }),
  }
}
