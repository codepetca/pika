import { describe, expect, it } from 'vitest'
import {
  getTestDocumentValidationError,
  normalizeTestDocuments,
  validateTestDocumentsPayload,
} from '@/lib/test-documents'

describe('test-documents', () => {
  it('normalizes valid documents and drops invalid entries', () => {
    const result = normalizeTestDocuments([
      { id: 'doc-1', title: ' Java API ', url: 'https://docs.oracle.com', source: 'link' },
      { id: 'doc-2', title: ' Allowed Syntax ', source: 'text', content: 'if, else, switch' },
      { id: 'bad', title: 'Bad', url: 'javascript:alert(1)', source: 'link' },
    ])

    expect(result).toEqual([
      {
        id: 'doc-1',
        title: 'Java API',
        url: 'https://docs.oracle.com',
        source: 'link',
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
})
