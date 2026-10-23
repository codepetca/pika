import { z } from 'zod'
import { getTodayInSchedulingTimezone } from '@/lib/scheduling'

/** A published post's Toronto calendar day; future release is a separate action. */
export const postDateSchema = z.iso.date()
  .refine(value => !value.startsWith('0000-'), 'Post date must use a year from 0001 to 9999')
  .refine(value => value <= getTodayInSchedulingTimezone(), 'Post date cannot be in the future')
