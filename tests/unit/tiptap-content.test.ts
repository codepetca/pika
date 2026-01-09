import { describe, it, expect } from 'vitest'
import {
  isValidTiptapContent,
  extractPlainText,
  countWords,
  countCharacters,
  isEmpty,
  plainTextToTiptapContent,
} from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

describe('tiptap-content utilities', () => {
  describe('isValidTiptapContent', () => {
    it('should validate empty document', () => {
      const content: TiptapContent = { type: 'doc', content: [] }
      expect(isValidTiptapContent(content)).toBe(true)
    })

    it('should validate document with paragraph', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        ],
      }
      expect(isValidTiptapContent(content)).toBe(true)
    })

    it('should reject non-doc type', () => {
      const content = { type: 'paragraph', content: [] }
      expect(isValidTiptapContent(content as any)).toBe(false)
    })

    it('should reject missing type', () => {
      const content = { content: [] }
      expect(isValidTiptapContent(content as any)).toBe(false)
    })

    it('should reject invalid content array', () => {
      const content = { type: 'doc', content: 'invalid' }
      expect(isValidTiptapContent(content as any)).toBe(false)
    })

    it('should handle document without content field', () => {
      const content: TiptapContent = { type: 'doc' }
      expect(isValidTiptapContent(content)).toBe(true)
    })
  })

  describe('extractPlainText', () => {
    it('should extract text from simple paragraph', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        ],
      }
      expect(extractPlainText(content)).toBe('Hello world')
    })

    it('should extract text from multiple paragraphs with newlines', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
        ],
      }
      expect(extractPlainText(content)).toBe('Line 1\nLine 2')
    })

    it('should handle bold/italic marks', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Bold text', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      }
      expect(extractPlainText(content)).toBe('Bold text')
    })

    it('should handle headings', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Title' }],
          },
        ],
      }
      expect(extractPlainText(content)).toBe('Title')
    })

    it('should handle bullet lists', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 1' }],
                  },
                ],
              },
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 2' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      expect(extractPlainText(content)).toBe('Item 1\nItem 2')
    })

    it('should handle ordered lists', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'First' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      expect(extractPlainText(content)).toContain('First')
    })

    it('should handle code blocks', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            content: [{ type: 'text', text: 'const x = 1;' }],
          },
        ],
      }
      expect(extractPlainText(content)).toBe('const x = 1;')
    })

    it('should return empty string for empty document', () => {
      const content: TiptapContent = { type: 'doc', content: [] }
      expect(extractPlainText(content)).toBe('')
    })

    it('should return empty string for document without content', () => {
      const content: TiptapContent = { type: 'doc' }
      expect(extractPlainText(content)).toBe('')
    })

    it('should handle mixed content types', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Section' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Point' }] },
                ],
              },
            ],
          },
        ],
      }
      expect(extractPlainText(content)).toBe('Intro\nSection\nPoint')
    })

    it('should handle paragraph without content', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }
      expect(extractPlainText(content)).toBe('')
    })
  })

  describe('isEmpty', () => {
    it('should return true for empty document', () => {
      const content: TiptapContent = { type: 'doc', content: [] }
      expect(isEmpty(content)).toBe(true)
    })

    it('should return true for document without content', () => {
      const content: TiptapContent = { type: 'doc' }
      expect(isEmpty(content)).toBe(true)
    })

    it('should return true for document with only empty paragraph', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }
      expect(isEmpty(content)).toBe(true)
    })

    it('should return false for document with text', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        ],
      }
      expect(isEmpty(content)).toBe(false)
    })

    it('should return true for whitespace-only text', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
        ],
      }
      expect(isEmpty(content)).toBe(true)
    })

    it('should return true for newline-only text', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '\n\n' }] },
        ],
      }
      expect(isEmpty(content)).toBe(true)
    })

    it('should return false for text with content after trim', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '  test  ' }] },
        ],
      }
      expect(isEmpty(content)).toBe(false)
    })
  })

  describe('plainTextToTiptapContent', () => {
    it('should return empty document for empty text', () => {
      expect(plainTextToTiptapContent('')).toEqual({ type: 'doc', content: [] })
    })

    it('should create a paragraph for single-line text', () => {
      const content = plainTextToTiptapContent('Hello world')
      expect(content).toEqual({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      })
    })

    it('should split multi-line text into paragraphs', () => {
      const content = plainTextToTiptapContent('Line 1\nLine 2')
      expect(content).toEqual({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Line 1' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Line 2' }],
          },
        ],
      })
    })
  })

  describe('countCharacters', () => {
    it('should count characters correctly', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        ],
      }
      expect(countCharacters(content)).toBe(5)
    })

    it('should not count formatting marks', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      }
      expect(countCharacters(content)).toBe(4)
    })

    it('should count characters across multiple paragraphs including newlines', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Bye' }] },
        ],
      }
      // "Hi\nBye" = 6 characters (2 + 1 newline + 3)
      expect(countCharacters(content)).toBe(6)
    })

    it('should return 0 for empty document', () => {
      const content: TiptapContent = { type: 'doc', content: [] }
      expect(countCharacters(content)).toBe(0)
    })

    it('should count spaces', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        ],
      }
      expect(countCharacters(content)).toBe(11)
    })
  })

  describe('countWords', () => {
    it('should count words correctly', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world test' }],
          },
        ],
      }
      expect(countWords(content)).toBe(3)
    })

    it('should handle multiple spaces', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello    world' }],
          },
        ],
      }
      expect(countWords(content)).toBe(2)
    })

    it('should handle newlines', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
        ],
      }
      expect(countWords(content)).toBe(2)
    })

    it('should return 0 for empty document', () => {
      const content: TiptapContent = { type: 'doc', content: [] }
      expect(countWords(content)).toBe(0)
    })

    it('should handle whitespace-only content', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
        ],
      }
      expect(countWords(content)).toBe(0)
    })

    it('should count words with punctuation', () => {
      const content: TiptapContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello, world! How are you?' }],
          },
        ],
      }
      expect(countWords(content)).toBe(5)
    })
  })
})
