import { z } from 'zod'
import { createBillingStripeClient } from '@/lib/server/billing/runtime'
import { verifyLiveStripeFullRefund } from '@/lib/server/billing/stripe-refund-provider'
import { createTargetBoundFetch, verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

const argsSchema = z.tuple([
  z.enum(['--dry-run', '--apply']),
  z.string().regex(/^sub_[A-Za-z0-9]{1,255}$/),
  z.string().regex(/^in_[A-Za-z0-9]{1,255}$/),
  z.uuid(),
])
const resultSchema = z.object({
  status: z.enum(['verified', 'applied', 'replayed', 'not_current_term']),
  access_ended_at: z.iso.datetime({ offset: true }).optional(),
})

async function main() {
  const args = argsSchema.safeParse(process.argv.slice(2))
  if (!args.success) {
    throw new Error('Usage: record-live-billing-refund.ts --dry-run|--apply <subscription-id> <invoice-id> <operation-uuid>')
  }
  const [action, stripeSubscriptionId, stripeInvoiceId, operationId] = args.data
  const stripeAccount = process.env.STRIPE_LIVE_ACCOUNT_ID
  const secretKey = process.env.STRIPE_LIVE_SECRET_KEY
  if (process.env.BILLING_SANDBOX_ENABLED === 'true' || !stripeAccount
    || !/^acct_[A-Za-z0-9]{1,255}$/.test(stripeAccount)
    || !secretKey || !/^rk_live_[A-Za-z0-9]{16,255}$/.test(secretKey)) {
    throw new Error('Use the pinned account and a restricted live Stripe key.')
  }
  const projectRef = 'zhioqbapgfcrronyuidm'
  const origin = verifyHostedSupabaseApiOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', projectRef)
  const evidence = await verifyLiveStripeFullRefund(createBillingStripeClient(secretKey), {
    stripeAccount, stripeSubscriptionId, stripeInvoiceId,
  })
  if (!evidence) {
    process.stdout.write(JSON.stringify({ status: 'provider_evidence_unverified' }) + '\n')
    process.exitCode = 1
    return
  }
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(origin) })
  const { data, error } = await client.rpc('billing_apply_live_full_refund_v1', {
    p_project_ref: projectRef,
    p_stripe_account: stripeAccount,
    p_request: { ...evidence, operation_id: operationId, apply: action === '--apply' },
  }).abortSignal(AbortSignal.timeout(10_000))
  if (error) throw new Error('Pika refund result unavailable. Use --dry-run to check the operation before retrying.')
  const result = resultSchema.parse(data)
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.status === 'not_current_term') process.exitCode = 1
}

void main().catch(() => {
  process.stderr.write('Refund verification or recording failed. Check the exact target and arguments, then use --dry-run to verify state.\n')
  process.exitCode = 1
})
