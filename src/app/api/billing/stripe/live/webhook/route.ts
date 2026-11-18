import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { readBillingLiveWebhookConfig } from '@/lib/server/billing/live-target'
import { recordLiveBillingEvent } from '@/lib/server/billing/store'
import { acceptBillingWebhook, readBillingWebhookBody } from '@/lib/server/billing/webhook'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostLiveStripeBillingWebhook', async request => {
  const target = readBillingLiveWebhookConfig()
  if (!target) throw new ApiError(404, 'Not found')
  const raw = await readBillingWebhookBody(request)
  await acceptBillingWebhook({
    raw,
    signature: request.headers.get('stripe-signature'),
    stripeAccount: target.stripeAccount,
    providerMode: 'live',
    verify: (payload, signature) => Stripe.webhooks.constructEvent(payload, signature, target.webhookSecret),
    record: receipt => recordLiveBillingEvent({
      receipt,
      target,
      record: args => getServiceRoleClient({ fetch: createTargetBoundFetch(target.supabaseOrigin) })
        .rpc('billing_record_live_event_v1', args).abortSignal(AbortSignal.timeout(5_000)),
    }),
  })
  return NextResponse.json({ received: true })
})
