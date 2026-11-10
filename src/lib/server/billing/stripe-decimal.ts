import Stripe from 'stripe'
import { z } from 'zod'

/** Stripe's SDK decodes decimal fields before Pika checks the wire amount. */
function stripeDecimalText(value: unknown) {
  if (value === null || typeof value !== 'object') return value

  const sdkDecimal = Stripe.Decimal?.zero
  if (sdkDecimal && Object.getPrototypeOf(value) === Object.getPrototypeOf(sdkDecimal)) {
    return sdkDecimal.toString.call(value)
  }
  return value
}

export const stripeUnitAmountDecimalSchema = z.preprocess(stripeDecimalText,
  z.string().regex(/^\d+(?:\.0+)?$/).transform(value => value.replace(/\.0+$/, '')))

export const stripeSingleQuantityDecimalSchema = z.preprocess(stripeDecimalText, z.string().regex(/^1(?:\.0+)?$/))
