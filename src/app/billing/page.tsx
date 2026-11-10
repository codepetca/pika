import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { AppShell } from '@/components/AppShell'
import { BillingPage } from './BillingPage'
import { isBillingPurchaseAvailable } from '@/lib/server/billing/purchase-config'
import { isBillingLiveTrialAvailable } from '@/lib/server/billing/live-target'
import { readBillingUpgradeConfig } from '@/lib/server/billing/upgrade-runtime'
import { readBillingPortalConfig } from '@/lib/server/billing/portal-config'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) redirect(await getServerLoginRedirectPath())
  if (user.role !== 'teacher') redirect('/classrooms')
  const purchaseAvailable = isBillingPurchaseAvailable()
  const billingAvailable = purchaseAvailable || isBillingLiveTrialAvailable()
  let portalAvailable = false
  if (purchaseAvailable) {
    try { portalAvailable = readBillingPortalConfig() !== null } catch { /* Keep checkout available. */ }
  }
  return <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role }} billingAvailable={billingAvailable}>
    <BillingPage
      key={user.id}
      userId={user.id}
      billingAvailable={billingAvailable}
      purchaseAvailable={purchaseAvailable}
      portalAvailable={portalAvailable}
      upgradesAvailable={purchaseAvailable && readBillingUpgradeConfig() !== null}
    />
  </AppShell>
}
