import { z } from 'zod'
import type { BillingProviderSubscriptionSnapshot, BillingReconciliationBinding } from './contracts'

export const stripeExclusiveTaxModeSchema = z.literal('stripe_exclusive')

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const merchantLiability = z.object({ type: z.literal('self'), account: z.null().optional() })
export const stripeMerchantAutomaticTaxSchema = z.object({
  enabled: z.literal(true),
  liability: merchantLiability.nullish(),
  disabled_reason: z.null().optional(),
})

const exclusiveTaxEntry = z.object({
  amount: money,
  type: z.literal('tax_rate_details'),
  tax_behavior: z.literal('exclusive'),
  tax_rate_details: z.object({ tax_rate: z.string().min(1).max(255) }).nullable(),
  taxable_amount: money.nullable(),
  taxability_reason: z.enum(['standard_rated', 'reduced_rated', 'customer_exempt', 'not_collecting',
    'not_subject_to_tax', 'product_exempt', 'product_exempt_holiday', 'reverse_charge', 'zero_rated']),
})
const taxEntries = z.array(exclusiveTaxEntry).max(100).nullable()
const noCredits = z.array(z.never()).nullish()

const stripeInvoiceTaxSchema = z.object({
  automatic_tax: stripeMerchantAutomaticTaxSchema.extend({
    provider: z.literal('stripe').nullish(),
    status: z.enum(['complete', 'failed', 'requires_location_inputs']).nullable(),
  }),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  subtotal: money,
  subtotal_excluding_tax: money.nullable(),
  total_excluding_tax: money.nullable(),
  total: money,
  amount_due: money,
  amount_shipping: z.literal(0),
  amount_overpaid: z.literal(0).optional(),
  total_pretax_credit_amounts: noCredits,
  customer_address: z.object({ country: z.string().regex(/^[A-Z]{2}$/) }).nullable(),
  total_taxes: taxEntries,
  lines: z.object({ data: z.tuple([z.object({
    amount: money, subtotal: money, taxes: taxEntries, pretax_credit_amounts: noCredits,
  })]) }),
})

export const exclusiveInvoiceTaxEvidenceSchema = z.object({
  status: z.enum(['complete', 'pending']),
  subtotal: money,
}).strict()

export function usesStripeExclusiveTax(binding: BillingReconciliationBinding): boolean {
  return binding.provider_mode === 'live' && binding.tax_mode === 'stripe_exclusive'
}

export function matchesSubscriptionTax(binding: BillingReconciliationBinding, snapshot: BillingProviderSubscriptionSnapshot): boolean {
  return usesStripeExclusiveTax(binding)
    ? snapshot.automaticTaxEnabled === true && snapshot.items.every(item => item.priceTaxBehavior === 'exclusive')
    : !snapshot.automaticTaxEnabled
}

/** Normalize tax only after checking the pinned provider's invoice and its sole line. */
export function readExclusiveStripeInvoiceTax(raw: unknown): z.infer<typeof exclusiveInvoiceTaxEvidenceSchema> | null {
  const parsed = stripeInvoiceTaxSchema.safeParse(raw)
  if (!parsed.success) return null
  const invoice = parsed.data
  const line = invoice.lines.data[0]
  const subtotal = invoice.subtotal
  const totals = invoice.total_taxes ?? []
  const lineTaxes = line.taxes ?? []
  if (subtotal <= 0 || line.subtotal !== subtotal || line.amount !== subtotal || invoice.amount_due !== invoice.total) return null

  if (invoice.automatic_tax.status !== 'complete') {
    if (invoice.status !== 'draft' || totals.length !== 0 || lineTaxes.length !== 0 || invoice.total !== subtotal
      || (invoice.subtotal_excluding_tax !== null && invoice.subtotal_excluding_tax !== subtotal)
      || (invoice.total_excluding_tax !== null && invoice.total_excluding_tax !== subtotal)) return null
    return { status: 'pending', subtotal }
  }

  if (!invoice.customer_address || invoice.subtotal_excluding_tax !== subtotal
    || invoice.total_excluding_tax !== subtotal || totals.length !== lineTaxes.length) return null
  const validEntry = (entry: z.infer<typeof exclusiveTaxEntry>) => {
    if (entry.amount > 0) return entry.tax_rate_details !== null && entry.taxable_amount === subtotal
      && ['standard_rated', 'reduced_rated'].includes(entry.taxability_reason)
    return entry.taxable_amount === null || entry.taxable_amount <= subtotal
  }
  if (!totals.every(validEntry) || !lineTaxes.every(validEntry)) return null
  // In a one-line invoice the invoice tax breakdown must match the line.
  const canonical = (entries: typeof totals) => entries.map(entry => JSON.stringify([
    entry.tax_rate_details?.tax_rate, entry.taxability_reason, entry.taxable_amount, entry.amount,
  ])).sort()
  const totalEntries = canonical(totals)
  if (!canonical(lineTaxes).every((entry, index) => entry === totalEntries[index])) return null
  const tax = totals.reduce((sum, entry) => sum + entry.amount, 0)
  // A Canadian taxable sale needs an explicit Stripe explanation for a zero charge.
  if (invoice.customer_address.country === 'CA' && tax === 0
    && !totals.some(entry => ['customer_exempt', 'product_exempt', 'product_exempt_holiday', 'zero_rated'].includes(entry.taxability_reason))) return null
  if (!Number.isSafeInteger(subtotal + tax) || invoice.total !== subtotal + tax) return null
  return { status: 'complete', subtotal }
}

type Invoice = NonNullable<BillingProviderSubscriptionSnapshot['latestInvoice']>

/** Verify the collectible gross independently of the immutable pre-tax plan price. */
export function verifiedInvoiceGross(binding: BillingReconciliationBinding, invoice: Invoice, allowDraftTaxPending = false): number | null {
  const base = binding.unit_amount
  if (base <= 0 || invoice.subtotal !== base || invoice.amountDue !== invoice.total
    || invoice.startingBalance !== 0 || (invoice.endingBalance !== 0 && !(invoice.status === 'draft' && invoice.endingBalance === null))
    || invoice.hasDiscounts || invoice.totalDiscountAmount !== 0
    || invoice.prePaymentCreditNotesAmount !== 0 || invoice.postPaymentCreditNotesAmount !== 0) return null
  if (!usesStripeExclusiveTax(binding)) {
    return !invoice.exclusiveTax && !invoice.hasTaxes && invoice.totalTaxAmount === 0 && invoice.total === base ? base : null
  }

  const evidence = invoice.exclusiveTax
  if (!evidence || evidence.subtotal !== base) return null
  if (evidence.status === 'pending') {
    return allowDraftTaxPending && invoice.status === 'draft' && invoice.totalTaxAmount === 0
      && !invoice.hasTaxes && invoice.total === base ? base : null
  }
  const gross = base + invoice.totalTaxAmount
  return Number.isSafeInteger(gross) && invoice.total === gross
    && (invoice.totalTaxAmount === 0 || invoice.hasTaxes) ? gross : null
}
