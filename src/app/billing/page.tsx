import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { AppShell } from '@/components/AppShell'
import { BillingPage } from './BillingPage'
import { isBillingPurchaseAvailable } from '@/lib/server/billing/purchase-config'
import { readBillingUpgradeConfig } from '@/lib/server/billing/upgrade-runtime'
import { readBillingPortalConfig } from '@/lib/server/billing/portal-config'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) redirect(await getServerLoginRedirectPath())
  if (user.role !== 'teacher') redirect('/classrooms')
  const billingAvailable = isBillingPurchaseAvailable()
  let portalAvailable = false
  if (billingAvailable) {
    try { portalAvailable = readBillingPortalConfig() !== null } catch { /* Keep checkout available. */ }
  }
  return <AppShell initialNow={Date.now()} user={{ id: user.id, email: user.email, role: user.role }}>
    <BillingPage
      key={user.id}
      userId={user.id}
      billingAvailable={billingAvailable}
      portalAvailable={portalAvailable}
      upgradesAvailable={billingAvailable && readBillingUpgradeConfig() !== null}
    />
  </AppShell>
}
