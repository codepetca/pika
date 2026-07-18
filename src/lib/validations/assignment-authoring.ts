import { z } from 'zod'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'

const submissionValidationPolicySchema = z.object({
  mode: z.enum(['format_only', 'reachable', 'expected_domain']).optional(),
  expected_domains: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
}).strict()

export const assignmentSubmissionRequirementDraftSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(['repo_link', 'link', 'image']),
  label: z.string().max(500).nullable().optional(),
  instructions: z.string().max(10_000).nullable().optional(),
  required: z.boolean().nullable().optional(),
  position: z.number().int().nonnegative().nullable().optional(),
  validation_policy_json: submissionValidationPolicySchema.nullable().optional(),
}).strict()

export const teacherAssignmentPatchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  instructions_markdown: z.string().max(200_000).optional(),
  rich_instructions: assignmentSubmissionContentSchema.nullable().optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  is_draft: z.boolean().optional(),
  released_at: z.string().datetime({ offset: true }).nullable().optional(),
  submission_requirements: z.array(assignmentSubmissionRequirementDraftSchema).max(50).optional(),
}).strict()

export type TeacherAssignmentPatch = z.infer<typeof teacherAssignmentPatchSchema>
