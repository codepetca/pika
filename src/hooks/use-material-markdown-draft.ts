'use client'

import { useState } from 'react'
import { materialMarkdownToContent, materialToMarkdown } from '@/lib/material-markdown'
import type { TiptapContent } from '@/types'

export function useMaterialMarkdownDraft(content: TiptapContent, disabled: boolean) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [draft, setDraft] = useState(() => materialToMarkdown(content))
  const [baseline, setBaseline] = useState(draft.markdown)
  const [acknowledged, setAcknowledged] = useState(false)
  const [applied, setApplied] = useState(false)
  const dirty = draft.markdown !== baseline
  const canApply = !disabled && dirty && (!draft.warnings.length || acknowledged)

  function reset() {
    const next = materialToMarkdown(content)
    setDraft(next)
    setBaseline(next.markdown)
    setAcknowledged(false)
    setApplied(false)
  }

  function changeMode(next: 'visual' | 'markdown') {
    if (dirty || next === mode) return
    if (next === 'markdown') reset()
    setMode(next)
  }

  function changeMarkdown(markdown: string) {
    if (disabled) return
    setDraft((current) => ({ ...current, markdown }))
    setAcknowledged(false)
    setApplied(false)
  }

  function apply(onContentChange: (next: TiptapContent) => void) {
    if (!canApply) return
    onContentChange(materialMarkdownToContent(draft.markdown))
    setBaseline(draft.markdown)
    setDraft((current) => ({ ...current, warnings: [] }))
    setAcknowledged(false)
    setApplied(true)
  }

  return {
    mode, changeMode, markdown: draft.markdown, changeMarkdown, warnings: draft.warnings,
    dirty, canApply, acknowledged, setAcknowledged, applied, reset, apply,
    previewContent: dirty ? materialMarkdownToContent(draft.markdown) : content,
  }
}
