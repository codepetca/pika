import Stripe from 'stripe'
import { z } from 'zod'

/** Fresh, read-only admission proof; never used to block recovery of existing attempts. */
export async function isStripeTaxReady(stripe: Stripe, account: string): Promise<boolean> {
  try {
    const [merchant, settings, registrations] = await Promise.all([
      stripe.accounts.retrieve(null), stripe.tax.settings.retrieve(),
      stripe.tax.registrations.list({ status: 'active', limit: 100 }),
    ])
    const accountResult = z.object({ id: z.literal(account) }).safeParse(merchant)
    const settingsResult = z.object({ livemode: z.literal(true), status: z.literal('active'),
      defaults: z.object({ provider: z.literal('stripe') }) }).safeParse(settings)
    const registrationResult = z.object({ has_more: z.literal(false), data: z.array(z.object({
      livemode: z.literal(true), status: z.literal('active'), country: z.string(),
      active_from: z.number(), expires_at: z.number().nullable(),
      country_options: z.object({ ca: z.object({ type: z.string() }).optional() }),
    })) }).safeParse(registrations)
    const now = Math.floor(Date.now() / 1000)
    return accountResult.success && settingsResult.success && registrationResult.success
      && registrationResult.data.data.some(registration => registration.country === 'CA'
        && registration.country_options.ca?.type === 'standard' && registration.active_from <= now
        && (registration.expires_at === null || registration.expires_at > now))
  } catch { return false }
}
