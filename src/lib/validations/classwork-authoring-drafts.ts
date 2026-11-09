import { z } from 'zod'
import { assignmentSubmissionRequirementDraftSchema } from '@/lib/validations/assignment-authoring'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'
import { postDateSchema } from '@/lib/validations/post-date'

export const classworkAuthoringKind = z.enum(['assignment', 'material', 'survey'])
export type ClassworkAuthoringKind = z.infer<typeof classworkAuthoringKind>

const title = z.string().max(500)

export const classworkAuthoringContent = {
  assignment: z.object({
    title,
    instructions_markdown: z.string().max(200_000),
    due_at: z.string().datetime({ offset: true }),
    submission_requirements: z.array(assignmentSubmissionRequirementDraftSchema).max(50),
    fields: z.array(z.enum(['title', 'instructions_markdown', 'due_at', 'submission_requirements'])).max(4).optional(),
  }).strict(),
  material: z.object({
    title,
    content: assignmentSubmissionContentSchema,
    posted_on: postDateSchema,
  }).strict(),
  survey: z.object({
    title,
    show_results: z.boolean(),
    dynamic_responses: z.boolean(),
    questions: z.array(z.object({
      id: z.string().uuid().transform((id) => id.toLowerCase()),
      question_type: z.enum(['multiple_choice', 'short_text', 'link']),
      question_text: z.string().max(100_000),
      options: z.array(z.string().max(10_000)).max(50),
      response_max_chars: z.number().int().min(1).max(5000),
    }).strict()).max(1000),
    editor: z.object({
      unresolved: z.boolean(),
      markdownDirty: z.boolean().optional(),
    }).catchall(z.json()).optional(),
  }).strict(),
}
