'use client'

import type { FormEvent, ReactNode, RefObject } from 'react'
import { Input, Button, FormField } from '@/ui'
import { DateActionBar } from '@/components/DateActionBar'
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
  instructions: TiptapContent
  dueAt: string
  classDays?: ClassDay[]
  trackAuthenticity: boolean
  onTitleChange: (next: string) => void
  onInstructionsChange: (next: TiptapContent) => void
  onDueAtChange: (next: string) => void
  onTrackAuthenticityChange: (next: boolean) => void
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
  // Optional extra action button (e.g., Release for drafts)
  extraAction?: {
    label: ReactNode
    onClick: () => void
    variant?: 'primary' | 'success'
  }
}

export function AssignmentForm({
  title,
  instructions,
  dueAt,
  classDays,
  trackAuthenticity,
  onTitleChange,
  onInstructionsChange,
  onDueAtChange,
  onTrackAuthenticityChange,
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
        <div className="min-h-[200px] border border-border-strong rounded-lg overflow-hidden">
          <RichTextEditor
            content={instructions}
            onChange={onInstructionsChange}
            onBlur={onBlur}
            placeholder="Assignment instructions (optional)"
            disabled={disabled}
          />
        </div>
      </div>

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

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={trackAuthenticity}
          onChange={(e) => onTrackAuthenticityChange(e.target.checked)}
          disabled={disabled}
          className="rounded border-border"
        />
        Track writing authenticity
      </label>

      {error && <p className="text-sm text-warning">{error}</p>}

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
    </form>
  )
}
