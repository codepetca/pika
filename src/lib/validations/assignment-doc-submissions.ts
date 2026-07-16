import { z } from 'zod'
import { isValidTiptapContent } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

export const assignmentSubmissionContentSchema = z
  .unknown()
  .refine(isValidTiptapContent, 'Invalid content format')
  .transform((content) => content as TiptapContent)

const pasteWordCountSchema = z.coerce.number().int().min(0).max(32_767)
const keystrokeCountSchema = z.coerce.number().int().min(0).max(2_147_483_647)

export const assignmentDocSubmitRequestSchema = z.object({
  content: assignmentSubmissionContentSchema,
  expected_updated_at: z.string().datetime({ offset: true }),
}).strict()

export const assignmentDocAtomicSaveRequestSchema = z.object({
  content: assignmentSubmissionContentSchema,
  trigger: z.enum(['autosave', 'blur']).optional(),
  paste_word_count: pasteWordCountSchema.optional(),
  keystroke_count: keystrokeCountSchema.optional(),
  expected_updated_at: z.string().datetime({ offset: true }),
  save_session_id: z.string().uuid(),
  save_sequence: z.number().int().positive(),
  metric_session_id: z.string().uuid(),
}).strict()

export const assignmentDocLegacySaveRequestSchema = z.object({
  content: assignmentSubmissionContentSchema,
  trigger: z.enum(['autosave', 'blur']).optional(),
  paste_word_count: pasteWordCountSchema.optional(),
  keystroke_count: keystrokeCountSchema.optional(),
}).strict()

export const assignmentDocSaveRequestSchema = z.union([
  assignmentDocAtomicSaveRequestSchema,
  assignmentDocLegacySaveRequestSchema,
])

export const assignmentArtifactPutRequestSchema = z.object({
  url: z.string().max(2_048),
  github_login: z.string().trim().min(1).max(39).optional(),
  save_github_login: z.boolean().optional(),
}).strict()

export const assignmentDocRestoreRequestSchema = z.object({
  history_id: z.string().uuid(),
}).strict()

export type AssignmentDocSubmitRequest = z.infer<typeof assignmentDocSubmitRequestSchema>
