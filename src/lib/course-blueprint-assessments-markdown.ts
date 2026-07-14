import { markdownToTest, testToMarkdown } from '@/lib/test-markdown'
import type { TestDocument, TestDraftContent } from '@/types'

export interface CourseBlueprintAssessmentMarkdownRecord {
  id?: string
  assessment_type: 'test'
  title: string
  content: TestDraftContent
  documents: TestDocument[]
  points_possible?: number | null
  gradebook_weight?: number | null
  include_in_final?: boolean
  position: number
}

export interface CourseBlueprintAssessmentsParseResult {
  assessments: CourseBlueprintAssessmentMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

function sanitizeTestContent(
  assessment: CourseBlueprintAssessmentMarkdownRecord
): TestDraftContent {
  const content = (assessment.content ?? {}) as Partial<TestDraftContent>

  return {
    title:
      typeof content.title === 'string' && content.title.trim().length > 0
        ? content.title
        : assessment.title,
    show_results: Boolean(content.show_results),
    questions: Array.isArray(content.questions) ? content.questions : [],
  }
}

function splitMarkdownDocuments(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n-{3,}\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

function extractGradingFields(document: string) {
  let pointsPossible: number | null | undefined
  let gradebookWeight: number | undefined
  let includeInFinal: boolean | undefined
  const errors: string[] = []
  const contentLines: string[] = []

  const lines = document.split('\n')
  const questionsHeaderIndex = lines.findIndex((line) => line.trim().toLowerCase() === '## questions')

  for (const [index, line] of lines.entries()) {
    if (questionsHeaderIndex >= 0 && index >= questionsHeaderIndex) {
      contentLines.push(line)
      continue
    }

    const fieldMatch = line.match(/^(Points Possible|Gradebook Weight|Include In Final):\s*(.*)$/i)
    if (!fieldMatch) {
      contentLines.push(line)
      continue
    }

    const key = fieldMatch[1].toLowerCase()
    const value = fieldMatch[2].trim()
    if (key === 'points possible') {
      pointsPossible = value.toLowerCase() === 'none' || value === '' ? null : Number(value)
    } else if (key === 'gradebook weight') {
      gradebookWeight = Number(value)
    } else {
      const normalized = value.toLowerCase()
      if (['true', 'yes', '1'].includes(normalized)) includeInFinal = true
      else if (['false', 'no', '0'].includes(normalized)) includeInFinal = false
      else errors.push('Include In Final must be true or false')
    }
  }

  if (
    pointsPossible !== undefined &&
    pointsPossible !== null &&
    (!Number.isFinite(pointsPossible) || pointsPossible < 0)
  ) {
    errors.push('Points Possible must be a non-negative number or none')
  }
  if (
    gradebookWeight !== undefined &&
    (!Number.isInteger(gradebookWeight) || gradebookWeight < 1 || gradebookWeight > 999)
  ) {
    errors.push('Gradebook Weight must be an integer from 1 to 999')
  }

  return {
    markdown: contentLines.join('\n'),
    pointsPossible,
    gradebookWeight,
    includeInFinal,
    errors,
  }
}

export function courseBlueprintAssessmentsToMarkdown(
  assessments: CourseBlueprintAssessmentMarkdownRecord[],
  assessmentType: 'test'
): string {
  const docs = assessments
    .filter((assessment) => assessment.assessment_type === assessmentType)
    .sort((left, right) => left.position - right.position)
    .map((assessment) => {
      const testContent = sanitizeTestContent(assessment)
      const markdown = testToMarkdown({
        title: testContent.title,
        show_results: testContent.show_results,
        questions: testContent.questions,
        documents: assessment.documents,
      })
      const lines = markdown.split('\n')
      lines.splice(
        2,
        0,
        `Points Possible: ${assessment.points_possible ?? 'none'}`,
        `Gradebook Weight: ${assessment.gradebook_weight ?? 10}`,
        `Include In Final: ${assessment.include_in_final !== false ? 'true' : 'false'}`
      )
      return lines.join('\n')
    })

  return docs.join('\n\n---\n\n')
}

export function markdownToCourseBlueprintAssessments(
  markdown: string,
  existingAssessments: CourseBlueprintAssessmentMarkdownRecord[],
  assessmentType: 'test'
): CourseBlueprintAssessmentsParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const assessments: CourseBlueprintAssessmentMarkdownRecord[] = []
  const existingByTitle = new Map(
    existingAssessments
      .filter((assessment) => assessment.assessment_type === assessmentType)
      .map((assessment) => [assessment.title.toLowerCase(), assessment])
  )
  const seenTitles = new Set<string>()
  const documents = splitMarkdownDocuments(markdown)

  documents.forEach((document, index) => {
    const existing = existingAssessments[index]
    const gradingFields = extractGradingFields(document)
    if (gradingFields.errors.length > 0) {
      gradingFields.errors.forEach((error) => errors.push(`Test ${index + 1}: ${error}`))
      return
    }
    const parsed = markdownToTest(gradingFields.markdown, {
      defaultShowResults: false,
      existingQuestions:
        (existing?.content as TestDraftContent | undefined)?.questions?.map((question) => ({ id: question.id })) ?? [],
      existingDocuments: existing?.documents ?? [],
    })
    if (parsed.errors.length > 0 || !parsed.draftContent) {
      parsed.errors.forEach((error) => errors.push(`Test ${index + 1}: ${error}`))
      return
    }
    const titleKey = parsed.draftContent.title.toLowerCase()
    const matchingExisting = existingByTitle.get(titleKey)
    seenTitles.add(titleKey)
    assessments.push({
      id: matchingExisting?.id,
      assessment_type: 'test',
      title: parsed.draftContent.title,
      content: parsed.draftContent,
      documents: parsed.documents,
      points_possible:
        typeof gradingFields.pointsPossible === 'number' && Number.isFinite(gradingFields.pointsPossible)
          ? gradingFields.pointsPossible
          : gradingFields.pointsPossible === null
            ? null
            : matchingExisting?.points_possible ?? null,
      gradebook_weight:
        typeof gradingFields.gradebookWeight === 'number' && Number.isInteger(gradingFields.gradebookWeight)
          ? gradingFields.gradebookWeight
          : matchingExisting?.gradebook_weight ?? 10,
      include_in_final: gradingFields.includeInFinal ?? matchingExisting?.include_in_final ?? true,
      position: assessments.length,
    })
  })

  existingByTitle.forEach((assessment, titleKey) => {
    if (!seenTitles.has(titleKey)) {
      warnings.push(`Test "${assessment.title}" not in markdown - will be preserved`)
    }
  })

  return { assessments, errors, warnings }
}
