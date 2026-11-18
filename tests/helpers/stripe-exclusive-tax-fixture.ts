/** A single Ontario-taxable line under the pinned Stripe invoice shape. */
export function attachStripeExclusiveTax(
  subscription: { items: { data: { price: object }[] } },
  invoice: { subtotal: number; status: string; lines: { data: object[] } },
  tax = 260,
) {
  const base = invoice.subtotal
  const gross = base + tax
  const automaticTax = { enabled: true, liability: { type: 'self' }, disabled_reason: null }
  const entry = { amount: tax, tax_behavior: 'exclusive', type: 'tax_rate_details',
    tax_rate_details: { tax_rate: 'txr_fixture' }, taxable_amount: base, taxability_reason: 'standard_rated' }
  const line = invoice.lines.data[0]
  Object.assign(subscription, { automatic_tax: automaticTax })
  Object.assign(subscription.items.data[0].price, { tax_behavior: 'exclusive' })
  Object.assign(invoice, {
    automatic_tax: { ...automaticTax, status: 'complete', provider: 'stripe' },
    subtotal_excluding_tax: base, total_excluding_tax: base, total: gross, amount_due: gross,
    amount_shipping: 0, amount_overpaid: 0, total_pretax_credit_amounts: [], customer_address: { country: 'CA', state: 'ON' },
    total_taxes: [entry],
  })
  Object.assign(line, { subtotal: base, taxes: [structuredClone(entry)], pretax_credit_amounts: [] })
  return { base, gross, entry, line }
}
