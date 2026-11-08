import { z } from 'zod'
import { CheckoutAttemptSchema, CheckoutClaimSchema, CheckoutOfferingSchema,
  CheckoutEligibilityError, CheckoutProviderContractError, publicCheckout,
  type CheckoutAttempt, type CheckoutFence, type CheckoutOffering, type CheckoutProvider, type CheckoutStore,
} from './checkout-contracts'
import { PRODUCTION_APP_ORIGIN } from './live-target'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const mutationResult = z.object({ status: z.enum(['saved', 'finished', 'lost_claim']) }).strict()
class CheckoutWriteDeadlineError extends Error {}
class CheckoutWritesPausedError extends Error {}

function pinnedOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Checkout return origin must be an isolated local runtime')
  }
  return url.origin
}

type CheckoutMode = { providerMode?: 'test' } | {
  providerMode: 'live'
  checkoutAdmissionEnabled: boolean
  providerWritesEnabled: boolean
  authorizeProviderWrite(fence: CheckoutFence): Promise<boolean>
}

export function createCheckoutService(input: {
  store: CheckoutStore; provider: CheckoutProvider; stripeAccount: string; returnOrigin: string
  validateOffering(offering: CheckoutOffering): { lookupKey: string } | null
  now?: () => number
} & CheckoutMode) {
  const providerMode = input.providerMode ?? 'test'
  const live = input.providerMode === 'live'
  if (live && input.returnOrigin !== PRODUCTION_APP_ORIGIN) throw new Error('Invalid live checkout return origin')
  const origin = live ? PRODUCTION_APP_ORIGIN : pinnedOrigin(input.returnOrigin)
  const providerWritesEnabled = live ? input.providerWritesEnabled : true
  const checkoutAdmissionEnabled = live ? input.checkoutAdmissionEnabled && providerWritesEnabled : true
  const now = input.now ?? Date.now
  const { store, provider } = input

  const returnUrls = (attemptId: string) => ({
    success_url: `${origin}/billing?checkout=${attemptId}&result=success`,
    cancel_url: `${origin}/billing?checkout=${attemptId}&result=cancel`,
  })
  const offeringMatches = (offering: CheckoutOffering) => offering.stripe_account === input.stripeAccount
    && (offering.provider_mode ?? 'test') === providerMode
  function attemptMatches(attempt: CheckoutAttempt): boolean {
    if (!offeringMatches(attempt.offering)) return false
    if (!live) return true
    const urls = returnUrls(attempt.attempt_id)
    return attempt.success_url === urls.success_url && attempt.cancel_url === urls.cancel_url
  }

  async function owned(subjectUserId: string, attemptId: string): Promise<CheckoutAttempt | null> {
    const raw = await store.getCheckout({ subject_user_id: subjectUserId, attempt_id: attemptId })
    if (raw === null) return null
    const result = CheckoutAttemptSchema.parse(raw)
    if (result.subject_user_id !== subjectUserId || result.attempt_id !== attemptId
      || !attemptMatches(result)) throw new Error('Checkout identity mismatch')
    return result
  }

  async function process(attemptId: string): Promise<void> {
    const claim = CheckoutClaimSchema.parse(await store.claimCheckout({ attempt_id: attemptId, lease_seconds: 120 }))
    if (claim.status !== 'claimed') return
    const attempt = claim.attempt
    if (attempt.attempt_id !== attemptId || !attemptMatches(attempt)) {
      throw new Error('Checkout claim identity mismatch')
    }
    const fence = { attempt_id: attemptId, lease_token: claim.lease_token, fencing_token: claim.fencing_token }
    const finish = async (outcome: Parameters<CheckoutStore['finishCheckout']>[0]['outcome'],
      detail: { subscription_id?: string; payment_pending?: boolean; reason_code?: string } = {}) => {
      mutationResult.parse(await store.finishCheckout({ ...fence, outcome, ...detail }))
    }
    const save = async (progress: { customer_id?: string; session_id?: string; checkout_url?: string | null }) => {
      const result = mutationResult.parse(await store.saveCheckoutProgress({ ...fence, ...progress }))
      return result.status !== 'lost_claim'
    }
    const canWrite = () => now() < Date.parse(attempt.write_deadline)
      && now() + 10_000 < Date.parse(claim.lease_expires_at)
    const assertCanWrite = async () => {
      if (!canWrite()) throw new CheckoutWriteDeadlineError()
      if (input.providerMode === 'live' && !await input.authorizeProviderWrite(fence)) throw new CheckoutWritesPausedError()
      if (!canWrite()) throw new CheckoutWriteDeadlineError()
    }
    try {
      // A known session can settle while provider writes are paused. A
      // reservation without a session must not create one during the pause.
      if (!providerWritesEnabled && !attempt.session_id) {
        if (now() >= Date.parse(attempt.write_deadline)) return await finish('attention', { reason_code: 'write_recovery_expired' })
        return await finish('paused', { reason_code: 'provider_writes_paused' })
      }
      await provider.assertAccount(input.stripeAccount)
      if (!attempt.customer_id) {
        if (!canWrite()) return await finish('attention', { reason_code: 'write_recovery_expired' })
        const key = `pika-checkout-customer-${attemptId}`
        const customerId = live ? await provider.createCustomer(key, assertCanWrite) : await provider.createCustomer(key)
        if (!await save({ customer_id: customerId })) return
        attempt.customer_id = customerId
      }
      if (!attempt.session_id) {
        if (!canWrite()) return await finish('attention', { reason_code: 'write_recovery_expired' })
        const key = `pika-checkout-session-${attemptId}`
        const session = live
          ? await provider.createSession(attempt, attempt.customer_id, key, assertCanWrite)
          : await provider.createSession(attempt, attempt.customer_id, key)
        if (!await save({ session_id: session.id, checkout_url: session.url })) return
        attempt.session_id = session.id
      }
      // Creation and redirect state never bind identity: retrieve the persisted session.
      const session = await provider.retrieveSession(attempt)
      if (session.id !== attempt.session_id || session.customerId !== attempt.customer_id) {
        throw new CheckoutProviderContractError()
      }
      if (session.status === 'expired') return await finish('expired')
      if (session.status === 'complete' && session.paymentStatus === 'paid') {
        if (!session.subscriptionId) throw new CheckoutProviderContractError()
        return await finish('bound', { subscription_id: session.subscriptionId })
      }
      await finish('pending', { payment_pending: session.status === 'complete' })
    } catch (error) {
      if (error instanceof CheckoutWriteDeadlineError) return await finish('attention', { reason_code: 'write_recovery_expired' })
      if (error instanceof CheckoutWritesPausedError) return await finish('paused', { reason_code: 'provider_writes_paused' })
      // No database/provider messages or object IDs cross this boundary.
      await finish(error instanceof CheckoutProviderContractError ? 'attention' : 'retry', {
        reason_code: error instanceof CheckoutProviderContractError ? 'provider_contract_invalid' : 'provider_unavailable',
      })
    }
  }

  return {
    async startCheckout(args: { subjectUserId: string; offeringVersionId: string; operationId: string }) {
      const subjectUserId = uuid.parse(args.subjectUserId)
      const offeringVersionId = uuid.parse(args.offeringVersionId)
      const attemptId = uuid.parse(args.operationId)
      let attempt = await owned(subjectUserId, attemptId)
      if (attempt && attempt.offering.offering_version_id !== offeringVersionId) throw new Error('Checkout operation conflict')
      if (!attempt) {
        if (!checkoutAdmissionEnabled) throw new CheckoutEligibilityError('New checkout is currently unavailable')
        const offering = CheckoutOfferingSchema.parse(await store.getCheckoutOffering({
          offering_version_id: offeringVersionId, stripe_account: input.stripeAccount,
        }))
        if (offering.offering_version_id !== offeringVersionId || !offeringMatches(offering)) {
          throw new Error('Checkout offering mismatch')
        }
        const catalog = input.validateOffering(offering)
        if (!catalog) throw new Error('Checkout offering is not in the approved launch catalog')
        attempt = CheckoutAttemptSchema.parse(await store.reserveCheckout({
          attempt_id: attemptId, subject_user_id: subjectUserId, offering, lookup_key: catalog.lookupKey,
          ...returnUrls(attemptId),
        }))
        if (attempt.attempt_id !== attemptId || attempt.subject_user_id !== subjectUserId
          || attempt.offering.offering_version_id !== offeringVersionId || !attemptMatches(attempt)) throw new Error('Checkout reservation mismatch')
      }
      await process(attemptId)
      const current = await owned(subjectUserId, attemptId)
      if (!current) throw new Error('Checkout reservation unavailable')
      return publicCheckout(current)
    },
    async getCheckout(args: { subjectUserId: string; attemptId: string }) {
      const attempt = await owned(uuid.parse(args.subjectUserId), uuid.parse(args.attemptId))
      return attempt ? publicCheckout(attempt) : null
    },
    async reconcileCheckouts(args: { limit: number }) {
      const limit = z.number().int().min(1).max(10).parse(args.limit)
      const work = z.object({ attempt_ids: z.array(uuid).max(10) }).strict()
        .parse(await store.listCheckoutWork({ limit }))
      if (work.attempt_ids.length > limit) throw new Error('Checkout work limit exceeded')
      let processed = 0
      let failed = 0
      for (const attemptId of work.attempt_ids) {
        try { await process(attemptId); processed++ } catch { failed++ }
      }
      return { processed, failed }
    },
  }
}
