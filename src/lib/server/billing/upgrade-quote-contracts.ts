import { z } from 'zod'
import { BillingSubscriptionBindingSchema } from './contracts'
import { CheckoutOfferingSchema } from './checkout-contracts'

const time = z.string().datetime({ offset: true })
const reference = z.string().trim().min(1).max(255)
const signedMoney = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const money = signedMoney.nonnegative()
const tierRank = { basic: 0, plus: 1, pro: 2 } as const

export const UpgradeQuoteInputSchema = z.object({
  binding: BillingSubscriptionBindingSchema,
  target: CheckoutOfferingSchema,
  lifecycle: z.object({ paidPeriodStart: time, paidThrough: time, lastPaidInvoiceId: reference }).strict(),
  now: time,
}).strict()
export type UpgradeQuoteInput = z.infer<typeof UpgradeQuoteInputSchema>

const line = z.object({
  kind: z.enum(['old_credit', 'target_debit']), priceId: reference, subscriptionItemId: reference,
  amount: signedMoney, quantity: z.literal(1), periodStart: time, periodEnd: time,
}).strict()

/** Canonical data-only facts for later frozen-invoice confirmation; never evidence of payment. */
export const UpgradeQuoteFactsSchema = z.object({
  binding: BillingSubscriptionBindingSchema, target: CheckoutOfferingSchema,
  subscriptionItemId: reference, prorationDate: z.number().int().nonnegative().max(8640000000000),
  quotedAt: time, paidPeriodStart: time, paidThrough: time, expiresAt: time,
  unusedCreditAmount: signedMoney.nonpositive(), remainingChargeAmount: money, amountDue: money,
  currency: z.enum(['usd', 'cad']), nextRecurringAmount: money,
  lines: z.tuple([line, line]), paymentState: z.enum(['payment_required', 'zero_due']),
}).strict().superRefine((quote, context) => {
  const { binding, target } = quote
  const quotedAt = Date.parse(quote.quotedAt)
  const start = Date.parse(quote.paidPeriodStart)
  const end = Date.parse(quote.paidThrough)
  const [credit, debit] = quote.lines
  const sum = credit.amount + debit.amount
  const invalid = tierRank[target.plan_key] <= tierRank[binding.plan_key]
    || target.stripe_account !== binding.stripe_account || target.currency !== binding.currency
    || target.interval !== binding.interval || target.unit_amount <= binding.unit_amount
    || target.stripe_price_id === binding.stripe_price_id || target.offering_version_id === binding.offering_version_id
    || binding.unit_amount <= 0 || quote.currency !== binding.currency || quote.nextRecurringAmount !== target.unit_amount
    || start >= end || quotedAt < start || quotedAt >= end
    || quote.prorationDate !== Math.floor(quotedAt / 1000)
    || Date.parse(quote.expiresAt) !== Math.min(quotedAt + 15 * 60 * 1000, end)
    || credit.kind !== 'old_credit' || debit.kind !== 'target_debit'
    || credit.priceId !== binding.stripe_price_id || debit.priceId !== target.stripe_price_id
    || credit.subscriptionItemId !== quote.subscriptionItemId || debit.subscriptionItemId !== quote.subscriptionItemId
    || credit.amount !== quote.unusedCreditAmount || debit.amount !== quote.remainingChargeAmount
    || credit.amount < -binding.unit_amount || debit.amount > target.unit_amount
    || !Number.isSafeInteger(sum) || sum !== quote.amountDue
    || quote.paymentState !== (quote.amountDue === 0 ? 'zero_due' : 'payment_required')
    || quote.lines.some(item => Date.parse(item.periodStart) !== quote.prorationDate * 1000
      || Date.parse(item.periodEnd) !== end)
  if (invalid) context.addIssue({ code: 'custom', message: 'Upgrade quote facts are inconsistent' })
})
export type UpgradeQuoteFacts = z.infer<typeof UpgradeQuoteFactsSchema>
export type UpgradeQuoteProvider = { prepareQuote(input: UpgradeQuoteInput): Promise<UpgradeQuoteFacts> }

export class UpgradeQuoteContractError extends Error {
  constructor() { super('Upgrade quote provider contract is invalid') }
}
