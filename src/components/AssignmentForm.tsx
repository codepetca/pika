'use client'

import { useRef } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import { Input, Button, FormField } from '@/ui'
import { DateActionBar } from '@/components/DateActionBar'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { BoldIcon } from '@/components/tiptap-icons/bold-icon'
import { Code2Icon } from '@/components/tiptap-icons/code2-icon'
import { ItalicIcon } from '@/components/tiptap-icons/italic-icon'
import { LinkIcon } from '@/components/tiptap-icons/link-icon'
import { ListIcon } from '@/components/tiptap-icons/list-icon'
import { Redo2Icon } from '@/components/tiptap-icons/redo2-icon'
import { Undo2Icon } from '@/components/tiptap-icons/undo2-icon'
import { getTodayInToronto } from '@/lib/timezone'
import type { ClassDay } from '@/types'

function countClassDaysBetween(classDays: ClassDay[], fromDate: string, toDate: string): number {
  // Count class days between two dates (exclusive of fromDate, inclusive of toDate)
  const start = fromDate < toDate ? fromDate : toDate
  const end = fromDate < toDate ? toDate : fromDate
  const count = classDays.filter(day =>
    day.is_class_day && day.date > start && day.date <= end
  ).length
  return fromDate < toDate ? count : -count
}

function getRelativeDays(dueAt: string, classDays?: ClassDay[]): { text: string; isPast: boolean } | null {
  if (!dueAt) return null
  const today = getTodayInToronto()

  // If we have class days, count class days instead of calendar days
  if (classDays && classDays.length > 0) {
    const classCount = countClassDaysBetween(classDays, today, dueAt)
    const isPast = classCount < 0
    const absCount = Math.abs(classCount)

    if (dueAt === today) return { text: 'today', isPast: false }
    if (absCount === 0) {
      // No classes between, but not today - show as next/last class
      return isPast
        ? { text: 'last class', isPast: true }
        : { text: 'next class', isPast: false }
    }
    if (absCount === 1) {
      return isPast
        ? { text: 'last class', isPast: true }
        : { text: 'next class', isPast: false }
    }
    return isPast
      ? { text: `${absCount} classes ago`, isPast: true }
      : { text: `in ${absCount} classes`, isPast: false }
  }

  // Fallback to calendar days if no class days provided
  const due = new Date(dueAt + 'T00:00:00')
  const todayDate = new Date(today + 'T00:00:00')
  const diffTime = due.getTime() - todayDate.getTime()
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return { text: 'today', isPast: false }
  if (diffDays === 1) return { text: 'tomorrow', isPast: false }
  if (diffDays === -1) return { text: 'yesterday', isPast: true }
  if (diffDays > 0) return { text: `in ${diffDays} days`, isPast: false }
  return { text: `${Math.abs(diffDays)} days ago`, isPast: true }
}

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
  onPrevDate: () => void
  onNextDate: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
  submitLabel: string
  cancelLabel?: string
  disabled?: boolean
  submitDisabled?: boolean
  error?: string
  titleInputRef?: RefObject<HTMLInputElement>
  onBlur?: () => void
  footerContent?: ReactNode
  markdownWarning?: string | null
  canUndoInstructions?: boolean
  canRedoInstructions?: boolean
  // Optional extra action button (e.g., Release for drafts)
  extraAction?: {
    label: ReactNode
    onClick: () => void
    variant?: 'primary' | 'success'
  }
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
  onPrevDate,
  onNextDate,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel = 'Cancel',
  disabled = false,
  submitDisabled = false,
  error,
  titleInputRef,
  onBlur,
  footerContent,
  markdownWarning,
  canUndoInstructions = false,
  canRedoInstructions = false,
  extraAction,
}: AssignmentFormProps) {
  const isSubmitDisabled = disabled || submitDisabled || !title || !dueAt
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
    <form onSubmit={onSubmit} className="space-y-3 w-full">
      <FormField label="Title" required>
        <Input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onBlur={onBlur}
          required
          disabled={disabled}
          placeholder="Add a title"
        />
      </FormField>

      <FormField label="Instructions">
        <div className="rounded-lg border border-border-strong overflow-hidden">
          {markdownWarning && (
            <div className="border-b border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              {markdownWarning}
            </div>
          )}
          <div className="grid min-h-[260px] gap-0 md:grid-cols-2">
            <div className="flex h-full min-h-0 flex-col border-b border-border md:border-b-0 md:border-r md:border-border">
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
                className="h-full min-h-[220px] w-full flex-1 resize-none border-0 bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-0"
              />
            </div>
            <div className="bg-page">
              <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Preview
              </div>
              <div className="min-h-[220px] px-3 pb-3">
                <LimitedMarkdown
                  content={instructionsMarkdown}
                  emptyPlaceholder={<div className="text-sm text-text-muted">No assignment details provided.</div>}
                />
              </div>
            </div>
          </div>
        </div>
      </FormField>

      {extraFields}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          {(() => {
            const relative = getRelativeDays(dueAt, classDays)
            const labelText = relative ? `Due ${relative.text}` : 'Due Date'
            const colorClass = relative
              ? relative.isPast
                ? 'text-warning'
                : 'text-primary'
              : 'text-text-muted'
            return (
              <label className={`block text-sm font-medium mb-1 ${colorClass}`}>
                {labelText}
              </label>
            )
          })()}
          <DateActionBar value={dueAt} onChange={onDueAtChange} onPrev={onPrevDate} onNext={onNextDate} />
        </div>

        {footerContent ?? (
          <div className="flex gap-2 justify-end lg:flex-shrink-0">
            <Button type="submit" disabled={isSubmitDisabled} className="min-w-[5.5rem]">
              {submitLabel}
            </Button>
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel} disabled={disabled} className="min-w-[5.5rem]">
                {cancelLabel}
              </Button>
            )}
            {extraAction && (
              <Button
                type="button"
                variant={extraAction.variant === 'success' ? 'success' : 'secondary'}
                onClick={extraAction.onClick}
                disabled={disabled}
                className="min-w-[5.5rem]"
              >
                {extraAction.label}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-warning">{error}</p>}
    </form>
  )
}
