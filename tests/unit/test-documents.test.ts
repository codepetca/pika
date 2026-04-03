import { describe, expect, it } from 'vitest'
import {
  formatCompactRelativeAge,
  getTestDocumentValidationError,
  isLinkDocumentSnapshotStale,
  normalizeTestDocuments,
  sanitizeSnapshotHtml,
  validateTestDocumentsPayload,
} from '@/lib/test-documents'

describe('test-documents', () => {
  it('normalizes valid documents and drops invalid entries', () => {
    const result = normalizeTestDocuments([
      {
        id: 'doc-1',
        title: ' Java API ',
        url: 'https://docs.oracle.com',
        source: 'link',
        snapshot_path: 'link-docs/teacher/test/doc-1/snapshot',
        snapshot_content_type: 'text/html',
        synced_at: '2026-04-02T10:00:00.000Z',
      },
      { id: 'doc-2', title: ' Allowed Syntax ', source: 'text', content: 'if, else, switch' },
      { id: 'bad', title: 'Bad', url: 'javascript:alert(1)', source: 'link' },
    ])

    expect(result).toEqual([
      {
        id: 'doc-1',
        title: 'Java API',
        url: 'https://docs.oracle.com',
        source: 'link',
        snapshot_path: 'link-docs/teacher/test/doc-1/snapshot',
        snapshot_content_type: 'text/html',
        synced_at: '2026-04-02T10:00:00.000Z',
      },
      {
        id: 'doc-2',
        title: 'Allowed Syntax',
        source: 'text',
        content: 'if, else, switch',
      },
    ])
  })

  it('validates payload shape and urls', () => {
    const valid = validateTestDocumentsPayload([
      {
        id: 'doc-1',
        title: 'MDN',
        url: 'https://developer.mozilla.org',
        source: 'link',
      },
    ])
    expect(valid.valid).toBe(true)

    const validText = validateTestDocumentsPayload([
      {
        id: 'doc-3',
        title: 'Pseudo code',
        source: 'text',
        content: 'for i in range(10):',
      },
    ])
    expect(validText.valid).toBe(true)

    const invalid = validateTestDocumentsPayload([
      {
        id: 'doc-2',
        title: 'Oops',
        url: 'ftp://example.com/file.pdf',
        source: 'link',
      },
    ])
    expect(invalid.valid).toBe(false)

    const invalidText = validateTestDocumentsPayload([
      {
        id: 'doc-4',
        title: 'Blank text',
        source: 'text',
        content: '   ',
      },
    ])
    expect(invalidText.valid).toBe(false)
  })

  it('validates upload file constraints', () => {
    const validFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    expect(getTestDocumentValidationError(validFile)).toBeNull()

    const invalidType = new File(['{}'], 'data.exe', { type: 'application/x-msdownload' })
    expect(getTestDocumentValidationError(invalidType)).toContain('Invalid file type')
  })

  it('formats compact relative sync ages', () => {
    const now = Date.parse('2026-04-02T12:00:00.000Z')

    expect(formatCompactRelativeAge('2026-04-02T11:59:56.000Z', now)).toBe('4s')
    expect(formatCompactRelativeAge('2026-04-02T11:56:00.000Z', now)).toBe('4m')
    expect(formatCompactRelativeAge('2026-04-02T08:00:00.000Z', now)).toBe('4h')
    expect(formatCompactRelativeAge('2026-04-01T12:00:00.000Z', now)).toBe('1d')
    expect(formatCompactRelativeAge('2026-02-01T12:00:00.000Z', now)).toBe('2mo')
    expect(formatCompactRelativeAge('2025-04-02T12:00:00.000Z', now)).toBe('1y')
  })

  it('treats missing or old link snapshots as stale', () => {
    const now = Date.parse('2026-04-03T12:00:00.000Z')

    expect(
      isLinkDocumentSnapshotStale({
        source: 'link',
        snapshot_path: undefined,
        synced_at: null,
      }, now)
    ).toBe(true)

    expect(
      isLinkDocumentSnapshotStale({
        source: 'link',
        snapshot_path: 'link-docs/teacher/test/doc-1/snapshot',
        synced_at: '2026-04-02T11:59:59.000Z',
      }, now)
    ).toBe(true)

    expect(
      isLinkDocumentSnapshotStale({
        source: 'link',
        snapshot_path: 'link-docs/teacher/test/doc-1/snapshot',
        synced_at: '2026-04-03T11:00:00.000Z',
      }, now)
    ).toBe(false)

    expect(
      isLinkDocumentSnapshotStale({
        source: 'text',
        snapshot_path: undefined,
        synced_at: null,
      }, now)
    ).toBe(false)
  })

  it('sanitizes synced html snapshots', () => {
    const sanitized = sanitizeSnapshotHtml(
      '<html><head><meta http-equiv="refresh" content="0;url=https://evil.test"><script>alert(1)</script></head><body><a onclick="steal()">Go</a></body></html>',
      'https://docs.example.com/path'
    )

    expect(sanitized).toContain('<base href="https://docs.example.com/path">')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('http-equiv="refresh"')
    expect(sanitized).not.toContain('onclick=')
  })
})
