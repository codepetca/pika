import { addDaysToDateString } from '@/lib/date-string'
import {
  combineScheduleDateTimeToIso,
  getTodayInSchedulingTimezone,
} from '@/lib/scheduling'
import { buildAssignmentInstructionFields } from '@/lib/assignment-instructions'
import { markdownToCourseBlueprintAssignments } from '@/lib/course-blueprint-assignments'
import { markdownToCourseBlueprintAssessments } from '@/lib/course-blueprint-assessments-markdown'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { markPortableTestQuestionIdentity } from '@/lib/test-question-identity'
import type { TestDocument, TestDraftContent } from '@/types'

type ParsedAssignment = {
  target: 'assignments'
  title: string
  description: string
  instructionsMarkdown: string
  richInstructions: ReturnType<typeof buildAssignmentInstructionFields>['rich_instructions']
  dueAt: string
  requirements: unknown[]
  pointsPossible: number
}

type ParsedTest = {
  target: 'tests'
  draftContent: TestDraftContent
  documents: TestDocument[]
}

export type ParsedClassroomGuidedDraft = ParsedAssignment | ParsedTest
type ParseResult =
  | { ok: true; draft: ParsedClassroomGuidedDraft }
  | { ok: false; errors: string[] }

/** Parse an edited, standalone preview before any classroom mutation. */
export function parseClassroomGuidedDraft(target: 'assignments' | 'tests', content: string): ParseResult {
  if (target === 'assignments') {
    const parsed = markdownToCourseBlueprintAssignments(content, [])
    if (parsed.errors.length || parsed.assignments.length !== 1) {
      return { ok: false, errors: parsed.errors.length ? parsed.errors : ['The preview must contain exactly one assignment'] }
    }
    const assignment = parsed.assignments[0]
    const errors: string[] = []
    if (assignment.title.length > 200) errors.push('Title is too long')
    if (!assignment.instructions_markdown.trim() || assignment.instructions_markdown.length > 20_000) {
      errors.push('Instructions must contain 1 to 20,000 characters')
    }
    if (assignment.points_possible === null || assignment.points_possible <= 0 || assignment.points_possible > 1000) {
      errors.push('Points must be greater than 0 and at most 1000')
    }
    if (assignment.default_due_days < 0 || assignment.default_due_days > 365) {
      errors.push('Due Days must be between 0 and 365')
    }
    const [hours, minutes] = assignment.default_due_time.split(':').map(Number)
    if (hours > 23 || minutes > 59) errors.push('Due Time must be a valid 24-hour time')
    if (!assignment.is_draft) errors.push('The generated assignment must remain a draft')
    if (errors.length) return { ok: false, errors }

    const instructionFields = buildAssignmentInstructionFields(assignment.instructions_markdown)
    const dueDate = addDaysToDateString(getTodayInSchedulingTimezone(), assignment.default_due_days)
    return { ok: true, draft: {
      target,
      title: assignment.title,
      description: instructionFields.description,
      instructionsMarkdown: instructionFields.instructions_markdown,
      richInstructions: instructionFields.rich_instructions,
      dueAt: combineScheduleDateTimeToIso(dueDate, assignment.default_due_time),
      requirements: assignment.submission_requirements ?? [],
      pointsPossible: assignment.points_possible!,
    } }
  }

  const parsed = markdownToCourseBlueprintAssessments(content, [], 'test')
  if (parsed.errors.length || parsed.assessments.length !== 1) {
    return { ok: false, errors: parsed.errors.length ? parsed.errors : ['The preview must contain exactly one test'] }
  }
  const assessment = parsed.assessments[0]
  const validated = validateTestDraftContent(assessment.content)
  if (!validated.valid) return { ok: false, errors: [validated.error] }
  const errors: string[] = []
  if (validated.value.title.length > 200) errors.push('Title is too long')
  if (validated.value.questions.length < 1 || validated.value.questions.length > 50) {
    errors.push('A test needs 1 to 50 questions')
  }
  if (assessment.documents.length > 20 || assessment.documents.some((document) => document.source !== 'text')) {
    errors.push('The preview supports up to 20 Markdown text reference documents')
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, draft: {
    target,
    draftContent: markPortableTestQuestionIdentity(validated.value),
    documents: assessment.documents,
  } }
}
