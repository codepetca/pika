import Stripe from 'stripe'
import { z } from 'zod'

/** Stripe's SDK decodes decimal fields before Pika checks the wire amount. */
export const stripeUnitAmountDecimalSchema = z.preprocess(value => {
  if (value === null || typeof value !== 'object') return value

  const sdkDecimal = Stripe.Decimal?.zero
  if (sdkDecimal && Object.getPrototypeOf(value) === Object.getPrototypeOf(sdkDecimal)) {
    return sdkDecimal.toString.call(value)
  }
  return value
}, z.string().regex(/^\d+(?:\.0+)?$/).transform(value => value.replace(/\.0+$/, '')))
