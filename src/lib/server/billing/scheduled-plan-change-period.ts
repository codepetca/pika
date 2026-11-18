/** The target Stripe phase is anchored at its start in UTC and spans one cycle. */
export function scheduledTermEnd(effectiveAt: string, interval: 'month' | 'year'): number {
  const end = new Date(effectiveAt)
  const day = end.getUTCDate()
  end.setUTCMonth(end.getUTCMonth() + (interval === 'month' ? 1 : 12), 1)
  const month = end.getUTCMonth()
  end.setUTCDate(day)
  if (end.getUTCMonth() !== month) end.setUTCDate(0)
  return end.getTime()
}
