'use client'

import type { ReactNode } from 'react'
import { sanitizeLinkHref } from '@/lib/tiptap-content'

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string }

interface QuestionMarkdownProps {
  content: string
  className?: string
}

type InlineTokenType = 'code' | 'link' | 'bold' | 'italic'
type InlineToken = {
  type: InlineTokenType
  index: number
  match: RegExpExecArray
  rank: number
}

function findNextInlineToken(text: string): InlineToken | null {
  const patterns: Array<{
    type: InlineTokenType
    regex: RegExp
  }> = [
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

function parseInline(text: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (!text) return []
  if (depth > 6) return [text]

  const nodes: ReactNode[] = []
  let remaining = text
  let tokenIndex = 0

  while (remaining.length > 0) {
    const token = findNextInlineToken(remaining)
    if (!token) {
      nodes.push(remaining)
      break
    }

    const { index: matchIndex, match, type } = token
    if (matchIndex > 0) {
      nodes.push(remaining.slice(0, matchIndex))
    }

    const fullMatch = match[0]
    if (!fullMatch) {
      nodes.push(remaining)
      break
    }

    const key = `${keyPrefix}-${depth}-${tokenIndex}`
    tokenIndex += 1

    if (type === 'code') {
      nodes.push(
        <code
          key={key}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-text-default"
        >
          {match[1]}
        </code>
      )
    } else if (type === 'link') {
      const label = match[1]
      const href = sanitizeLinkHref(match[2])
      if (href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline hover:text-primary-hover"
          >
            {label}
          </a>
        )
      } else {
        nodes.push(label)
      }
    } else if (type === 'bold') {
      nodes.push(
        <strong key={key} className="font-semibold">
          {parseInline(match[1] || '', `${key}-b`, depth + 1)}
        </strong>
      )
    } else if (type === 'italic') {
      nodes.push(
        <em key={key} className="italic">
          {parseInline(match[1] || '', `${key}-i`, depth + 1)}
        </em>
      )
    }

    remaining = remaining.slice(matchIndex + fullMatch.length)
  }

  return nodes
}

function parseInlineWithLineBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []

  lines.forEach((line, index) => {
    if (index > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />)
    }
    nodes.push(...parseInline(line, `${keyPrefix}-line-${index}`))
  })

  return nodes
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

function parseBlocks(rawContent: string): MarkdownBlock[] {
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
      const level = headingMatch[1].length as 1 | 2 | 3
      blocks.push({ type: 'heading', level, text: headingMatch[2] })
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

export function QuestionMarkdown({ content, className = '' }: QuestionMarkdownProps) {
  const blocks = parseBlocks(content)

  if (blocks.length === 0) {
    return <div className={`text-sm text-text-muted ${className}`}>—</div>
  }

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`

        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h4 key={key} className="text-base font-semibold text-text-default">
                {parseInline(block.text, key)}
              </h4>
            )
          }
          if (block.level === 2) {
            return (
              <h5 key={key} className="text-sm font-semibold text-text-default">
                {parseInline(block.text, key)}
              </h5>
            )
          }
          return (
            <h6 key={key} className="text-sm font-medium text-text-default">
              {parseInline(block.text, key)}
            </h6>
          )
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5 text-sm text-text-default whitespace-pre-wrap">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`} className="whitespace-pre-wrap">
                  {parseInline(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          )
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5 text-sm text-text-default whitespace-pre-wrap">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`} className="whitespace-pre-wrap">
                  {parseInline(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </ol>
          )
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key} className="border-l-2 border-border pl-3 text-sm text-text-muted whitespace-pre-wrap">
              {parseInlineWithLineBreaks(block.text, key)}
            </blockquote>
          )
        }

        if (block.type === 'code') {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-md bg-surface-2 px-3 py-2 text-xs text-text-default"
            >
              <code className="font-mono whitespace-pre">{block.code || '\n'}</code>
            </pre>
          )
        }

        return (
          <p key={key} className="text-sm text-text-default whitespace-pre-wrap">
            {parseInlineWithLineBreaks(block.text, key)}
          </p>
        )
      })}
    </div>
  )
}
