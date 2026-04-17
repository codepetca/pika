import { markdownToQuiz, quizToMarkdown } from '@/lib/quiz-markdown'
import { markdownToTest, testToMarkdown } from '@/lib/test-markdown'
import type { QuizDraftContent, TestDraftContent } from '@/lib/server/assessment-drafts'
import type { TestDocument } from '@/types'

export interface CourseBlueprintAssessmentMarkdownRecord {
  id?: string
  assessment_type: 'quiz' | 'test'
  title: string
  content: QuizDraftContent | TestDraftContent
  documents: TestDocument[]
  position: number
}

export interface CourseBlueprintAssessmentsParseResult {
  assessments: CourseBlueprintAssessmentMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

function sanitizeQuizContent(
  assessment: CourseBlueprintAssessmentMarkdownRecord
): QuizDraftContent {
  const content = (assessment.content ?? {}) as Partial<QuizDraftContent>

  return {
    title:
      typeof content.title === 'string' && content.title.trim().length > 0
        ? content.title
        : assessment.title,
    show_results: Boolean(content.show_results),
    questions: Array.isArray(content.questions)
      ? content.questions.map((question) => ({
          id: typeof question?.id === 'string' ? question.id : '',
          question_text: typeof question?.question_text === 'string' ? question.question_text : '',
          options: Array.isArray(question?.options)
            ? question.options.filter((option): option is string => typeof option === 'string')
            : [],
        }))
      : [],
  }
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
  assessmentType: 'quiz' | 'test'
): string {
  const docs = assessments
    .filter((assessment) => assessment.assessment_type === assessmentType)
    .sort((left, right) => left.position - right.position)
    .map((assessment) => {
      if (assessmentType === 'quiz') {
        return quizToMarkdown(sanitizeQuizContent(assessment))
      }

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
  assessmentType: 'quiz' | 'test'
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
    if (assessmentType === 'quiz') {
      const parsed = markdownToQuiz(document, {
        existingQuestions:
          (existingAssessments[index]?.content as QuizDraftContent | undefined)?.questions?.map((question) => ({
            id: question.id,
          })) ?? [],
      })
      if (parsed.errors.length > 0 || !parsed.draftContent) {
        parsed.errors.forEach((error) => errors.push(`Quiz ${index + 1}: ${error}`))
        return
      }
      const titleKey = parsed.draftContent.title.toLowerCase()
      const existing = existingByTitle.get(titleKey)
      seenTitles.add(titleKey)
      assessments.push({
        id: existing?.id,
        assessment_type: 'quiz',
        title: parsed.draftContent.title,
        content: parsed.draftContent,
        documents: [],
        position: assessments.length,
      })
      return
    }

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
      warnings.push(`${assessment.assessment_type === 'quiz' ? 'Quiz' : 'Test'} "${assessment.title}" not in markdown - will be preserved`)
    }
  })

  return { assessments, errors, warnings }
}
