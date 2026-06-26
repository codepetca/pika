'use client'

import { useRef } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { Button } from '@/ui'
import {
  ClassworkModalTopLine,
  ClassworkModalTopLineField,
} from '@/components/classwork/ClassworkContentModal'
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
      <ClassworkModalTopLine
        title={title}
        titlePlaceholder="Add a title"
        titleDisabled={disabled}
        titleInputRef={titleInputRef}
        titleStatus={statusContent}
        onTitleChange={onTitleChange}
        onTitleBlur={onBlur}
        meta={(
          (() => {
            const relative = getRelativeDueDate(dueAt, classDays)
            const labelText = relative ? `Due ${relative.text}` : 'Due Date'
            const tone = relative
              ? relative.isPast
                ? 'warning'
                : 'primary'
              : 'muted'

            return (
              <ClassworkModalTopLineField
                label={labelText}
                tone={tone}
                className="lg:w-[8.25rem]"
              >
              <DateActionBar
                value={dueAt}
                onChange={onDueAtChange}
                layout="compact"
                disabled={disabled}
              />
              </ClassworkModalTopLineField>
            )
          })()
        )}
        primaryActions={topRowActions}
      />

      {extraFields}

      <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : ''}>
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

      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  )
}
