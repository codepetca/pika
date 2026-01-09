import type { TiptapContent, TiptapNode } from '@/types'

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Validate that content matches Tiptap JSON schema
 */
export function isValidTiptapContent(content: any): content is TiptapContent {
  if (!content || typeof content !== 'object') return false
  if (content.type !== 'doc') return false
  if (content.content && !Array.isArray(content.content)) return false
  return true
}

/**
 * Extract plain text from Tiptap JSON content
 * Preserves paragraph breaks as newlines
 */
export function extractPlainText(content: TiptapContent): string {
  if (!content.content || content.content.length === 0) {
    return ''
  }

  const lines: string[] = []

  function extractFromNode(node: TiptapNode): string {
    if (node.type === 'text') {
      return node.text || ''
    }

    if (node.content && node.content.length > 0) {
      return node.content.map(extractFromNode).join('')
    }

    return ''
  }

  for (const node of content.content) {
    if (
      node.type === 'paragraph' ||
      node.type === 'heading' ||
      node.type === 'codeBlock'
    ) {
      lines.push(extractFromNode(node))
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      // Extract text from list items
      if (node.content) {
        for (const item of node.content) {
          lines.push(extractFromNode(item))
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * Check if Tiptap content is empty (no text content)
 */
export function isEmpty(content: TiptapContent): boolean {
  const plainText = extractPlainText(content).trim()
  return plainText.length === 0
}

/**
 * Count characters in Tiptap content (plain text, no formatting)
 */
export function countCharacters(content: TiptapContent): number {
  return extractPlainText(content).length
}

/**
 * Count words in Tiptap content
 */
export function countWords(content: TiptapContent): number {
  const plainText = extractPlainText(content).trim()
  if (!plainText) return 0

  return plainText.split(/\s+/).filter((word) => word.length > 0).length
}

export function isSafeLinkHref(href: string): boolean {
  const trimmed = String(href ?? '').trim()
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

export function sanitizeLinkHref(input: string): string | null {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return null

  // Allow raw emails by converting to mailto:.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`
  }

  const candidates = [trimmed]
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    candidates.push(`https://${trimmed}`)
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      if (ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return url.href
    } catch {
      // try next candidate
    }
  }

  return null
}

/**
 * Convert plain text to TipTap JSON content
 * Used for backward compatibility when loading entries without rich_content
 *
 * @param text - Plain text string to convert
 * @returns TipTap content with text converted to paragraphs
 */
export function plainTextToTiptapContent(text: string): TiptapContent {
  if (!text || text.trim() === '') {
    return { type: 'doc', content: [] }
  }

  // Split by newlines to create paragraphs
  const paragraphs = text.split('\n').map(line => ({
    type: 'paragraph' as const,
    content: line ? [{ type: 'text' as const, text: line }] : []
  }))

  return {
    type: 'doc',
    content: paragraphs
  }
}
