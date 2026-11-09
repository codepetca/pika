import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'
import { buildAssignmentInstructionFields } from '@/lib/assignment-instructions'
import { normalizeAssignmentSubmissionRequirementDrafts } from '@/lib/assignment-submission-requirements'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { normalizeSurveyQuestionInput } from '@/lib/surveys'
import { classworkAuthoringContent, type ClassworkAuthoringKind } from '@/lib/validations/classwork-authoring-drafts'
import type { Json } from '@/types/database.generated'

export const classworkDraftResponse = z.object({
  draft: z.object({ revision: z.string().uuid(), content: z.json(), stale: z.boolean().optional() }).nullable(),
})

export const classworkItemResponse = z.object({
  item: z.object({ id: z.string().uuid(), classroom_id: z.string().uuid() }).passthrough(),
  sourceRevision: z.string().regex(/^[0-9a-f]{64}$/),
})

export function prepareClassworkContent(kind: ClassworkAuthoringKind, raw: unknown, action: 'save' | 'create' | 'apply' | 'draft') {
  const content = classworkAuthoringContent[kind].parse(raw)
  const draft = z.json().parse(content) as Json
  if (action === 'save' && kind !== 'survey') return { draft, projection: {} }

  const title = content.title.trim()
  if (action === 'apply' && !title) throw new ApiError(400, 'Title is required')
  const resolvedTitle = title || getFallbackAssessmentTitle()
  if ('instructions_markdown' in content) {
    const instructionFields = buildAssignmentInstructionFields(content.instructions_markdown)
    const requirements = normalizeAssignmentSubmissionRequirementDrafts(content.submission_requirements)
      .map(({ id, ...requirement }) => id ? { id, ...requirement } : requirement)
    const fields = action !== 'create' ? content.fields : undefined
    return {
      draft,
      projection: z.json().parse({
        ...(!fields || fields.includes('title') ? { title: resolvedTitle } : {}),
        ...(!fields || fields.includes('instructions_markdown') ? instructionFields : {}),
        ...(!fields || fields.includes('due_at') ? { due_at: content.due_at } : {}),
        ...(!fields || fields.includes('submission_requirements') ? { submission_requirements: requirements } : {}),
      }) as Json,
    }
  }
  if ('posted_on' in content) {
    return { draft, projection: z.json().parse({ ...content, title: resolvedTitle }) as Json }
  }
  if (action === 'apply' && (content.editor?.unresolved || content.editor?.markdownDirty)) throw new ApiError(400, 'Finish or discard the unfinished survey edit before applying.')
  const ids = new Set<string>()
  const questions = content.questions.map(({ id, ...question }) => {
    if (ids.has(id)) throw new ApiError(400, 'A survey question is duplicated')
    ids.add(id)
    const normalized = normalizeSurveyQuestionInput(question)
    if (!normalized.valid) throw new ApiError(400, normalized.error)
    return { id, ...normalized.question }
  })
  return {
    draft,
    projection: {
      title: resolvedTitle,
      show_results: content.show_results,
      dynamic_responses: content.dynamic_responses,
      questions,
    },
  }
}

export function throwClassworkDraftError(error: { code?: string; message?: string; details?: string }): never {
  if (error.code === 'PT400' || error.code === '22023' || error.code === '22P02' || error.code === '23514') {
    throw new ApiError(400, 'The Classwork draft contains an invalid value.')
  }
  if (error.code === 'PT403' || error.code === '42501' || error.code === '55000') {
    throw new ApiError(403, 'This Classwork item is read-only or unavailable.')
  }
  if (error.code === 'PT404' || error.code === 'P0002') throw new ApiError(404, 'Classwork item not found.')
  if (error.code === 'PT409') throw new ApiError(409, error.message || 'This Classwork item changed. Reopen it and try again.')
  if (isRetryableDatabaseContention(error)) throw new ApiError(409, 'Classwork is busy. Try again.')
  throw new ApiError(503, 'Unable to save or load the Classwork draft.')
}
