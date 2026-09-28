import { z } from 'zod'

export const classroomGuidedDraftSuggestSchema = z.object({
  target: z.enum(['assignments', 'tests']),
  prompt: z.string().max(4000).optional().default(''),
  unit_exception_id: z.string().uuid().nullable().optional(),
}).strict()

export const classroomGuidedDraftCreateSchema = z.object({
  target: z.enum(['assignments', 'tests']),
  content: z.string().trim().min(1).max(250_000),
  draft_id: z.string().uuid(),
  draft_provenance_token: z.string().min(1).max(4096),
  original_content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  unit_exception_id: z.string().uuid().nullable().optional(),
}).strict()

export const classroomGuidedDraftProvenanceQuerySchema = z.object({
  target: z.enum(['assignments', 'tests']),
  artifact_id: z.string().uuid(),
}).strict()
