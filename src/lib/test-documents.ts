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
export const LINK_DOCUMENT_AUTO_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const LINK_DOCUMENT_SNAPSHOT_SUPPORTED_TYPES = [
  'text/html',
  'application/pdf',
  'text/plain',
  'text/markdown',
] as const

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
    const snapshotPath = typeof raw.snapshot_path === 'string' ? raw.snapshot_path.trim() : ''
    const snapshotContentType =
      typeof raw.snapshot_content_type === 'string' ? raw.snapshot_content_type.trim().toLowerCase() : ''
    const syncedAt =
      raw.synced_at === null ? null : typeof raw.synced_at === 'string' && raw.synced_at.trim()
        ? raw.synced_at.trim()
        : undefined
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
      ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
      ...(snapshotContentType ? { snapshot_content_type: snapshotContentType } : {}),
      ...(syncedAt !== undefined ? { synced_at: syncedAt } : {}),
    })
  }

  return docs.slice(0, MAX_TEST_DOCUMENTS)
}

export function isSupportedLinkSnapshotContentType(contentType: string): boolean {
  return LINK_DOCUMENT_SNAPSHOT_SUPPORTED_TYPES.includes(
    contentType as (typeof LINK_DOCUMENT_SNAPSHOT_SUPPORTED_TYPES)[number]
  )
}

export function normalizeSnapshotContentType(contentType: string | null | undefined): string {
  return contentType?.split(';')[0]?.trim().toLowerCase() || ''
}

export function clearTestDocumentSnapshot(doc: TestDocument): TestDocument {
  return {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    ...(doc.url ? { url: doc.url } : {}),
    ...(doc.content ? { content: doc.content } : {}),
  }
}

export function formatCompactRelativeAge(value: string | null | undefined, nowMs = Date.now()): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return ''

  const diffSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s`

  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo`

  return `${Math.floor(diffDays / 365)}y`
}

export function isLinkDocumentSnapshotStale(
  doc: Pick<TestDocument, 'source' | 'snapshot_path' | 'synced_at'>,
  nowMs = Date.now(),
  maxAgeMs = LINK_DOCUMENT_AUTO_SYNC_MAX_AGE_MS
): boolean {
  if (doc.source !== 'link') return false
  if (!doc.snapshot_path || !doc.synced_at) return true

  const timestamp = Date.parse(doc.synced_at)
  if (Number.isNaN(timestamp)) return true

  return nowMs - timestamp >= maxAgeMs
}

export function sanitizeSnapshotHtml(html: string, sourceUrl: string): string {
  const strippedScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')

  const baseTag = `<base href="${sourceUrl.replace(/"/g, '&quot;')}">`
  const referrerTag = '<meta name="referrer" content="no-referrer">'
  const headMatch = strippedScripts.match(/<head\b[^>]*>/i)

  if (headMatch) {
    return strippedScripts.replace(headMatch[0], `${headMatch[0]}${baseTag}${referrerTag}`)
  }

  if (/<html\b[^>]*>/i.test(strippedScripts)) {
    return strippedScripts.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${baseTag}${referrerTag}</head>`)
  }

  return `<!doctype html><html><head>${baseTag}${referrerTag}</head><body>${strippedScripts}</body></html>`
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
