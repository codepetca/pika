'use client'

import { LimitedMarkdown } from '@/components/LimitedMarkdown'

interface QuestionMarkdownProps {
  content: string
  className?: string
}

export function QuestionMarkdown({ content, className = '' }: QuestionMarkdownProps) {
  return <LimitedMarkdown content={content} className={className} />
}
