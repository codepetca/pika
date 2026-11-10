import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { BILLING_ACCESS_NOTICE_HEADER, BillingSubscriptionStatusSchema, type BillingAccessNotice } from '@/lib/billing/subscription'
import { BillingAccessStatusSchema, type BillingAccessStatus } from './lifecycle-contracts'
import { BillingLifecycleEligibilityError } from './lifecycle-service'

const trialRequest = z.object({ operationId: z.string().uuid() }).strict()
export type BillingLifecycleRuntime = {
  startTrial(input: { subjectUserId: string; operationId: string }): Promise<BillingAccessStatus>
  getStatus(input: { subjectUserId: string }): Promise<BillingAccessStatus>
  applyDue(input: { limit: number }): Promise<{ processed: number }>
}
const hour = 60 * 60 * 1000

function getBillingAccessNotice(status: BillingAccessStatus, now: number): BillingAccessNotice | undefined {
  if (!status.access_ends_at || status.renewal_at) return
  const remaining = Date.parse(status.access_ends_at) - now
  if (remaining <= 0) return status.state === 'free' ? 'ended' : undefined
  if (status.state === 'renewal_grace') return 'payment_overdue'
  if (status.state !== 'trial' && status.state !== 'paid') return
  if (remaining <= 24 * hour) return 'ending_within_24_hours'
  if (remaining <= 7 * 24 * hour) return 'ending_within_seven_days'
}

function response(raw: unknown, subjectUserId: string, admissionEnabled: boolean, checkoutAdmissionEnabled: boolean, includeNotice = false) {
  const result = BillingAccessStatusSchema.safeParse(raw)
  if (!result.success || result.data.subject_user_id !== subjectUserId) throw new Error('Billing status is unavailable')
  const value = result.data
  const options = value.customer_options
  const terms = options?.paid_terms
  const plan = value.plan_key === 'plus' ? 'pro' : value.plan_key === 'pro' ? 'max' : value.plan_key
  return NextResponse.json(BillingSubscriptionStatusSchema.parse({
    state: value.state, plan, classroomLimit: value.classroom_limit,
    accessEndsAt: value.access_ends_at, renewalAt: value.renewal_at,
    ...(includeNotice && { accessNotice: getBillingAccessNotice(value, Date.now()) }),
    canStartPaidWork: value.can_start_paid_work, retryable: value.retryable,
    ...(options ? { options: {
      trialAvailable: admissionEnabled && options.trial_available,
      checkoutAvailable: checkoutAdmissionEnabled && options.checkout_available,
      hasBillingCustomer: options.has_billing_customer,
      pendingCheckoutId: options.pending_checkout_id,
      paidTerms: terms ? {
        currency: terms.currency, interval: terms.interval, unitAmount: terms.unit_amount, upgradeAvailable: terms.upgrade_available,
      } : null,
    } } : {}),
  }), { headers: { 'Cache-Control': 'private, no-store' } })
}
export function createBillingLifecycleHandlers(deps: {
  configuration(): { appOrigin: string; admissionEnabled?: boolean; checkoutAdmissionEnabled?: boolean } | null
  authenticate(): Promise<{ id: string }>
  loadRuntime(): Promise<BillingLifecycleRuntime>
}) {
  function configuration() {
    const config = deps.configuration()
    if (!config) throw new ApiError(404, 'Not found')
    return config
  }
  return {
    status: withErrorHandler('BillingSubscriptionStatus', async request => {
      const config = configuration()
      const user = await deps.authenticate()
      const runtime = await deps.loadRuntime()
      return response(await runtime.getStatus({ subjectUserId: user.id }), user.id,
        config.admissionEnabled !== false, config.checkoutAdmissionEnabled !== false,
        request.headers.get(BILLING_ACCESS_NOTICE_HEADER) === '1')
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
        return response(await runtime.startTrial({ subjectUserId: user.id, operationId: input.operationId }), user.id,
          true, config.checkoutAdmissionEnabled !== false)
      } catch (error) {
        if (error instanceof BillingLifecycleEligibilityError) throw new ApiError(409, error.message)
        throw error
      }
    }),
  }
}
