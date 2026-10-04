import { z } from 'zod'

/** A retry names the original Toronto calendar date, including after midnight. */
export const summaryRetryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})

export const summaryRetryClassroomSchema = z.string().uuid().transform((value) => value.toLowerCase()).optional()
