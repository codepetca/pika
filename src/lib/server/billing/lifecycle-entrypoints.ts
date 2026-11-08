import { requireRole } from '@/lib/auth'
import { readBillingPurchaseConfig } from './purchase-config'
import { createBillingLifecycleHandlers } from './lifecycle-handlers'
import { readBillingLivePaymentWorkerConfig, readBillingLiveTrialConfig } from './live-target'
import { createBillingLifecycleRuntime, createLiveTrialLifecycleRuntime } from './lifecycle-runtime'

export function readBillingLifecycleConfiguration() {
  const trial = readBillingLiveTrialConfig()
  const payment = readBillingLivePaymentWorkerConfig()
  if (payment) return { ...payment, admissionEnabled: trial?.admissionEnabled ?? false,
    checkoutAdmissionEnabled: payment.checkoutAdmissionEnabled && payment.providerWritesEnabled }
  if (trial) return { ...trial, checkoutAdmissionEnabled: false }
  return readBillingPurchaseConfig()
}

export const billingLifecycleHandlers = createBillingLifecycleHandlers({
  configuration: readBillingLifecycleConfiguration,
  authenticate: () => requireRole('teacher'),
  async loadRuntime() {
    const config = readBillingLifecycleConfiguration()
    if (!config) throw new Error('Billing lifecycle runtime is unavailable')
    if ('projectRef' in config) return createLiveTrialLifecycleRuntime(config)
    return createBillingLifecycleRuntime(config)
  },
})
