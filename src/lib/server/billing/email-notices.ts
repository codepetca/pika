import { z } from 'zod'
import { sendBrevoEmail } from '@/lib/brevo'
import { billingDate } from '@/lib/billing/subscription'
import type { getServiceRoleClient } from '@/lib/supabase'
import { PRODUCTION_APP_ORIGIN, type BillingLiveTrialConfig } from './live-target'
import { runOptionalRecoveryLane } from './recovery-lane'

const noticeSchema = z.object({
  id: z.string().uuid(),
  claim_token: z.string().uuid(),
  recipient: z.email().max(254),
  kind: z.enum(['cancellation', 'renewal_failed', 'ending_7_days', 'ending_24_hours', 'expired']),
  source: z.enum(['trial', 'paid']),
  access_ends_at: z.string().datetime({ offset: true }),
}).strict()
const attentionSchema = z.number().int().nonnegative()
const claimSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('disabled'), attention: attentionSchema }).strict(),
  z.object({ status: z.literal('empty'), attention: attentionSchema }).strict(),
  z.object({ status: z.literal('claimed'), attention: attentionSchema, notice: noticeSchema }).strict(),
])
const finishSchema = z.object({ status: z.enum(['sent', 'attention', 'stale']) }).strict()

type Notice = z.infer<typeof noticeSchema>
type Finish = { id: string; claim_token: string; outcome: 'sent' | 'attention' }
type NoticePorts = {
  claim(): Promise<unknown>
  finish(input: Finish): Promise<unknown>
  send(message: { to: string; subject: string; textContent: string; tags: string[] }): Promise<{ messageId?: string }>
}

function renderNotice(notice: Notice) {
  const date = billingDate(notice.access_ends_at, true)
  const access = notice.source === 'trial' ? 'Your Pika Pro trial' : 'Your paid Pika access'
  const details = {
    cancellation: {
      subject: 'Your Pika subscription will end',
      body: `Your subscription is set to stop renewing. You can use paid features until ${date}.`,
    },
    renewal_failed: {
      subject: 'Update your Pika payment method',
      body: `Your renewal payment did not go through. Your paid access ends ${date} unless the payment succeeds.`,
    },
    ending_7_days: {
      subject: `${access} ends soon`,
      body: `${access} ends ${date}.`,
    },
    ending_24_hours: {
      subject: `${access} ends within 24 hours`,
      body: `${access} ends ${date}.`,
    },
    expired: {
      subject: 'Your access to paid Pika features ended',
      body: `Access to paid features ended ${date}. Starting new paid classroom work or new RepoLight analysis requires an eligible plan.`,
    },
  }[notice.kind]
  const action = notice.kind === 'renewal_failed' ? 'Update your payment method' : 'Open Plans and billing'
  return {
    to: notice.recipient,
    subject: details.subject,
    textContent: `${details.body}\n\nExisting student work remains available.\n\n${action}\n${PRODUCTION_APP_ORIGIN}/billing`,
    tags: [`pika-billing-${notice.id}`],
  }
}

/** A claim commits the single send attempt before returning its recipient. */
export async function deliverBillingEmailNotices(ports: NoticePorts) {
  const result = { processed: 0, sent: 0, attention: 0 }
  for (let attempt = 0; attempt < 2; attempt++) {
    const claim = claimSchema.safeParse(await ports.claim())
    if (!claim.success) throw new Error('Billing email claim is invalid')
    result.attention += claim.data.attention
    if (claim.data.status !== 'claimed') break

    const { notice } = claim.data
    result.processed++
    let outcome: Finish['outcome'] = 'attention'
    try {
      const receipt = await ports.send(renderNotice(notice))
      if (typeof receipt.messageId === 'string' && receipt.messageId.trim()) outcome = 'sent'
    } catch {
      // A transport failure can occur after acceptance. Preserve the attempt
      // for operator review and never issue a second send automatically.
    }
    const finish = finishSchema.safeParse(await ports.finish({
      id: notice.id, claim_token: notice.claim_token, outcome,
    }))
    if (!finish.success) throw new Error('Billing email completion is invalid')
    if (outcome === 'sent' && finish.data.status === 'sent') result.sent++
    else result.attention++
  }
  return result
}

export async function processLiveBillingEmailNotices(
  client: ReturnType<typeof getServiceRoleClient>,
  config: Pick<BillingLiveTrialConfig, 'projectRef' | 'stripeAccount' | 'appOrigin'>,
) {
  if (process.env.BILLING_LIVE_EMAIL_NOTICES_ENABLED !== 'true') return undefined
  return runOptionalRecoveryLane(async () => {
    if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production'
      || process.env.ENABLE_MOCK_EMAIL === 'true' || config.appOrigin !== PRODUCTION_APP_ORIGIN
      || !process.env.BREVO_API_KEY?.trim()) throw new Error('Billing email delivery is unavailable')

    const scope = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
    return deliverBillingEmailNotices({
      async claim() {
        const { data, error } = await client.rpc('billing_claim_live_email_notice_v1', scope)
          .abortSignal(AbortSignal.timeout(3_000))
        if (error) throw new Error('Billing email claim is unavailable')
        return data
      },
      async finish(input) {
        const { data, error } = await client.rpc('billing_finish_live_email_notice_v1', { ...scope, p_request: input })
          .abortSignal(AbortSignal.timeout(3_000))
        if (error) throw new Error('Billing email completion is unavailable')
        return data
      },
      send: message => sendBrevoEmail({ ...message, signal: AbortSignal.timeout(5_000) }),
    })
  })
}
