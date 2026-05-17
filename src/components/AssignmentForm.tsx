'use client'

import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { Eye } from 'lucide-react'
import { Input, Button } from '@/ui'
import { DateActionBar } from '@/components/DateActionBar'
import { BoldIcon } from '@/components/tiptap-icons/bold-icon'
import { Code2Icon } from '@/components/tiptap-icons/code2-icon'
import { ItalicIcon } from '@/components/tiptap-icons/italic-icon'
import { LinkIcon } from '@/components/tiptap-icons/link-icon'
import { ListIcon } from '@/components/tiptap-icons/list-icon'
import { Redo2Icon } from '@/components/tiptap-icons/redo2-icon'
import { Undo2Icon } from '@/components/tiptap-icons/undo2-icon'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'
import type { ClassDay } from '@/types'

interface AssignmentFormProps {
  title: string
  instructionsMarkdown: string
  dueAt: string
  classDays?: ClassDay[]
  extraFields?: ReactNode
  onTitleChange: (next: string) => void
  onInstructionsMarkdownChange: (next: string) => void
  onInstructionsUndo: () => void
  onInstructionsRedo: () => void
  onDueAtChange: (next: string) => void
  onPreviewInstructions?: () => void
  disabled?: boolean
  error?: string
  titleInputRef?: RefObject<HTMLInputElement>
  onBlur?: () => void
  topRowActions?: ReactNode
  statusContent?: ReactNode
  markdownWarning?: string | null
  canUndoInstructions?: boolean
  canRedoInstructions?: boolean
  fillHeight?: boolean
}

export function AssignmentForm({
  title,
  instructionsMarkdown,
  dueAt,
  classDays,
  extraFields,
  onTitleChange,
  onInstructionsMarkdownChange,
  onInstructionsUndo,
  onInstructionsRedo,
  onDueAtChange,
  onPreviewInstructions,
  disabled = false,
  error,
  titleInputRef,
  onBlur,
  topRowActions,
  statusContent,
  markdownWarning,
  canUndoInstructions = false,
  canRedoInstructions = false,
  fillHeight = false,
}: AssignmentFormProps) {
  const instructionsRef = useRef<HTMLTextAreaElement>(null)
  const titleFieldId = useId()
  const topRowGridClassName = topRowActions
    ? 'grid-cols-[minmax(2.75rem,1fr)_auto_auto] sm:grid-cols-[minmax(9rem,1fr)_auto_auto]'
    : 'grid-cols-[minmax(0,1fr)_auto]'
  const titleFieldClassName = topRowActions
    ? 'min-w-0 max-w-[22rem] space-y-1 sm:max-w-[24rem]'
    : 'min-w-0 space-y-1'

  function applyWrapFormatting(prefix: string, suffix = prefix) {
    const textarea = instructionsRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea
    const selected = value.slice(selectionStart, selectionEnd)
    const nextValue = `${value.slice(0, selectionStart)}${prefix}${selected}${suffix}${value.slice(selectionEnd)}`
    onInstructionsMarkdownChange(nextValue)

    requestAnimationFrame(() => {
      const nextCursorStart = selectionStart + prefix.length
      const nextCursorEnd = nextCursorStart + selected.length
      textarea.focus()
      textarea.setSelectionRange(nextCursorStart, nextCursorEnd)
    })
  }

  function applyLinePrefix(prefix: string) {
    const textarea = instructionsRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea
    const blockStart = value.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
    const nextBreak = value.indexOf('\n', selectionEnd)
    const blockEnd = nextBreak === -1 ? value.length : nextBreak
    const block = value.slice(blockStart, blockEnd)
    const lines = block.split('\n')
    const shouldRemove = lines.every((line) => line.trim().length === 0 || line.startsWith(prefix))
    const replacement = lines
      .map((line) => {
        if (line.trim().length === 0) return line
        if (shouldRemove) {
          return line.startsWith(prefix) ? line.slice(prefix.length) : line
        }
        return `${prefix}${line}`
      })
      .join('\n')

    const nextValue = `${value.slice(0, blockStart)}${replacement}${value.slice(blockEnd)}`
    onInstructionsMarkdownChange(nextValue)

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(blockStart, blockStart + replacement.length)
    })
  }

  function applyLinkFormatting() {
    const textarea = instructionsRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea
    const selected = value.slice(selectionStart, selectionEnd) || 'link text'
    const replacement = `[${selected}](https://)`
    const nextValue = `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`
    onInstructionsMarkdownChange(nextValue)

    requestAnimationFrame(() => {
      const hrefStart = selectionStart + selected.length + 3
      const hrefEnd = hrefStart + 'https://'.length
      textarea.focus()
      textarea.setSelectionRange(hrefStart, hrefEnd)
    })
  }

  function handleInstructionsKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isMod = event.metaKey || event.ctrlKey
    if (!isMod) return

    if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault()
      onInstructionsUndo()
      return
    }

    if (
      (event.key.toLowerCase() === 'z' && event.shiftKey) ||
      (!event.metaKey && event.key.toLowerCase() === 'y')
    ) {
      event.preventDefault()
      onInstructionsRedo()
    }
  }

  return (
    <div className={fillHeight ? 'flex h-full min-h-0 w-full flex-col gap-3' : 'space-y-3 w-full'}>
      <div className={`grid items-end gap-1.5 sm:gap-2 ${topRowGridClassName}`}>
        <div className={titleFieldClassName}>
          <label htmlFor={titleFieldId} className="block text-sm font-medium text-text-default">
            Title
            <span className="ml-1 text-danger">*</span>
          </label>
          <Input
            id={titleFieldId}
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onBlur}
            required
            disabled={disabled}
            placeholder="Add a title"
            className="flex-1"
          />
        </div>

        <div className="w-[6.75rem] space-y-1 sm:w-[8.25rem]">
          {(() => {
            const relative = getRelativeDueDate(dueAt, classDays)
            const labelText = relative ? `Due ${relative.text}` : 'Due Date'
            const colorClass = relative
              ? relative.isPast
                ? 'text-warning'
                : 'text-primary'
              : 'text-text-muted'
            return (
              <div className={`truncate text-sm font-medium ${colorClass}`}>
                {labelText}
              </div>
            )
          })()}
          <div className="flex">
            <DateActionBar
              value={dueAt}
              onChange={onDueAtChange}
              layout="compact"
            />
          </div>
        </div>

        {topRowActions && (
          <div className="min-w-0">
            {topRowActions}
          </div>
        )}
      </div>

      <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col space-y-1' : 'space-y-1'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-medium text-text-default">
            Instructions
          </label>
          <div className="flex items-center gap-3">
            {statusContent}
            {onPreviewInstructions && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onPreviewInstructions}
                disabled={disabled}
                className="gap-1.5"
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                Preview
              </Button>
            )}
          </div>
        </div>
        <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-strong' : 'rounded-lg border border-border-strong overflow-hidden'}>
          {markdownWarning && (
            <div className="border-b border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              {markdownWarning}
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-b border-border bg-surface px-2 py-2">
            <Button type="button" variant="ghost" size="sm" onClick={onInstructionsUndo} disabled={disabled || !canUndoInstructions} className="h-8 w-8 px-0" aria-label="Undo" title="Undo">
              <Undo2Icon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onInstructionsRedo} disabled={disabled || !canRedoInstructions} className="h-8 w-8 px-0" aria-label="Redo" title="Redo">
              <Redo2Icon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => applyLinePrefix('### ')} disabled={disabled} className="h-8 w-8 px-0 text-sm font-bold" aria-label="Heading" title="Heading">
              H
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => applyWrapFormatting('**')} disabled={disabled} className="h-8 w-8 px-0" aria-label="Bold" title="Bold">
              <BoldIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => applyWrapFormatting('*')} disabled={disabled} className="h-8 w-8 px-0" aria-label="Italic" title="Italic">
              <ItalicIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => applyLinePrefix('- ')} disabled={disabled} className="h-8 w-8 px-0" aria-label="Bullet list" title="Bullet list">
              <ListIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => applyLinkFormatting()} disabled={disabled} className="h-8 w-8 px-0" aria-label="Link" title="Link">
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => applyWrapFormatting('`')} disabled={disabled} className="h-8 w-8 px-0" aria-label="Inline code" title="Inline code">
              <Code2Icon className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <textarea
            ref={instructionsRef}
            value={instructionsMarkdown}
            onChange={(e) => onInstructionsMarkdownChange(e.target.value)}
            onKeyDown={handleInstructionsKeyDown}
            onBlur={onBlur}
            placeholder="Assignment instructions"
            disabled={disabled}
            spellCheck={false}
            className={fillHeight ? 'min-h-0 w-full flex-1 resize-none border-0 bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-0' : 'min-h-[420px] w-full resize-none border-0 bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-0'}
          />
        </div>
      </div>

      {extraFields}

      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  )
}
