import type { TiptapContent, TiptapNode } from '@/types'

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
