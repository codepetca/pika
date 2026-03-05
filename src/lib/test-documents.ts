import type { TestDocument, TestDocumentSource } from '@/types'

export const TEST_DOCUMENT_ALLOWED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export const TEST_DOCUMENT_MAX_SIZE = 25 * 1024 * 1024
export const TEST_DOCUMENT_MAX_SIZE_MB = 25
export const TEST_DOCUMENT_ACCEPT =
  '.pdf,.txt,.md,.csv,.json,.doc,.docx,application/pdf,text/plain,text/markdown,text/csv,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const MAX_TEST_DOCUMENTS = 20
export const MAX_TEST_DOCUMENT_TEXT_LENGTH = 20000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeTestDocumentSource(value: unknown): TestDocumentSource {
  if (value === 'upload') return 'upload'
  if (value === 'text') return 'text'
  return 'link'
}

export function normalizeTestDocuments(value: unknown): TestDocument[] {
  if (!Array.isArray(value)) return []

  const docs: TestDocument[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const source = normalizeTestDocumentSource(raw.source)
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    const content = typeof raw.content === 'string' ? raw.content : ''
    if (!id || !title) continue

    if (source === 'text') {
      if (!content.trim()) continue
      docs.push({
        id,
        title: title.slice(0, 120),
        source,
        content: content.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH),
      })
      continue
    }

    if (!url) continue
    if (!isValidHttpUrl(url)) continue

    docs.push({
      id,
      title: title.slice(0, 120),
      url,
      source,
    })
  }

  return docs.slice(0, MAX_TEST_DOCUMENTS)
}

export function validateTestDocumentsPayload(value: unknown):
  | { valid: true; documents: TestDocument[] }
  | { valid: false; error: string } {
  if (!Array.isArray(value)) {
    return { valid: false, error: 'documents must be an array' }
  }

  if (value.length > MAX_TEST_DOCUMENTS) {
    return {
      valid: false,
      error: `Maximum ${MAX_TEST_DOCUMENTS} documents allowed`,
    }
  }

  const docs = normalizeTestDocuments(value)
  if (docs.length !== value.length) {
    return {
      valid: false,
      error: 'Each document must include valid id/title and either a valid http/https url or text content',
    }
  }

  return { valid: true, documents: docs }
}

export function isAllowedTestDocumentType(mimeType: string): boolean {
  return TEST_DOCUMENT_ALLOWED_TYPES.includes(mimeType as (typeof TEST_DOCUMENT_ALLOWED_TYPES)[number])
}

export function isWithinTestDocumentSizeLimit(size: number): boolean {
  return size <= TEST_DOCUMENT_MAX_SIZE
}

export function getTestDocumentValidationError(file: File): string | null {
  if (!isAllowedTestDocumentType(file.type)) {
    return 'Invalid file type. Allowed: PDF, TXT, MD, CSV, JSON, DOC, DOCX'
  }
  if (!isWithinTestDocumentSizeLimit(file.size)) {
    return `File too large. Maximum size is ${TEST_DOCUMENT_MAX_SIZE_MB}MB`
  }
  return null
}
