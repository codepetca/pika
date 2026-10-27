import { combineScheduleDateTimeToIso, getTodayInSchedulingTimezone } from '@/lib/scheduling'
import { postDateInputSchema } from '@/lib/validations/post-date'

type PostDateUpdate = { posted_on: string; scheduled_for?: never }
  | { scheduled_for: string; posted_on?: never }

/** Future date-only posts release at Toronto midnight through the existing schedule contract. */
export function getPostDateUpdate(value: string): PostDateUpdate {
  const date = postDateInputSchema.parse(value)
  return date > getTodayInSchedulingTimezone()
    ? { scheduled_for: combineScheduleDateTimeToIso(date, '00:00') }
    : { posted_on: date }
}
