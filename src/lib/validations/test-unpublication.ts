import { z } from 'zod'
import { testCalendarDateSchema } from '@/lib/validations/test-calendar-date'
import { contextualTestListTestSchema } from '@/lib/validations/contextual-test-list-read'

const uuid = z.string().uuid().transform(value => value.toLowerCase())

export const testUnpublicationParamsSchema = z.object({ id: uuid }).strict()
export const testUnpublicationBodySchema = z.object({}).strict()
export const testUnpublicationResultSchema = z.object({
  // Legacy acknowledgements must work before and after the calendar column rollout.
  test: contextualTestListTestSchema.extend({ status: z.literal('draft'), test_date: testCalendarDateSchema.optional() }),
  draft_version: z.number().int().positive().max(2147483647),
}).strict()
