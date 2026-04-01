import { validateTestDraftContent, type TestDraftContent, type TestDraftQuestion } from '@/lib/server/assessment-drafts'
import { DEFAULT_OPEN_RESPONSE_MAX_CHARS } from '@/lib/test-attempts'
import { TEST_MARKDOWN_AI_SCHEMA } from '@/lib/test-markdown-schema'
import { defaultPointsForQuestionType } from '@/lib/test-questions'
import { validateTestDocumentsPayload } from '@/lib/test-documents'
import type { TestDocument, TestQuestionType } from '@/types'

export { TEST_MARKDOWN_AI_SCHEMA } from '@/lib/test-markdown-schema'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const FIELD_KEYS = new Set([
  'id',
  'type',
  'points',
  'code',
  'max chars',
  'prompt',
  'options',
  'correct option',
  'answer key',
  'sample solution',
  'source',
  'title',
  'url',
  'content',
  'show results',
])

type ParsedQuestion = {
  id?: string
  question_type?: TestQuestionType
  question_text?: string
  options?: string[]
  correct_option?: number | null
  answer_key?: string | null
  sample_solution?: string | null
  points?: number
  response_max_chars?: number
  response_monospace?: boolean
}

type ParsedDocument = {
  id?: string
  source?: 'link' | 'upload' | 'text'
  title?: string
  url?: string
  content?: string
}

export interface TestMarkdownSerializeInput {
  title: string
  show_results: boolean
  questions: Array<{
    id: string
    question_type?: TestQuestionType
    question_text: string
    options: string[]
    correct_option?: number | null
    answer_key?: string | null
    sample_solution?: string | null
    points?: number
    response_max_chars?: number
    response_monospace?: boolean
  }>
  documents?: TestDocument[]
}

export interface TestMarkdownParseResult {
  draftContent: TestDraftContent | null
  documents: TestDocument[]
  errors: string[]
}

export interface ParseTestMarkdownOptions {
  defaultShowResults?: boolean
  existingQuestions?: Array<{ id: string }>
  existingDocuments?: TestDocument[]
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false
  return null
}

function normalizeLineEndings(markdown: string): string[] {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function isHeading(line: string, level: 2 | 3): boolean {
  const marker = level === 2 ? '## ' : '### '
  return line.trim().startsWith(marker)
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Za-z ]+):\s*(.*)$/)
  if (!match) return null
  return { key: match[1].trim().toLowerCase(), value: match[2] ?? '' }
}

function isKnownFieldLine(line: string): boolean {
  const parsed = parseFieldLine(line)
  return parsed ? FIELD_KEYS.has(parsed.key) : false
}

function splitSectionBlocks(lines: string[]): { heading: string; lines: string[] }[] {
  const blocks: { heading: string; lines: string[] }[] = []
  let current: { heading: string; lines: string[] } | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (isHeading(line, 3)) {
      if (current) blocks.push(current)
      current = {
        heading: line.replace(/^###\s+/, '').trim(),
        lines: [],
      }
      continue
    }

    if (!current) {
      if (line.trim().length > 0) {
        if (!blocks.length) {
          blocks.push({ heading: '', lines: [line] })
        } else {
          blocks[blocks.length - 1].lines.push(line)
        }
      }
      continue
    }

    current.lines.push(line)
  }

  if (current) blocks.push(current)
  return blocks
}

function parseMultilineField(
  lines: string[],
  startIndex: number,
  initialValue: string
): { value: string; nextIndex: number } {
  const collected: string[] = []
  if (initialValue.trim().length > 0) {
    collected.push(initialValue)
  }

  let index = startIndex + 1
  while (index < lines.length) {
    const nextLine = lines[index]
    if (isHeading(nextLine, 2) || isHeading(nextLine, 3) || isKnownFieldLine(nextLine)) {
      break
    }
    collected.push(nextLine)
    index += 1
  }

  return {
    value: collected.join('\n').trim(),
    nextIndex: index,
  }
}

function parseOptionsField(
  lines: string[],
  startIndex: number,
  inlineValue: string
): { options: string[]; nextIndex: number } {
  const options: string[] = []

  if (inlineValue.trim().length > 0) {
    options.push(inlineValue.trim())
  }

  let index = startIndex + 1
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line.length === 0) {
      index += 1
      continue
    }
    if (line.startsWith('- ')) {
      const option = line.replace(/^- /, '').trim()
      if (option.length > 0) options.push(option)
      index += 1
      continue
    }
    if (isHeading(lines[index], 2) || isHeading(lines[index], 3) || isKnownFieldLine(lines[index])) {
      break
    }
    break
  }

  return { options, nextIndex: index }
}

function coerceQuestionType(input: string | undefined): TestQuestionType {
  return input?.toLowerCase() === 'open_response' ? 'open_response' : 'multiple_choice'
}

function parseNumber(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function generateUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  // Fallback for non-browser test environments.
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

function parseQuestionBlock(
  blockLines: string[],
  index: number,
  options: ParseTestMarkdownOptions,
  errors: string[]
): TestDraftQuestion | null {
  const parsed: ParsedQuestion = {}
  const questionLabel = `Question ${index + 1}`
  let lineIndex = 0

  while (lineIndex < blockLines.length) {
    const line = blockLines[lineIndex]
    const trimmed = line.trim()
    if (!trimmed) {
      lineIndex += 1
      continue
    }

    const field = parseFieldLine(trimmed)
    if (!field) {
      errors.push(`${questionLabel}: Invalid line "${trimmed}"`)
      lineIndex += 1
      continue
    }

    switch (field.key) {
      case 'id': {
        parsed.id = field.value.trim()
        lineIndex += 1
        break
      }
      case 'type': {
        const normalizedType = field.value.trim().toLowerCase()
        if (normalizedType !== 'multiple_choice' && normalizedType !== 'open_response') {
          errors.push(`${questionLabel}: Type must be "multiple_choice" or "open_response"`)
        } else {
          parsed.question_type = normalizedType as TestQuestionType
        }
        lineIndex += 1
        break
      }
      case 'points': {
        const parsedValue = parseNumber(field.value.trim())
        if (parsedValue === null) {
          errors.push(`${questionLabel}: Points must be a number`)
        } else {
          parsed.points = parsedValue
        }
        lineIndex += 1
        break
      }
      case 'code': {
        const parsedValue = parseBoolean(field.value)
        if (parsedValue === null) {
          errors.push(`${questionLabel}: Code must be true or false`)
        } else {
          parsed.response_monospace = parsedValue
        }
        lineIndex += 1
        break
      }
      case 'max chars': {
        const parsedValue = parseNumber(field.value.trim())
        if (parsedValue === null || !Number.isInteger(parsedValue)) {
          errors.push(`${questionLabel}: Max Chars must be an integer`)
        } else {
          parsed.response_max_chars = parsedValue
        }
        lineIndex += 1
        break
      }
      case 'prompt': {
        const block = parseMultilineField(blockLines, lineIndex, field.value)
        parsed.question_text = block.value
        lineIndex = block.nextIndex
        break
      }
      case 'options': {
        const block = parseOptionsField(blockLines, lineIndex, field.value)
        parsed.options = block.options
        lineIndex = block.nextIndex
        break
      }
      case 'correct option': {
        const parsedValue = parseNumber(field.value.trim())
        if (parsedValue === null || !Number.isInteger(parsedValue)) {
          errors.push(`${questionLabel}: Correct Option must be an integer`)
        } else {
          parsed.correct_option = parsedValue - 1
        }
        lineIndex += 1
        break
      }
      case 'answer key': {
        const block = parseMultilineField(blockLines, lineIndex, field.value)
        parsed.answer_key = block.value || null
        lineIndex = block.nextIndex
        break
      }
      case 'sample solution': {
        const block = parseMultilineField(blockLines, lineIndex, field.value)
        parsed.sample_solution = block.value || null
        lineIndex = block.nextIndex
        break
      }
      default: {
        errors.push(`${questionLabel}: Unsupported field "${field.key}"`)
        lineIndex += 1
      }
    }
  }

  const questionType = coerceQuestionType(parsed.question_type)
  const fallbackQuestionId = options.existingQuestions?.[index]?.id
  const nextId = chooseId(parsed.id, fallbackQuestionId)
  const points = parsed.points ?? defaultPointsForQuestionType(questionType)
  const questionText = parsed.question_text ?? ''

  if (!questionText.trim()) {
    errors.push(`${questionLabel}: Prompt is required`)
  }

  if (questionType === 'multiple_choice') {
    if (parsed.correct_option === undefined) {
      errors.push(`${questionLabel}: Correct Option is required for multiple_choice questions`)
    }
    const questionDraft: TestDraftQuestion = {
      id: nextId,
      question_type: 'multiple_choice',
      question_text: questionText,
      options: parsed.options || [],
      correct_option: parsed.correct_option ?? 0,
      answer_key: null,
      sample_solution: null,
      points,
      response_max_chars: DEFAULT_OPEN_RESPONSE_MAX_CHARS,
      response_monospace: false,
    }
    return questionDraft
  }

  const questionDraft: TestDraftQuestion = {
    id: nextId,
    question_type: 'open_response',
    question_text: questionText,
    options: [],
    correct_option: null,
    answer_key: parsed.answer_key ?? null,
    sample_solution: parsed.sample_solution ?? null,
    points,
    response_max_chars: parsed.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS,
    response_monospace: parsed.response_monospace ?? false,
  }
  return questionDraft
}

function parseDocumentBlock(
  blockLines: string[],
  index: number,
  options: ParseTestMarkdownOptions,
  errors: string[]
): TestDocument | null {
  const parsed: ParsedDocument = {}
  const documentLabel = `Document ${index + 1}`
  let lineIndex = 0

  while (lineIndex < blockLines.length) {
    const line = blockLines[lineIndex]
    const trimmed = line.trim()
    if (!trimmed) {
      lineIndex += 1
      continue
    }

    const field = parseFieldLine(trimmed)
    if (!field) {
      errors.push(`${documentLabel}: Invalid line "${trimmed}"`)
      lineIndex += 1
      continue
    }

    switch (field.key) {
      case 'id': {
        parsed.id = field.value.trim()
        lineIndex += 1
        break
      }
      case 'source': {
        const normalized = field.value.trim().toLowerCase()
        if (normalized !== 'link' && normalized !== 'upload' && normalized !== 'text') {
          errors.push(`${documentLabel}: Source must be link, upload, or text`)
        } else {
          parsed.source = normalized as TestDocument['source']
        }
        lineIndex += 1
        break
      }
      case 'title': {
        parsed.title = field.value.trim()
        lineIndex += 1
        break
      }
      case 'url': {
        parsed.url = field.value.trim()
        lineIndex += 1
        break
      }
      case 'content': {
        const block = parseMultilineField(blockLines, lineIndex, field.value)
        parsed.content = block.value
        lineIndex = block.nextIndex
        break
      }
      default: {
        errors.push(`${documentLabel}: Unsupported field "${field.key}"`)
        lineIndex += 1
      }
    }
  }

  const source = parsed.source ?? 'link'
  const fallbackDocId = options.existingDocuments?.[index]?.id
  const id = chooseId(parsed.id, fallbackDocId)
  const title = (parsed.title || '').trim()
  if (!title) {
    errors.push(`${documentLabel}: Title is required`)
    return null
  }

  if (source === 'text') {
    const content = parsed.content ?? ''
    if (!content.trim()) {
      errors.push(`${documentLabel}: Content is required for text documents`)
      return null
    }
    return {
      id,
      title,
      source,
      content,
    }
  }

  const url = (parsed.url || '').trim()
  if (!url) {
    errors.push(`${documentLabel}: URL is required for ${source} documents`)
    return null
  }

  return {
    id,
    title,
    source,
    url,
  }
}

export function testToMarkdown(input: TestMarkdownSerializeInput): string {
  const lines: string[] = []

  lines.push('# Test')
  lines.push(`Title: ${input.title}`)
  lines.push(`Show Results: ${input.show_results ? 'true' : 'false'}`)
  lines.push('')
  lines.push('## Questions')

  for (let index = 0; index < input.questions.length; index += 1) {
    const question = input.questions[index]
    const questionType = question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
    const points = question.points ?? defaultPointsForQuestionType(questionType)
    lines.push(`### Question ${index + 1}`)
    lines.push(`ID: ${question.id}`)
    lines.push(`Type: ${questionType}`)
    lines.push(`Points: ${points}`)
    if (questionType === 'open_response') {
      lines.push(`Code: ${question.response_monospace === true ? 'true' : 'false'}`)
      lines.push(`Max Chars: ${question.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS}`)
    }
    lines.push('Prompt:')
    const promptLines = (question.question_text || '').split('\n')
    for (const promptLine of promptLines) {
      lines.push(promptLine)
    }

    if (questionType === 'multiple_choice') {
      lines.push('Options:')
      for (const option of question.options || []) {
        lines.push(`- ${option}`)
      }
      const correctOption =
        typeof question.correct_option === 'number' && Number.isInteger(question.correct_option)
          ? question.correct_option
          : 0
      lines.push(`Correct Option: ${correctOption + 1}`)
    } else {
      lines.push('Answer Key:')
      if (question.answer_key) {
        lines.push(...question.answer_key.split('\n'))
      }
      if (question.sample_solution) {
        lines.push('Sample Solution:')
        lines.push(...question.sample_solution.split('\n'))
      }
    }

    lines.push('')
  }

  lines.push('## Documents')
  const documents = input.documents || []
  if (documents.length === 0) {
    lines.push('_None_')
  } else {
    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index]
      lines.push(`### Document ${index + 1}`)
      lines.push(`ID: ${document.id}`)
      lines.push(`Source: ${document.source}`)
      lines.push(`Title: ${document.title}`)
      if (document.source === 'text') {
        lines.push('Content:')
        lines.push(...(document.content || '').split('\n'))
      } else {
        lines.push(`URL: ${document.url || ''}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd()
}

export function markdownToTest(
  markdown: string,
  options: ParseTestMarkdownOptions = {}
): TestMarkdownParseResult {
  const errors: string[] = []
  const lines = normalizeLineEndings(markdown)
  const questionsHeaderIndex = lines.findIndex((line) => line.trim().toLowerCase() === '## questions')
  if (questionsHeaderIndex < 0) {
    return {
      draftContent: null,
      documents: options.existingDocuments ? [...options.existingDocuments] : [],
      errors: ['Missing required "## Questions" section'],
    }
  }

  const documentsHeaderIndex = lines.findIndex(
    (line, index) => index > questionsHeaderIndex && line.trim().toLowerCase() === '## documents'
  )

  const headerLines = lines.slice(0, questionsHeaderIndex)
  let title = ''
  let showResults = options.defaultShowResults ?? false

  for (const headerLine of headerLines) {
    const trimmed = headerLine.trim()
    if (!trimmed || trimmed === '# Test') continue
    const field = parseFieldLine(trimmed)
    if (!field) {
      errors.push(`Invalid header line "${trimmed}"`)
      continue
    }
    if (field.key === 'title') {
      title = field.value.trim()
      continue
    }
    if (field.key === 'show results') {
      const parsedBoolean = parseBoolean(field.value)
      if (parsedBoolean === null) {
        errors.push('Show Results must be true or false')
      } else {
        showResults = parsedBoolean
      }
      continue
    }
    errors.push(`Unsupported header field "${field.key}"`)
  }

  if (!title) {
    errors.push('Title is required')
  }

  const questionLines = lines.slice(
    questionsHeaderIndex + 1,
    documentsHeaderIndex === -1 ? lines.length : documentsHeaderIndex
  )
  const questionBlocks = splitSectionBlocks(questionLines).filter(
    (block) => block.heading.trim().length > 0 || block.lines.some((line) => line.trim().length > 0)
  )

  const questions: TestDraftQuestion[] = []
  if (questionBlocks.length === 0) {
    errors.push('At least 1 question is required')
  } else {
    questionBlocks.forEach((block, index) => {
      if (!block.heading) {
        errors.push('Each question must start with a "### Question N" heading')
        return
      }
      const parsedQuestion = parseQuestionBlock(block.lines, index, options, errors)
      if (parsedQuestion) questions.push(parsedQuestion)
    })
  }

  let documents: TestDocument[] = options.existingDocuments ? [...options.existingDocuments] : []
  if (documentsHeaderIndex >= 0) {
    const documentLines = lines.slice(documentsHeaderIndex + 1)
    const nonEmptyDocumentLines = documentLines.filter((line) => line.trim().length > 0)
    if (
      nonEmptyDocumentLines.length === 1 &&
      nonEmptyDocumentLines[0].trim().toLowerCase() === '_none_'
    ) {
      documents = []
    } else {
      const documentBlocks = splitSectionBlocks(documentLines).filter(
        (block) => block.heading.trim().length > 0 || block.lines.some((line) => line.trim().length > 0)
      )
      documents = []
      documentBlocks.forEach((block, index) => {
        if (!block.heading) {
          errors.push('Each document must start with a "### Document N" heading')
          return
        }
        const parsedDocument = parseDocumentBlock(block.lines, index, options, errors)
        if (parsedDocument) documents.push(parsedDocument)
      })
    }
  }

  const draftCandidate = {
    title,
    show_results: showResults,
    questions,
  }

  const draftValidation = validateTestDraftContent(draftCandidate)
  if (!draftValidation.valid) {
    errors.push(draftValidation.error)
  }

  const documentValidation = validateTestDocumentsPayload(documents)
  if (!documentValidation.valid) {
    errors.push(documentValidation.error)
  }

  if (errors.length > 0 || !draftValidation.valid || !documentValidation.valid) {
    return {
      draftContent: null,
      documents,
      errors,
    }
  }

  return {
    draftContent: draftValidation.value,
    documents: documentValidation.documents,
    errors: [],
  }
}
