'use client'

import type { KeyboardEventHandler, MouseEventHandler } from 'react'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'

interface TestTextDocumentViewerProps {
  className?: string
  content: string
  onKeyUp?: KeyboardEventHandler<HTMLDivElement>
  onMouseUp?: MouseEventHandler<HTMLDivElement>
}

export function TestTextDocumentViewer({
  className = 'scrollbar-hover',
  content,
  onKeyUp,
  onMouseUp,
}: TestTextDocumentViewerProps) {
  return (
    <div
      className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-2 p-3 ${className}`.trim()}
      onKeyUp={onKeyUp}
      onMouseUp={onMouseUp}
    >
      <QuestionMarkdown content={content || ''} className="break-words" />
    </div>
  )
}
