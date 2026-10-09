import { z } from 'zod'
import { contextualTestListTestSchema } from '@/lib/validations/contextual-test-list-read'

const uuid = z.string().uuid().transform(value => value.toLowerCase())

export const testUnpublicationParamsSchema = z.object({ id: uuid }).strict()
export const testUnpublicationBodySchema = z.object({}).strict()
export const testUnpublicationResultSchema = z.object({
  test: contextualTestListTestSchema.extend({ status: z.literal('draft') }),
  draft_version: z.number().int().positive().max(2147483647),
}).strict()
