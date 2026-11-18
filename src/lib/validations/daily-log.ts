import { z } from 'zod'
import { countCharacters, isValidTiptapContent } from '@/lib/tiptap-content'
import type { JsonPatchOperation, TiptapContent } from '@/types'

const identifierSchema = z.string().uuid().transform(value => value.toLowerCase())
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (use YYYY-MM-DD)').refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

// Bound both rich-text attributes and patch values, not just visible characters.
function withinWireLimit(value: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 60_000 } catch { return false }
}
const contentSchema = z.unknown().transform((value, context) => {
  if (!isValidTiptapContent(value) || !withinWireLimit(value)) {
    context.addIssue({ code: 'custom', message: 'Invalid rich_content format or size' })
    return z.NEVER
  }
  if (countCharacters(value) > 2000) {
    context.addIssue({ code: 'custom', message: 'Entry exceeds 2000 character limit' })
    return z.NEVER
  }
  return value as TiptapContent
})
const patchOperationSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string().max(1000),
  from: z.string().max(1000).optional(),
  value: z.unknown().optional(),
}).superRefine((operation, context) => {
  if (['add', 'replace', 'test'].includes(operation.op) && !('value' in operation)) {
    context.addIssue({ code: 'custom', message: 'Patch operation requires value' })
  }
  if (['move', 'copy'].includes(operation.op) && operation.from === undefined) {
    context.addIssue({ code: 'custom', message: 'Patch operation requires from' })
  }
}).transform(operation => operation as JsonPatchOperation)

export const dailyLogPostSchema = z.object({
  classroom_id: identifierSchema,
  date: dateSchema,
  text: z.string().max(2000, 'Entry exceeds 2000 character limit').optional(),
  rich_content: contentSchema.optional(),
  minutes_reported: z.number().int().nonnegative().max(1440).nullable().optional(),
  mood: z.enum(['😊', '🙂', '😐'], { error: 'Invalid mood value' }).nullable().optional(),
  entry_id: identifierSchema.optional(),
  version: revisionSchema.optional(),
}).refine(withinWireLimit, 'Daily Log payload exceeds size limit')

export const dailyLogPatchSchema = z.object({
  classroom_id: identifierSchema,
  date: dateSchema,
  entry_id: identifierSchema.optional(),
  version: revisionSchema,
  rich_content: contentSchema.optional(),
  patch: z.array(patchOperationSchema).max(2000).optional(),
}).refine(value => value.rich_content !== undefined || value.patch !== undefined, 'rich_content or patch is required')
  .refine(withinWireLimit, 'Daily Log payload exceeds size limit')
