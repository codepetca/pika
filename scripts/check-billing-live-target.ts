import { checkBillingLiveTarget } from '@/lib/server/billing/live-target'
import { getServiceRoleClient } from '@/lib/supabase'

async function main() {
  const status = await checkBillingLiveTarget({
    environment: process.env,
    async read(args, fetch) {
      const { data, error } = await getServiceRoleClient({ fetch }).rpc('billing_attest_live_target_v1', args, { get: true })
      return error ? null : data
    },
  })
  process.stdout.write(JSON.stringify({ status }) + '\n')
  if (status !== 'attested') process.exitCode = 1
}

void main()
