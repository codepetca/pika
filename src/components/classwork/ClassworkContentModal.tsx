'use client'

import { useId, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { Select } from '@/ui'
import { cn } from '@/ui/utils'
import type { SurveyDuePolicy } from '@/types'

type ClassworkContentModalShellProps = {
  isOpen: boolean
  title: string
  titleId: string
  closeLabel: string
  closeDisabled?: boolean
  maxWidth?: string
  contentClassName?: string
  onClose: () => void
  children: ReactNode
}

type DateTimeFieldsProps = {
  label: string
  date: string
  time: string
  disabled?: boolean
  required?: boolean
  error?: string | null
  dateLabel?: string
  timeLabel?: string
  className?: string
  trailing?: ReactNode
  onDateChange: (next: string) => void
  onTimeChange: (next: string) => void
}

type SurveyDuePolicySelectProps = {
  value: SurveyDuePolicy
  disabled?: boolean
  onChange: (next: SurveyDuePolicy) => void
}

const SURVEY_DUE_POLICY_OPTIONS = [
  { value: 'soft', label: 'Soft due' },
  { value: 'hard', label: 'Hard due' },
]

export function ClassworkContentModalShell({
  isOpen,
  title,
  titleId,
  closeLabel,
  closeDisabled,
  maxWidth,
  contentClassName,
  onClose,
  children,
}: ClassworkContentModalShellProps) {
  return (
    <CreationModalShell
      isOpen={isOpen}
      title={title}
      titleId={titleId}
      closeLabel={closeLabel}
      closeDisabled={closeDisabled}
      maxWidth={maxWidth}
      contentClassName={contentClassName}
      onClose={onClose}
    >
      {children}
    </CreationModalShell>
  )
}

export function DateTimeFields({
  label,
  date,
  time,
  disabled,
  required = false,
  error,
  dateLabel = 'Date',
  timeLabel = 'Time',
  className,
  trailing,
  onDateChange,
  onTimeChange,
}: DateTimeFieldsProps) {
  const dateInputId = useId()
  const timeInputId = useId()

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-default">
          {label}
          {required && <span className="ml-1 text-danger">*</span>}
        </span>
        {trailing}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
        <div>
          <label htmlFor={dateInputId} className="sr-only">
            {dateLabel}
          </label>
          <input
            id={dateInputId}
            type="date"
            value={date}
            required={required}
            disabled={disabled}
            onChange={(event) => onDateChange(event.target.value)}
            className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2 disabled:opacity-60"
          />
        </div>
        <div>
          <label htmlFor={timeInputId} className="sr-only">
            {timeLabel}
          </label>
          <input
            id={timeInputId}
            type="time"
            value={time}
            required={required}
            disabled={disabled}
            onChange={(event) => onTimeChange(event.target.value)}
            className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2 disabled:opacity-60"
          />
        </div>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function SurveyDuePolicySelect({
  value,
  disabled,
  onChange,
}: SurveyDuePolicySelectProps) {
  const selectId = useId()
  const helpText = value === 'hard'
    ? 'Hard due closes student responses at the due date.'
    : 'Soft due shows a due date but keeps the survey open. Students can still respond or amend while the survey is open.'

  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-h-5 items-center gap-1.5">
        <label htmlFor={selectId} className="text-sm font-medium text-text-default">
          Due mode
        </label>
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-text-muted"
          title={helpText}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Due mode help</span>
        </span>
      </div>
      <Select
        id={selectId}
        value={value}
        disabled={disabled}
        options={SURVEY_DUE_POLICY_OPTIONS}
        onChange={(event) => onChange(event.target.value as SurveyDuePolicy)}
      />
    </div>
  )
}
