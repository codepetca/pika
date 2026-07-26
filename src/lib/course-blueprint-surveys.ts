import {
  isCourseBlueprintArtifactId,
  resolveCourseBlueprintArtifactId,
  type CourseBlueprintArtifactParseOptions,
} from '@/lib/course-blueprint-artifact-identity'
import type { SurveyQuestionType } from '@/types'

export type CourseBlueprintSurveyQuestionMarkdownRecord = {
  id?: string
  question_type: SurveyQuestionType
  question_text: string
  options: string[]
  response_max_chars: number
  position: number
}

export type CourseBlueprintSurveyMarkdownRecord = {
  id?: string
  artifact_id?: string
  title: string
  show_results: boolean
  dynamic_responses: boolean
  questions_json: CourseBlueprintSurveyQuestionMarkdownRecord[]
  position: number
}

export type CourseBlueprintSurveysParseResult = {
  surveys: CourseBlueprintSurveyMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

export function courseBlueprintSurveysToMarkdown(
  surveys: CourseBlueprintSurveyMarkdownRecord[]
): string {
  const lines: string[] = []
  surveys
    .slice()
    .sort((left, right) => left.position - right.position)
    .forEach((survey) => {
      lines.push(`# Survey: ${survey.title}`)
      if (survey.artifact_id) lines.push(`Artifact ID: ${survey.artifact_id}`)
      lines.push(`Classwork Position: ${survey.position}`)
      lines.push(`Show Results: ${survey.show_results ? 'true' : 'false'}`)
      lines.push(`Dynamic Responses: ${survey.dynamic_responses ? 'true' : 'false'}`)
      lines.push('')
      survey.questions_json
        .slice()
        .sort((left, right) => left.position - right.position)
        .forEach((question, questionIndex) => {
          lines.push(`## Question ${questionIndex + 1}`)
          if (question.id) lines.push(`ID: ${question.id}`)
          lines.push(`Type: ${question.question_type}`)
          lines.push(`Max Chars: ${question.response_max_chars}`)
          lines.push('Prompt:')
          lines.push(question.question_text.trim())
          if (question.question_type === 'multiple_choice') {
            lines.push('Options:')
            question.options.forEach((option) => lines.push(`- ${option}`))
          }
          lines.push('')
        })
      lines.push('---', '')
    })
  return lines.join('\n').trim()
}

type QuestionDraft = Partial<CourseBlueprintSurveyQuestionMarkdownRecord> & {
  promptLines: string[]
}

export function markdownToCourseBlueprintSurveys(
  markdown: string,
  existingSurveys: CourseBlueprintSurveyMarkdownRecord[],
  options: CourseBlueprintArtifactParseOptions = {}
): CourseBlueprintSurveysParseResult {
  const surveys: CourseBlueprintSurveyMarkdownRecord[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const existingByArtifactId = new Map(
    existingSurveys
      .filter((survey) => isCourseBlueprintArtifactId(survey.artifact_id))
      .map((survey) => [survey.artifact_id!, survey])
  )
  const existingByTitle = new Map(
    existingSurveys.map((survey) => [survey.title.trim().toLowerCase(), survey])
  )
  const usedArtifactIds = new Set<string>()
  const usedQuestionArtifactIds = new Set<string>()
  const usedPositions = new Set<number>()
  const usedTitles = new Set<string>()

  let survey: Partial<CourseBlueprintSurveyMarkdownRecord> | null = null
  let questions: CourseBlueprintSurveyQuestionMarkdownRecord[] = []
  let question: QuestionDraft | null = null
  let questionSection: 'none' | 'prompt' | 'options' = 'none'
  let currentExisting: CourseBlueprintSurveyMarkdownRecord | undefined
  let surveyHasError = false

  const flushQuestion = () => {
    if (!question || !survey) return
    const questionNumber = questions.length + 1
    const questionType = question.question_type
    const rawId = question.id
    const artifactId = resolveCourseBlueprintArtifactId(rawId, options)
      ?? currentExisting?.questions_json[questions.length]?.id
    const prompt = question.promptLines.join('\n').trim()
    const responseMaxChars = Number.isInteger(question.response_max_chars)
      ? Number(question.response_max_chars)
      : 500

    if (rawId && !isCourseBlueprintArtifactId(rawId)) {
      errors.push(`Survey "${survey.title}" question ${questionNumber} has invalid ID`)
      surveyHasError = true
    } else if (!artifactId && options.requireArtifactIds) {
      errors.push(`Survey "${survey.title}" question ${questionNumber} is missing ID`)
      surveyHasError = true
    } else if (artifactId && usedQuestionArtifactIds.has(artifactId)) {
      errors.push(
        `Survey "${survey.title}" question ${questionNumber} has duplicate ID "${artifactId}"`
      )
      surveyHasError = true
    } else if (!questionType || !['multiple_choice', 'short_text', 'link'].includes(questionType)) {
      errors.push(`Survey "${survey.title}" question ${questionNumber} has invalid Type`)
      surveyHasError = true
    } else if (!prompt) {
      errors.push(`Survey "${survey.title}" question ${questionNumber} is missing Prompt`)
      surveyHasError = true
    } else if (
      questionType === 'multiple_choice'
      && (question.options || []).filter(Boolean).length < 2
    ) {
      errors.push(`Survey "${survey.title}" question ${questionNumber} needs at least two Options`)
      surveyHasError = true
    } else if (responseMaxChars < 1 || responseMaxChars > 5000) {
      errors.push(`Survey "${survey.title}" question ${questionNumber} has invalid Max Chars`)
      surveyHasError = true
    } else {
      questions.push({
        id: artifactId,
        question_type: questionType,
        question_text: prompt,
        options: questionType === 'multiple_choice'
          ? (question.options || []).filter(Boolean)
          : [],
        response_max_chars: responseMaxChars,
        position: questions.length,
      })
      if (artifactId) usedQuestionArtifactIds.add(artifactId)
    }
    question = null
    questionSection = 'none'
  }

  const flushSurvey = () => {
    if (!survey) return
    flushQuestion()
    const title = survey.title?.trim() || ''
    const titleKey = title.toLowerCase()
    const rawArtifactId = survey.artifact_id
    const artifactId = resolveCourseBlueprintArtifactId(rawArtifactId, options)
    const position = Number.isInteger(survey.position)
      ? Number(survey.position)
      : surveys.length

    if (!title) {
      errors.push('Survey is missing a title')
    } else if (rawArtifactId && !artifactId) {
      errors.push(`Survey "${title}" has invalid Artifact ID`)
    } else if (!artifactId && options.requireArtifactIds) {
      errors.push(`Survey "${title}" is missing Artifact ID`)
    } else if (artifactId && usedArtifactIds.has(artifactId)) {
      errors.push(`Survey "${title}" has duplicate Artifact ID "${artifactId}"`)
    } else if (options.requirePositions && !Number.isInteger(survey.position)) {
      errors.push(`Survey "${title}" is missing Classwork Position`)
    } else if (position < 0 || usedPositions.has(position)) {
      errors.push(`Survey "${title}" has invalid or duplicate Classwork Position`)
    } else if (usedTitles.has(titleKey)) {
      errors.push(`Duplicate survey title: "${title}"`)
    } else if (!surveyHasError) {
      surveys.push({
        id: currentExisting?.id,
        artifact_id: artifactId ?? currentExisting?.artifact_id,
        title,
        show_results: survey.show_results !== false,
        dynamic_responses: survey.dynamic_responses === true,
        questions_json: questions,
        position,
      })
      if (artifactId) usedArtifactIds.add(artifactId)
      usedPositions.add(position)
      usedTitles.add(titleKey)
    }

    survey = null
    questions = []
    question = null
    currentExisting = undefined
    surveyHasError = false
    questionSection = 'none'
  }

  markdown.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
    const surveyMatch = line.match(/^#\s+Survey:\s*(.+)$/i)
    if (surveyMatch) {
      flushSurvey()
      const title = surveyMatch[1].trim()
      survey = {
        title,
        show_results: true,
        dynamic_responses: false,
      }
      currentExisting = existingByTitle.get(title.toLowerCase())
      return
    }
    if (!survey) return
    if (line.trim() === '---') {
      flushSurvey()
      return
    }
    const questionMatch = line.match(/^##\s+Question(?:\s+\d+)?\s*$/i)
    if (questionMatch) {
      flushQuestion()
      question = { promptLines: [], options: [] }
      return
    }

    const fieldMatch = line.match(/^([A-Za-z ]+):\s*(.*)$/)
    if (fieldMatch) {
      const key = fieldMatch[1].trim().toLowerCase()
      const value = fieldMatch[2].trim()
      if (!question) {
        if (key === 'artifact id') {
          survey.artifact_id = value
          currentExisting = existingByArtifactId.get(value) ?? currentExisting
          return
        }
        if (key === 'classwork position') {
          survey.position = Number(value)
          return
        }
        if (key === 'show results') {
          survey.show_results = ['true', 'yes', '1'].includes(value.toLowerCase())
          return
        }
        if (key === 'dynamic responses') {
          survey.dynamic_responses = ['true', 'yes', '1'].includes(value.toLowerCase())
          return
        }
      } else {
        if (key === 'id') {
          question.id = value
          return
        }
        if (key === 'type') {
          question.question_type = value as SurveyQuestionType
          return
        }
        if (key === 'max chars') {
          question.response_max_chars = Number(value)
          return
        }
        if (key === 'prompt') {
          questionSection = 'prompt'
          if (value) question.promptLines.push(value)
          return
        }
        if (key === 'options') {
          questionSection = 'options'
          if (value) question.options = [value]
          return
        }
      }
    }

    if (question && questionSection === 'options') {
      const optionMatch = line.match(/^\s*-\s+(.+)$/)
      if (optionMatch) {
        question.options = [...(question.options || []), optionMatch[1].trim()]
        return
      }
    }
    if (question && questionSection === 'prompt') {
      question.promptLines.push(line)
    }
  })
  flushSurvey()

  existingSurveys.forEach((existing) => {
    if (!usedTitles.has(existing.title.trim().toLowerCase())) {
      warnings.push(`Survey "${existing.title}" not in markdown - will be archived`)
    }
  })
  return { surveys, errors, warnings }
}
