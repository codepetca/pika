'use client'

import { useEffect, useRef, useState } from 'react'
import { markdownToTiptapContent, tiptapToMarkdown } from '@/lib/limited-markdown'
import type { TiptapContent } from '@/types'
import { RichTextEditor, type RichTextEditorProps } from './RichTextEditor'

export interface MarkdownContentEditorProps
  extends Omit<RichTextEditorProps, 'content' | 'onChange'> {
  markdown: string
  onMarkdownChange: (markdown: string) => void
  onConversionWarningChange?: (warning: string | null) => void
}

/**
 * WYSIWYG editor for fields whose compatibility boundary is limited Markdown.
 *
 * TipTap JSON stays local so cursor position and undo history are preserved;
 * callers continue to read and write the existing Markdown value.
 */
export function MarkdownContentEditor({
  markdown,
  onMarkdownChange,
  onConversionWarningChange,
  ...editorProps
}: MarkdownContentEditorProps) {
  const lastEmittedMarkdownRef = useRef(markdown)
  const [content, setContent] = useState<TiptapContent>(
    () => markdownToTiptapContent(markdown),
  )

  useEffect(() => {
    if (markdown === lastEmittedMarkdownRef.current) return
    lastEmittedMarkdownRef.current = markdown
    setContent(markdownToTiptapContent(markdown))
  }, [markdown])

  function handleContentChange(nextContent: TiptapContent) {
    setContent(nextContent)
    const converted = tiptapToMarkdown(nextContent)
    lastEmittedMarkdownRef.current = converted.markdown
    onConversionWarningChange?.(
      converted.hasLossyConversion ? converted.warnings.join(' ') : null,
    )
    onMarkdownChange(converted.markdown)
  }

  return (
    <RichTextEditor
      {...editorProps}
      content={content}
      onChange={handleContentChange}
    />
  )
}
