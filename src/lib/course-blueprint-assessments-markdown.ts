import { markdownToTest, testToMarkdown } from '@/lib/test-markdown'
import type { TestDraftContent } from '@/lib/server/assessment-drafts'
import type { TestDocument } from '@/types'

export interface CourseBlueprintAssessmentMarkdownRecord {
  id?: string
  assessment_type: 'test'
  title: string
  content: TestDraftContent
  documents: TestDocument[]
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

export function courseBlueprintAssessmentsToMarkdown(
  assessments: CourseBlueprintAssessmentMarkdownRecord[],
  assessmentType: 'test'
): string {
  const docs = assessments
    .filter((assessment) => assessment.assessment_type === assessmentType)
    .sort((left, right) => left.position - right.position)
    .map((assessment) => {
      const testContent = sanitizeTestContent(assessment)
      return testToMarkdown({
        title: testContent.title,
        show_results: testContent.show_results,
        questions: testContent.questions,
        documents: assessment.documents,
      })
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
    const parsed = markdownToTest(document, {
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
    seenTitles.add(titleKey)
    assessments.push({
      id: existingByTitle.get(titleKey)?.id,
      assessment_type: 'test',
      title: parsed.draftContent.title,
      content: parsed.draftContent,
      documents: parsed.documents,
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
