import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
/** Preserve duplicates for rejection instead of collapsing URLSearchParams. */
export const studentNotificationsQuerySchema = z.array(z.tuple([z.string(), z.string()]))
  .length(1).transform(entries => Object.fromEntries(entries))
  .pipe(z.object({ classroom_id: uuid }).strict())

export const notificationUuidSchema = z.string().uuid().refine(value => value === value.toLowerCase())
export const notificationTimestampSchema = z.string().datetime({ offset: true })
  .refine(value => Number.isFinite(Date.parse(value)))
