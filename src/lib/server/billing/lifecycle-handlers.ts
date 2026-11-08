import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { BillingSubscriptionStatusSchema } from '@/lib/billing/subscription'
import { BillingAccessStatusSchema, type BillingAccessStatus } from './lifecycle-contracts'
import { BillingLifecycleEligibilityError } from './lifecycle-service'

const trialRequest = z.object({ operationId: z.string().uuid() }).strict()
export type BillingLifecycleRuntime = {
  startTrial(input: { subjectUserId: string; operationId: string }): Promise<BillingAccessStatus>
  getStatus(input: { subjectUserId: string }): Promise<BillingAccessStatus>
  applyDue(input: { limit: number }): Promise<{ processed: number }>
}
function response(raw: unknown, subjectUserId: string, admissionEnabled: boolean) {
  const result = BillingAccessStatusSchema.safeParse(raw)
  if (!result.success || result.data.subject_user_id !== subjectUserId) throw new Error('Billing status is unavailable')
  const value = result.data
  const options = value.customer_options
  const terms = options?.paid_terms
  const plan = value.plan_key === 'plus' ? 'pro' : value.plan_key === 'pro' ? 'max' : value.plan_key
  return NextResponse.json(BillingSubscriptionStatusSchema.parse({
    state: value.state, plan, classroomLimit: value.classroom_limit,
    accessEndsAt: value.access_ends_at, renewalAt: value.renewal_at,
    canStartPaidWork: value.can_start_paid_work, retryable: value.retryable,
    ...(options ? { options: {
      trialAvailable: admissionEnabled && options.trial_available, checkoutAvailable: options.checkout_available,
      hasBillingCustomer: options.has_billing_customer,
      pendingCheckoutId: options.pending_checkout_id,
      paidTerms: terms ? {
        currency: terms.currency, interval: terms.interval, unitAmount: terms.unit_amount, upgradeAvailable: terms.upgrade_available,
      } : null,
    } } : {}),
  }), { headers: { 'Cache-Control': 'private, no-store' } })
}
export function createBillingLifecycleHandlers(deps: {
  configuration(): { appOrigin: string; admissionEnabled?: boolean } | null
  authenticate(): Promise<{ id: string }>
  loadRuntime(): Promise<BillingLifecycleRuntime>
}) {
  function configuration() {
    const config = deps.configuration()
    if (!config) throw new ApiError(404, 'Not found')
    return config
  }
  return {
    status: withErrorHandler('BillingSubscriptionStatus', async () => {
      const config = configuration()
      const user = await deps.authenticate()
      const runtime = await deps.loadRuntime()
      return response(await runtime.getStatus({ subjectUserId: user.id }), user.id, config.admissionEnabled !== false)
    }),
    trial: withErrorHandler('BillingTrialStart', async request => {
      const config = configuration()
      if (config.admissionEnabled === false) throw new ApiError(404, 'Not found')
      const user = await deps.authenticate()
      if (request.headers.get('origin') !== config.appOrigin) throw new ApiError(403, 'Invalid request origin')
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'Expected JSON request')
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
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ApiError(400, 'Malformed JSON body') }
      const input = trialRequest.parse(body)
      const runtime = await deps.loadRuntime()
      try {
        return response(await runtime.startTrial({ subjectUserId: user.id, operationId: input.operationId }), user.id, true)
      } catch (error) {
        if (error instanceof BillingLifecycleEligibilityError) throw new ApiError(409, error.message)
        throw error
      }
    }),
  }
}
