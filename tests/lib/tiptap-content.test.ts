import { describe, it, expect } from 'vitest'
import {
  parseContentField,
  isValidTiptapContent,
  extractPlainText,
  isEmpty,
  countCharacters,
  countWords,
  plainTextToTiptapContent,
  isSafeLinkHref,
  sanitizeLinkHref,
} from '@/lib/tiptap-content'

describe('parseContentField', () => {
  it('returns empty doc for null', () => {
    expect(parseContentField(null)).toEqual({ type: 'doc', content: [] })
  })

  it('returns empty doc for undefined', () => {
    expect(parseContentField(undefined)).toEqual({ type: 'doc', content: [] })
  })

  it('parses valid JSON string', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }
    const result = parseContentField(JSON.stringify(doc))
    expect(result).toEqual(doc)
  })

  it('returns empty doc for invalid JSON string', () => {
    expect(parseContentField('not valid json {')).toEqual({ type: 'doc', content: [] })
  })

  it('returns empty doc for empty string', () => {
    // Empty string is not valid JSON
    expect(parseContentField('')).toEqual({ type: 'doc', content: [] })
  })

  it('returns object as-is when already an object', () => {
    const doc = { type: 'doc', content: [] }
    expect(parseContentField(doc)).toBe(doc)
  })

  it('returns object passthrough for complex Tiptap content', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Test paragraph' }],
        },
      ],
    }
    expect(parseContentField(doc)).toBe(doc)
  })

  it('parses JSON string with nested content', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    }
    expect(parseContentField(JSON.stringify(doc))).toEqual(doc)
  })
})

describe('isValidTiptapContent', () => {
  it('returns true for valid doc', () => {
    expect(isValidTiptapContent({ type: 'doc', content: [] })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isValidTiptapContent(null)).toBe(false)
  })

  it('returns false for wrong type', () => {
    expect(isValidTiptapContent({ type: 'paragraph' })).toBe(false)
  })

  it('returns false for non-array content', () => {
    expect(isValidTiptapContent({ type: 'doc', content: 'oops' })).toBe(false)
  })

  it('returns true when content is undefined (no content key)', () => {
    expect(isValidTiptapContent({ type: 'doc' })).toBe(true)
  })
})

describe('extractPlainText', () => {
  it('returns empty string for empty doc', () => {
    expect(extractPlainText({ type: 'doc', content: [] })).toBe('')
  })

  it('extracts text from a paragraph', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Hello world')
  })

  it('joins multiple paragraphs with newlines', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Line 1\nLine 2')
  })
})

describe('isEmpty', () => {
  it('returns true for empty doc', () => {
    expect(isEmpty({ type: 'doc', content: [] })).toBe(true)
  })

  it('returns true for whitespace-only doc', () => {
    const doc = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
    }
    expect(isEmpty(doc)).toBe(true)
  })

  it('returns false for doc with text', () => {
    const doc = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    }
    expect(isEmpty(doc)).toBe(false)
  })
})

describe('countCharacters', () => {
  it('returns 0 for empty doc', () => {
    expect(countCharacters({ type: 'doc', content: [] })).toBe(0)
  })

  it('counts characters correctly', () => {
    const doc = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    expect(countCharacters(doc)).toBe(5)
  })
})

describe('countWords', () => {
  it('returns 0 for empty doc', () => {
    expect(countWords({ type: 'doc', content: [] })).toBe(0)
  })

  it('counts words correctly', () => {
    const doc = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world test' }] }],
    }
    expect(countWords(doc)).toBe(3)
  })
})

describe('plainTextToTiptapContent', () => {
  it('converts empty string to empty doc', () => {
    expect(plainTextToTiptapContent('')).toEqual({ type: 'doc', content: [] })
  })

  it('converts single line to single paragraph', () => {
    const result = plainTextToTiptapContent('Hello')
    expect(result.content).toHaveLength(1)
    expect(result.content![0].type).toBe('paragraph')
  })

  it('converts multiple lines to multiple paragraphs', () => {
    const result = plainTextToTiptapContent('Line 1\nLine 2\nLine 3')
    expect(result.content).toHaveLength(3)
  })
})

describe('isSafeLinkHref', () => {
  it('returns true for a valid https URL', () => {
    expect(isSafeLinkHref('https://example.com')).toBe(true)
  })

  it('returns true for a valid http URL', () => {
    expect(isSafeLinkHref('http://example.com')).toBe(true)
  })

  it('returns true for a mailto link', () => {
    expect(isSafeLinkHref('mailto:user@example.com')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isSafeLinkHref('')).toBe(false)
  })

  it('returns false for an invalid URL (triggers catch branch)', () => {
    expect(isSafeLinkHref('not a url at all %%')).toBe(false)
  })

  it('returns false for javascript: protocol', () => {
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false)
  })
})

describe('sanitizeLinkHref', () => {
  it('returns null for empty string', () => {
    expect(sanitizeLinkHref('')).toBeNull()
  })

  it('converts raw email to mailto: link', () => {
    expect(sanitizeLinkHref('user@example.com')).toBe('mailto:user@example.com')
  })

  it('returns the URL for a valid https link', () => {
    expect(sanitizeLinkHref('https://example.com')).toBe('https://example.com/')
  })

  it('prepends https:// when no scheme is given', () => {
    expect(sanitizeLinkHref('example.com')).toBe('https://example.com/')
  })

  it('returns null for an unparseable input that cannot be fixed with https://', () => {
    expect(sanitizeLinkHref('javascript:alert(1)')).toBeNull()
  })
})
