'use client'

import type { FormEvent, ReactNode, RefObject } from 'react'
import { Input, Button, FormField } from '@/ui'
import { DateActionBar } from '@/components/DateActionBar'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { RichTextEditor } from '@/components/editor'
import { getTodayInToronto } from '@/lib/timezone'
import type { ClassDay, TiptapContent } from '@/types'

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
  legacyInstructions: TiptapContent
  dueAt: string
  classDays?: ClassDay[]
  extraFields?: ReactNode
  onTitleChange: (next: string) => void
  onInstructionsMarkdownChange: (next: string) => void
  onLegacyInstructionsChange: (next: TiptapContent) => void
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
  legacyInstructions,
  dueAt,
  classDays,
  extraFields,
  onTitleChange,
  onInstructionsMarkdownChange,
  onLegacyInstructionsChange,
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
  extraAction,
}: AssignmentFormProps) {
  const isSubmitDisabled = disabled || submitDisabled || !title || !dueAt

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
          placeholder="Assignment title"
        />
      </FormField>

      <div>
        <label className="block text-sm font-medium text-text-muted mb-1">
          Instructions
        </label>
        <div className="rounded-lg border border-border-strong overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Markdown First</span>
            <span>Preview and legacy fallback below</span>
          </div>
          {markdownWarning && (
            <div className="border-b border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              {markdownWarning}
            </div>
          )}
          <div className="grid min-h-[260px] gap-0 md:grid-cols-2">
            <div className="border-r border-border">
              <div className="border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Author Markdown
              </div>
              <textarea
                value={instructionsMarkdown}
                onChange={(e) => onInstructionsMarkdownChange(e.target.value)}
                onBlur={onBlur}
                placeholder="Assignment instructions in markdown (optional)"
                disabled={disabled}
                spellCheck={false}
                className="min-h-[220px] w-full resize-y border-0 bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-0"
              />
            </div>
            <div className="bg-page">
              <div className="border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Preview
              </div>
              <div className="min-h-[220px] p-3">
                <LimitedMarkdown
                  content={instructionsMarkdown}
                  emptyPlaceholder={<div className="text-sm text-text-muted">No assignment details provided.</div>}
                />
              </div>
            </div>
          </div>
          <details className="border-t border-border bg-surface">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-muted">
              Legacy Rich Text Editor
            </summary>
            <div className="min-h-[200px] border-t border-border">
              <RichTextEditor
                content={legacyInstructions}
                onChange={onLegacyInstructionsChange}
                onBlur={onBlur}
                placeholder="Legacy assignment instructions"
                disabled={disabled}
              />
            </div>
          </details>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Supported markdown: headings, lists, bold, italic, links, inline code, and fenced code blocks.
        </p>
      </div>

      {extraFields}

      <div>
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

      {error && <p className="text-sm text-warning">{error}</p>}

      {footerContent ?? (
        <div className="flex gap-2 justify-end">
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
    </form>
  )
}
