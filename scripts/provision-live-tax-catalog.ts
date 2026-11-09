import { createStripeBillingClient } from '@/lib/server/billing/runtime'
import { CatalogProvisioningError, createStripeCatalogProvisioningPorts, provisionLiveExclusiveTaxCatalog } from '@/lib/server/billing/provision-catalog'
import { createTargetBoundFetch, verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'

async function main() {
  const args = process.argv.slice(2)
  const actionFlags = args.filter(value => value === '--dry-run' || value === '--apply')
  const names = ['--tax-mode', '--account', '--pro-product', '--max-product', '--version-base', '--reviewed-tax-code']
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run' || arg === '--apply') continue
    if (!names.includes(arg) || values.has(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments_invalid')
    values.set(arg, args[++i])
  }
  if (actionFlags.length !== 1 || values.size !== names.length) throw new Error('arguments_invalid')
  const account = values.get('--account')!
  const key = process.env.STRIPE_LIVE_SECRET_KEY
  if (process.env.BILLING_SANDBOX_ENABLED === 'true' || account !== process.env.STRIPE_LIVE_ACCOUNT_ID
    || !key || !/^(?:sk|rk)_live_[A-Za-z0-9]{16,255}$/.test(key)) throw new Error('live_target_invalid')
  const projectRef = 'zhioqbapgfcrronyuidm'
  const origin = verifyHostedSupabaseApiOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', projectRef)
  const stripe = createStripeBillingClient(key)
  const stripePorts = createStripeCatalogProvisioningPorts(stripe, async () => { throw new Error('wrong_registration_port') })
  const result = await provisionLiveExclusiveTaxCatalog({
    ports: { ...stripePorts, async registerOffering(request) {
      const client = getServiceRoleClient({ fetch: createTargetBoundFetch(origin) })
      const { data, error } = await client.rpc('billing_register_live_checkout_offering_v1', {
        p_project_ref: projectRef, p_stripe_account: account, p_request: request as Json,
      }).abortSignal(AbortSignal.timeout(5_000))
      if (error) throw new Error('registration_unavailable')
      return data
    } },
    projectRef, stripeAccount: account, productIds: { pro: values.get('--pro-product'), max: values.get('--max-product') },
    releaseVersionBase: Number(values.get('--version-base')), taxMode: values.get('--tax-mode'),
    reviewedProductTaxCode: values.get('--reviewed-tax-code'), action: actionFlags[0].slice(2),
  })
  process.stdout.write(JSON.stringify(result) + '\n')
}

void main().catch(error => {
  process.stderr.write(JSON.stringify({ status: 'failed', code: error instanceof CatalogProvisioningError ? error.code : 'invalid_or_unavailable' }) + '\n')
  process.exitCode = 1
})
