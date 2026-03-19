import { sanitizeLinkHref } from '@/lib/tiptap-content'
import type { TiptapContent, TiptapMark, TiptapNode } from '@/types'

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string }

type InlineTokenType = 'code' | 'link' | 'bold' | 'italic'

type InlineToken = {
  type: InlineTokenType
  index: number
  match: RegExpExecArray
  rank: number
}

export type TiptapMarkdownResult = {
  markdown: string
  warnings: string[]
  hasLossyConversion: boolean
}

const WARNING_IMAGES = 'Images were simplified when converting to markdown.'
const WARNING_MARKS = 'Some rich text formatting was simplified when converting to markdown.'
const WARNING_BLOCKS = 'Some rich block formatting was simplified when converting to markdown.'

function pushWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) {
    warnings.push(warning)
  }
}

function findNextInlineToken(text: string): InlineToken | null {
  const patterns: Array<{ type: InlineTokenType; regex: RegExp }> = [
    { type: 'code', regex: /`([^`\n]+?)`/ },
    { type: 'link', regex: /\[([^\]\n]+?)\]\(([^)\n]+?)\)/ },
    { type: 'bold', regex: /\*\*([^\n]+?)\*\*/ },
    { type: 'italic', regex: /\*([^*\n]+?)\*/ },
  ]

  let best: InlineToken | null = null

  patterns.forEach(({ type, regex }, rank) => {
    const match = regex.exec(text)
    if (!match || typeof match.index !== 'number') return

    if (!best || match.index < best.index || (match.index === best.index && rank < best.rank)) {
      best = { type, index: match.index, match, rank }
    }
  })

  return best
}

function isStartOfBlock(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  return (
    trimmed.startsWith('```') ||
    /^#{1,3}\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed)
  )
}

export function parseLimitedMarkdownBlocks(rawContent: string): MarkdownBlock[] {
  const normalized = String(rawContent ?? '').replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return []

  const rawLines = normalized.split('\n')
  let start = 0
  let end = rawLines.length
  while (start < end && rawLines[start].trim().length === 0) start += 1
  while (end > start && rawLines[end - 1].trim().length === 0) end -= 1
  const lines = rawLines.slice(start, end)
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length && lines[index].trim().startsWith('```')) {
        index += 1
      }
      blocks.push({ type: 'code', code: codeLines.join('\n') })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      })
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(/^[-*]\s+(.+)$/)
        if (!itemMatch) break
        items.push(itemMatch[1])
        index += 1
      }
      blocks.push({ type: 'unordered-list', items })
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(/^\d+\.\s+(.+)$/)
        if (!itemMatch) break
        items.push(itemMatch[1])
        index += 1
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const quoteMatch = lines[index].trim().match(/^>\s?(.*)$/)
        if (!quoteMatch) break
        quoteLines.push(quoteMatch[1])
        index += 1
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index]
      if (!current.trim() || isStartOfBlock(current)) break
      paragraphLines.push(current)
      index += 1
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

function createMarkedTextNode(text: string, marks: TiptapMark[] = []): TiptapNode | null {
  if (!text) return null
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }
}

function parseInlineToTiptap(text: string, activeMarks: TiptapMark[] = [], depth = 0): TiptapNode[] {
  if (!text) return []
  if (depth > 6) {
    const fallback = createMarkedTextNode(text, activeMarks)
    return fallback ? [fallback] : []
  }

  const nodes: TiptapNode[] = []
  let remaining = text

  while (remaining.length > 0) {
    const token = findNextInlineToken(remaining)
    if (!token) {
      const tail = createMarkedTextNode(remaining, activeMarks)
      if (tail) nodes.push(tail)
      break
    }

    if (token.index > 0) {
      const prefix = createMarkedTextNode(remaining.slice(0, token.index), activeMarks)
      if (prefix) nodes.push(prefix)
    }

    const fullMatch = token.match[0]
    if (!fullMatch) {
      const fallback = createMarkedTextNode(remaining, activeMarks)
      if (fallback) nodes.push(fallback)
      break
    }

    if (token.type === 'code') {
      const node = createMarkedTextNode(token.match[1] || '', [...activeMarks, { type: 'code' }])
      if (node) nodes.push(node)
    } else if (token.type === 'link') {
      const href = sanitizeLinkHref(token.match[2] || '')
      if (href) {
        const label = createMarkedTextNode(token.match[1] || '', [
          ...activeMarks,
          { type: 'link', attrs: { href } },
        ])
        if (label) nodes.push(label)
      } else {
        const fallback = createMarkedTextNode(token.match[1] || '', activeMarks)
        if (fallback) nodes.push(fallback)
      }
    } else if (token.type === 'bold') {
      nodes.push(...parseInlineToTiptap(token.match[1] || '', [...activeMarks, { type: 'bold' }], depth + 1))
    } else if (token.type === 'italic') {
      nodes.push(...parseInlineToTiptap(token.match[1] || '', [...activeMarks, { type: 'italic' }], depth + 1))
    }

    remaining = remaining.slice(token.index + fullMatch.length)
  }

  return nodes
}

function paragraphTextToContent(text: string): TiptapNode[] {
  const nodes: TiptapNode[] = []
  const lines = text.split('\n')

  lines.forEach((line, index) => {
    nodes.push(...parseInlineToTiptap(line))
    if (index < lines.length - 1) {
      nodes.push({ type: 'hardBreak' })
    }
  })

  return nodes
}

function paragraphNode(text: string): TiptapNode {
  const content = paragraphTextToContent(text)
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

export function markdownToTiptapContent(markdown: string): TiptapContent {
  const blocks = parseLimitedMarkdownBlocks(markdown)
  if (blocks.length === 0) {
    return { type: 'doc', content: [] }
  }

  const content: TiptapNode[] = blocks.map((block) => {
    if (block.type === 'heading') {
      const inline = paragraphTextToContent(block.text)
      return inline.length > 0
        ? { type: 'heading', attrs: { level: block.level }, content: inline }
        : { type: 'heading', attrs: { level: block.level } }
    }

    if (block.type === 'unordered-list' || block.type === 'ordered-list') {
      return {
        type: block.type === 'unordered-list' ? 'bulletList' : 'orderedList',
        content: block.items.map((item) => ({
          type: 'listItem',
          content: [paragraphNode(item)],
        })),
      }
    }

    if (block.type === 'code') {
      return block.code
        ? { type: 'codeBlock', content: [{ type: 'text', text: block.code }] }
        : { type: 'codeBlock' }
    }

    if (block.type === 'blockquote') {
      return {
        type: 'blockquote',
        content: block.text
          .split('\n\n')
          .filter(Boolean)
          .map((paragraph) => paragraphNode(paragraph)),
      }
    }

    return paragraphNode(block.text)
  })

  return { type: 'doc', content }
}

function marksKey(marks: TiptapMark[] | undefined): string {
  if (!marks || marks.length === 0) return ''
  return JSON.stringify(
    marks.map((mark) => ({
      type: mark.type,
      attrs: mark.attrs ?? null,
    }))
  )
}

function mergeTextNodes(nodes: TiptapNode[]): TiptapNode[] {
  const merged: TiptapNode[] = []
  for (const node of nodes) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.type === 'text' &&
      node.type === 'text' &&
      marksKey(previous.marks) === marksKey(node.marks)
    ) {
      previous.text = `${previous.text || ''}${node.text || ''}`
    } else {
      merged.push(node)
    }
  }
  return merged
}

function wrapTextWithMarks(text: string, marks: TiptapMark[] | undefined, warnings: string[]): string {
  if (!text) return ''
  let value = text

  const codeMark = marks?.find((mark) => mark.type === 'code')
  if (codeMark) {
    return `\`${value}\``
  }

  const linkMark = marks?.find((mark) => mark.type === 'link')
  if (linkMark && typeof linkMark.attrs?.href === 'string') {
    value = `[${value}](${linkMark.attrs.href})`
  }

  const boldMark = marks?.find((mark) => mark.type === 'bold')
  if (boldMark) {
    value = `**${value}**`
  }

  const italicMark = marks?.find((mark) => mark.type === 'italic')
  if (italicMark) {
    value = `*${value}*`
  }

  if (marks?.some((mark) => !['code', 'link', 'bold', 'italic'].includes(mark.type))) {
    pushWarning(warnings, WARNING_MARKS)
  }

  return value
}

function inlineContentToMarkdown(nodes: TiptapNode[] | undefined, warnings: string[]): string {
  if (!nodes || nodes.length === 0) return ''

  return mergeTextNodes(nodes).map((node) => {
    if (node.type === 'text') {
      return wrapTextWithMarks(node.text || '', node.marks, warnings)
    }
    if (node.type === 'hardBreak') {
      return '\n'
    }
    if (node.type === 'image') {
      pushWarning(warnings, WARNING_IMAGES)
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : 'Image'
      return src ? `[${alt}](${src})` : alt
    }
    if (node.content && node.content.length > 0) {
      return inlineContentToMarkdown(node.content, warnings)
    }

    pushWarning(warnings, WARNING_BLOCKS)
    return ''
  }).join('')
}

function blockNodeToMarkdown(
  node: TiptapNode,
  warnings: string[],
  orderedListIndex = 1
): string[] {
  if (node.type === 'paragraph') {
    return [inlineContentToMarkdown(node.content, warnings).trimEnd()]
  }

  if (node.type === 'heading') {
    const level = Math.min(3, Math.max(1, Number(node.attrs?.level || 1)))
    return [`${'#'.repeat(level)} ${inlineContentToMarkdown(node.content, warnings).trimEnd()}`]
  }

  if (node.type === 'codeBlock') {
    const code = inlineContentToMarkdown(node.content, warnings)
    return [`\`\`\`\n${code}\n\`\`\``]
  }

  if (node.type === 'blockquote') {
    const text = (node.content || [])
      .flatMap((child) => blockNodeToMarkdown(child, warnings))
      .join('\n')
      .split('\n')
      .map((line) => `> ${line}`.trimEnd())
      .join('\n')
    return [text]
  }

  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
    const isOrdered = node.type === 'orderedList'
    const items = (node.content || []).flatMap((item, index) => {
      const itemText = (item.content || [])
        .flatMap((child) => blockNodeToMarkdown(child, warnings))
        .join('\n')
        .trim()
      const prefix = isOrdered ? `${orderedListIndex + index}. ` : '- '
      return itemText
        .split('\n')
        .map((line, lineIndex) => (lineIndex === 0 ? `${prefix}${line}` : `  ${line}`))
    })
    return [items.join('\n')]
  }

  if (node.type === 'horizontalRule') {
    return ['---']
  }

  if (node.type === 'image') {
    pushWarning(warnings, WARNING_IMAGES)
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : 'Image'
    return [src ? `[${alt}](${src})` : alt]
  }

  if (node.type === 'doc') {
    return (node.content || []).flatMap((child) => blockNodeToMarkdown(child, warnings))
  }

  if (node.content && node.content.length > 0) {
    pushWarning(warnings, WARNING_BLOCKS)
    return [inlineContentToMarkdown(node.content, warnings).trimEnd()]
  }

  pushWarning(warnings, WARNING_BLOCKS)
  return []
}

export function tiptapToMarkdown(content: TiptapContent | null | undefined): TiptapMarkdownResult {
  if (!content?.content || content.content.length === 0) {
    return { markdown: '', warnings: [], hasLossyConversion: false }
  }

  const warnings: string[] = []
  const markdown = content.content
    .flatMap((node) => blockNodeToMarkdown(node, warnings))
    .filter((block) => block.trim().length > 0)
    .join('\n\n')
    .trim()

  return {
    markdown,
    warnings,
    hasLossyConversion: warnings.length > 0,
  }
}

export function limitedMarkdownToPlainText(markdown: string): string {
  const blocks = parseLimitedMarkdownBlocks(markdown)

  return blocks.map((block) => {
    if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'blockquote') {
      return block.text
    }
    if (block.type === 'unordered-list' || block.type === 'ordered-list') {
      return block.items.join('\n')
    }
    return block.code
  }).join('\n\n').trim()
}
