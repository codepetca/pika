import { z } from 'zod'

/** A Toronto civil calendar day, independent of publication or scheduling. */
export const postDateSchema = z.iso.date()
  .refine(value => !value.startsWith('0000-'), 'Calendar date must use a year from 0001 to 9999')

export const postDateInputSchema = postDateSchema
