import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const billingUpgradeRequestSchema = z.object({ operationId: uuid, offeringVersionId: uuid }).strict()
export const billingUpgradeConfirmSchema = z.object({ operationId: uuid,
  quoteRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quoteDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const billingUpgradeIdSchema = uuid

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const publicQuoteSchema = z.object({
  plan: z.enum(['basic', 'pro', 'max']), currency: z.enum(['usd', 'cad']),
  unusedCreditAmount: z.number().int().nonpositive().min(Number.MIN_SAFE_INTEGER),
  remainingChargeAmount: money, amountDue: money.positive(),
  nextRenewalAt: z.string().datetime({ offset: true }), nextRecurringAmount: money.positive(),
  expiresAt: z.string().datetime({ offset: true }), quoteRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(quote => quote.unusedCreditAmount + quote.remainingChargeAmount === quote.amountDue
  && quote.remainingChargeAmount <= quote.nextRecurringAmount
  && Date.parse(quote.expiresAt) <= Date.parse(quote.nextRenewalAt), 'Invalid public quote amounts or period')
export const publicBillingUpgradeSchema = z.object({ operationId: uuid,
  status: z.enum(['pending', 'quoted', 'payment_pending', 'synchronizing', 'active', 'expired', 'attention']),
  quote: publicQuoteSchema.nullable(),
}).strict().refine(result => (result.status === 'quoted') === (result.quote !== null), 'Invalid public upgrade quote state')
export type PublicBillingUpgrade = z.infer<typeof publicBillingUpgradeSchema>
