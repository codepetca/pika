import { z } from 'zod'
import { CheckoutAttemptSchema, CheckoutClaimSchema, CheckoutOfferingSchema,
  CheckoutProviderContractError, publicCheckout,
  type CheckoutAttempt, type CheckoutOffering, type CheckoutProvider, type CheckoutStore,
} from './checkout-contracts'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const mutationResult = z.object({ status: z.enum(['saved', 'finished', 'lost_claim']) }).strict()

function pinnedOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Checkout return origin must be an isolated local runtime')
  }
  return url.origin
}

export function createCheckoutService(input: {
  store: CheckoutStore; provider: CheckoutProvider; stripeAccount: string; returnOrigin: string
  validateOffering(offering: CheckoutOffering): { lookupKey: string } | null
  now?: () => number
}) {
  const origin = pinnedOrigin(input.returnOrigin)
  const now = input.now ?? Date.now
  const { store, provider } = input

  async function owned(subjectUserId: string, attemptId: string): Promise<CheckoutAttempt | null> {
    const raw = await store.getCheckout({ subject_user_id: subjectUserId, attempt_id: attemptId })
    if (raw === null) return null
    const result = CheckoutAttemptSchema.parse(raw)
    if (result.subject_user_id !== subjectUserId || result.attempt_id !== attemptId
      || result.offering.stripe_account !== input.stripeAccount) throw new Error('Checkout identity mismatch')
    return result
  }

  async function process(attemptId: string): Promise<void> {
    const claim = CheckoutClaimSchema.parse(await store.claimCheckout({ attempt_id: attemptId, lease_seconds: 120 }))
    if (claim.status !== 'claimed') return
    const attempt = claim.attempt
    if (attempt.attempt_id !== attemptId || attempt.offering.stripe_account !== input.stripeAccount) {
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
    try {
      await provider.assertAccount(input.stripeAccount)
      if (!attempt.customer_id) {
        if (!canWrite()) return await finish('attention', { reason_code: 'write_recovery_expired' })
        const customerId = await provider.createCustomer(`pika-checkout-customer-${attemptId}`)
        if (!await save({ customer_id: customerId })) return
        attempt.customer_id = customerId
      }
      if (!attempt.session_id) {
        if (!canWrite()) return await finish('attention', { reason_code: 'write_recovery_expired' })
        const session = await provider.createSession(attempt, attempt.customer_id, `pika-checkout-session-${attemptId}`)
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
        const offering = CheckoutOfferingSchema.parse(await store.getCheckoutOffering({
          offering_version_id: offeringVersionId, stripe_account: input.stripeAccount,
        }))
        if (offering.offering_version_id !== offeringVersionId || offering.stripe_account !== input.stripeAccount) {
          throw new Error('Checkout offering mismatch')
        }
        const catalog = input.validateOffering(offering)
        if (!catalog) throw new Error('Checkout offering is not in the approved launch catalog')
        attempt = CheckoutAttemptSchema.parse(await store.reserveCheckout({
          attempt_id: attemptId, subject_user_id: subjectUserId, offering, lookup_key: catalog.lookupKey,
          success_url: `${origin}/billing?checkout=${attemptId}&result=success`,
          cancel_url: `${origin}/billing?checkout=${attemptId}&result=cancel`,
        }))
        if (attempt.attempt_id !== attemptId || attempt.subject_user_id !== subjectUserId
          || attempt.offering.offering_version_id !== offeringVersionId) throw new Error('Checkout reservation mismatch')
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
