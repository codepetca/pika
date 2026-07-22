import type { TiptapContent, TiptapNode } from '@/types'

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Parse content field from database, handling both JSONB and legacy TEXT columns.
 * If content is a string (from TEXT column), parse it as JSON.
 * If content is already an object (from JSONB column), return as-is.
 * Returns an empty doc on parse failure or null/undefined input.
 *
 * Import this instead of defining a local parseContentField in route files.
 */
export function parseContentField(content: unknown): TiptapContent {
  if (content === null || content === undefined) {
    return { type: 'doc', content: [] }
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as TiptapContent
    } catch {
      return { type: 'doc', content: [] }
    }
  }
  return content as TiptapContent
}

/**
 * Validate that content matches Tiptap JSON schema
 */
export function isValidTiptapContent(content: any): content is TiptapContent {
  if (!content || typeof content !== 'object') return false
  if (content.type !== 'doc') return false
  if (content.content !== undefined && !Array.isArray(content.content)) return false

  const stack: Array<{ node: unknown; depth: number }> = (content.content ?? [])
    .map((node: unknown) => ({ node, depth: 1 }))
  let nodeCount = 0

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.depth > 100 || ++nodeCount > 10_000) return false
    if (!current.node || typeof current.node !== 'object' || Array.isArray(current.node)) return false

    const node = current.node as Record<string, unknown>
    if (typeof node.type !== 'string' || node.type.length === 0 || node.type.length > 100) return false
    if (node.text !== undefined && typeof node.text !== 'string') return false
    if (typeof node.text === 'string' && node.text.length > 1_000_000) return false
    if (node.attrs !== undefined && (
      !node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs)
    )) return false
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 100) return false
      for (const mark of node.marks) {
        if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return false
        const markRecord = mark as Record<string, unknown>
        if (typeof markRecord.type !== 'string' || markRecord.type.length === 0) return false
        if (markRecord.attrs !== undefined && (
          !markRecord.attrs || typeof markRecord.attrs !== 'object' || Array.isArray(markRecord.attrs)
        )) return false
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || node.content.length > 10_000) return false
      for (const child of node.content) {
        stack.push({ node: child, depth: current.depth + 1 })
      }
    }
  }
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
 */
export function plainTextToTiptapContent(text: string): TiptapContent {
  if (!text || text.trim() === '') {
    return { type: 'doc', content: [] }
  }

  const paragraphs = text.split('\n').map(line => ({
    type: 'paragraph' as const,
    content: line ? [{ type: 'text' as const, text: line }] : [],
  }))

  return {
    type: 'doc',
    content: paragraphs,
  }
}
