import type { QuizDraftContent } from '@/lib/server/assessment-drafts'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ParsedQuestion = {
  id?: string
  question_text?: string
  options?: string[]
}

export interface QuizMarkdownSerializeInput {
  title: string
  show_results: boolean
  questions: Array<{
    id: string
    question_text: string
    options: string[]
  }>
}

export interface QuizMarkdownParseResult {
  draftContent: QuizDraftContent | null
  errors: string[]
}

export interface ParseQuizMarkdownOptions {
  defaultShowResults?: boolean
  existingQuestions?: Array<{ id: string }>
}

function normalizeLineEndings(markdown: string): string[] {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Za-z ]+):\s*(.*)$/)
  if (!match) return null
  return { key: match[1].trim().toLowerCase(), value: match[2] ?? '' }
}

function generateUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function chooseId(candidate: string | undefined, fallback: string | undefined): string {
  if (candidate && UUID_RE.test(candidate)) return candidate
  if (fallback && UUID_RE.test(fallback)) return fallback
  return generateUuid()
}

function parseOptionsField(
  lines: string[],
  startIndex: number,
  inlineValue: string
): { options: string[]; nextIndex: number } {
  const options: string[] = []
  if (inlineValue.trim().length > 0) options.push(inlineValue.trim())

  let index = startIndex + 1
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line.length === 0) {
      index += 1
      continue
    }
    if (!line.startsWith('- ')) break
    const option = line.replace(/^- /, '').trim()
    if (option.length > 0) options.push(option)
    index += 1
  }

  return { options, nextIndex: index }
}

export function quizToMarkdown(input: QuizMarkdownSerializeInput): string {
  const lines: string[] = []
  lines.push('# Quiz')
  lines.push(`Title: ${input.title}`)
  lines.push(`Show Results: ${input.show_results ? 'true' : 'false'}`)
  lines.push('')
  lines.push('## Questions')

  input.questions.forEach((question, index) => {
    lines.push(`### Question ${index + 1}`)
    lines.push('Prompt:')
    for (const promptLine of question.question_text.split('\n')) {
      lines.push(promptLine)
    }
    lines.push('Options:')
    question.options.forEach((option) => {
      lines.push(`- ${option}`)
    })
    lines.push('')
  })

  return lines.join('\n').trim()
}

export function markdownToQuiz(
  markdown: string,
  options: ParseQuizMarkdownOptions = {}
): QuizMarkdownParseResult {
  const lines = normalizeLineEndings(markdown)
  const errors: string[] = []

  let title = ''
  let showResults = options.defaultShowResults ?? false
  const questions: QuizDraftContent['questions'] = []
  const fallbackIds = options.existingQuestions?.map((question) => question.id) ?? []

  let inQuestionsSection = false
  let currentQuestion: ParsedQuestion | null = null
  let promptLines: string[] = []
  let lineIndex = 0

  function flushQuestion() {
    if (!currentQuestion) return

    const questionIndex = questions.length
    const questionText = promptLines.join('\n').trim()
    const questionLabel = `Question ${questionIndex + 1}`

    if (!questionText) {
      errors.push(`${questionLabel}: Prompt is required`)
    }

    if (!currentQuestion.options || currentQuestion.options.length < 2) {
      errors.push(`${questionLabel}: At least 2 options are required`)
    }

    if (questionText && currentQuestion.options && currentQuestion.options.length >= 2) {
      questions.push({
        id: chooseId(currentQuestion.id, fallbackIds[questionIndex]),
        question_text: questionText,
        options: currentQuestion.options,
      })
    }

    currentQuestion = null
    promptLines = []
  }

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex]
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      if (currentQuestion) promptLines.push('')
      lineIndex += 1
      continue
    }

    if (trimmed.startsWith('# ')) {
      lineIndex += 1
      continue
    }

    if (trimmed === '## Questions') {
      flushQuestion()
      inQuestionsSection = true
      lineIndex += 1
      continue
    }

    if (!inQuestionsSection) {
      const field = parseFieldLine(trimmed)
      if (!field) {
        errors.push(`Invalid line before questions: "${trimmed}"`)
        lineIndex += 1
        continue
      }

      if (field.key === 'title') {
        title = field.value.trim()
      } else if (field.key === 'show results') {
        showResults = ['true', 'yes', '1'].includes(field.value.trim().toLowerCase())
      } else {
        errors.push(`Unknown field: ${field.key}`)
      }
      lineIndex += 1
      continue
    }

    if (trimmed.startsWith('### ')) {
      flushQuestion()
      currentQuestion = {}
      lineIndex += 1
      continue
    }

    if (!currentQuestion) {
      errors.push(`Content outside question block: "${trimmed}"`)
      lineIndex += 1
      continue
    }

    const field = parseFieldLine(trimmed)
    if (!field) {
      promptLines.push(line)
      lineIndex += 1
      continue
    }

    if (field.key === 'id') {
      currentQuestion.id = field.value.trim()
      lineIndex += 1
      continue
    }

    if (field.key === 'prompt') {
      lineIndex += 1
      while (lineIndex < lines.length) {
        const nextLine = lines[lineIndex]
        const nextTrimmed = nextLine.trim()
        if (
          nextTrimmed.startsWith('### ') ||
          nextTrimmed === '## Questions' ||
          nextTrimmed.startsWith('Options:')
        ) {
          break
        }
        promptLines.push(nextLine)
        lineIndex += 1
      }
      continue
    }

    if (field.key === 'options') {
      const parsed = parseOptionsField(lines, lineIndex, field.value)
      currentQuestion.options = parsed.options
      lineIndex = parsed.nextIndex
      continue
    }

    errors.push(`Unknown question field: ${field.key}`)
    lineIndex += 1
  }

  flushQuestion()

  if (!title.trim()) {
    errors.push('Title is required')
  }

  if (questions.length === 0) {
    errors.push('At least 1 question is required')
  }

  if (errors.length > 0) {
    return { draftContent: null, errors }
  }

  return {
    draftContent: {
      title: title.trim(),
      show_results: showResults,
      questions,
    },
    errors: [],
  }
}
