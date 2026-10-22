import { z } from 'zod'
import { getTodayInSchedulingTimezone } from '@/lib/scheduling'

/** A published material's calendar day; future release remains a separate action. */
export const materialPostDateSchema = z.iso.date()
  .refine(value => !value.startsWith('0000-'), 'Post date must use a year from 0001 to 9999')
  .refine(value => value <= getTodayInSchedulingTimezone(), 'Post date cannot be in the future')
