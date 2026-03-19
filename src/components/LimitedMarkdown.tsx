'use client'

import type { ReactNode } from 'react'
import { sanitizeLinkHref } from '@/lib/tiptap-content'
import { parseLimitedMarkdownBlocks } from '@/lib/limited-markdown'

interface LimitedMarkdownProps {
  content: string
  className?: string
  emptyPlaceholder?: ReactNode
}

type InlineTokenType = 'code' | 'link' | 'bold' | 'italic'

type InlineToken = {
  type: InlineTokenType
  index: number
  match: RegExpExecArray
  rank: number
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

export function LimitedMarkdown({
  content,
  className = '',
  emptyPlaceholder = <div className="text-sm text-text-muted">—</div>,
}: LimitedMarkdownProps) {
  const blocks = parseLimitedMarkdownBlocks(content)

  if (blocks.length === 0) {
    return <div className={className}>{emptyPlaceholder}</div>
  }

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`

        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h1 key={key} className="text-xl font-semibold text-text-default">
                {parseInlineWithLineBreaks(block.text, key)}
              </h1>
            )
          }
          if (block.level === 2) {
            return (
              <h2 key={key} className="text-lg font-semibold text-text-default">
                {parseInlineWithLineBreaks(block.text, key)}
              </h2>
            )
          }
          return (
            <h3 key={key} className="text-base font-semibold text-text-default">
              {parseInlineWithLineBreaks(block.text, key)}
            </h3>
          )
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5 text-sm text-text-default">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>
                  {parseInlineWithLineBreaks(item, `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ul>
          )
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5 text-sm text-text-default">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>
                  {parseInlineWithLineBreaks(item, `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ol>
          )
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={key}
              className="border-l-4 border-border-strong pl-3 italic text-text-muted"
            >
              {parseInlineWithLineBreaks(block.text, key)}
            </blockquote>
          )
        }

        if (block.type === 'code') {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-lg bg-gray-900 p-4 font-mono text-sm text-gray-100"
            >
              <code>{block.code}</code>
            </pre>
          )
        }

        return (
          <p key={key} className="whitespace-pre-wrap text-sm text-text-default">
            {parseInlineWithLineBreaks(block.text, key)}
          </p>
        )
      })}
    </div>
  )
}
