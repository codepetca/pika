import { z } from 'zod'
import { getTodayInSchedulingTimezone } from '@/lib/scheduling'

/** Civil date accepted by the editor; future days use the scheduling API. */
export const postDateInputSchema = z.iso.date()
  .refine(value => !value.startsWith('0000-'), 'Post date must use a year from 0001 to 9999')

/** Backdating API contract. Future editor dates must become scheduled_for. */
export const postDateSchema = postDateInputSchema
  .refine(value => value <= getTodayInSchedulingTimezone(), 'Post date cannot be in the future')
