'use client'

import { useId, useRef, type ReactNode } from 'react'
import { DateActionBar } from '@/components/DateActionBar'
import { ACTIONBAR_BUTTON_CLASSNAME } from '@/components/PageLayout'
import { ClassworkModalTopLineField } from '@/components/classwork/ClassworkContentModal'
import { cn } from '@/ui/utils'

type ClassworkDueFieldsProps = {
  dueDate: string
  dueTime: string
  disabled?: boolean
  onDueDateChange: (next: string) => void
  onDueTimeChange: (next: string) => void
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

function formatTimeLabel(value: string): string {
  const [hourPart, minutePart] = value.split(':')
  const hour = Number(hourPart)
  const minute = Number(minutePart)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 'Select time'

  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

function ClassworkTimeAction({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const timeInputRef = useRef<HTMLInputElement>(null)
  const timeInputId = useId()

  return (
    <div>
      <label className="sr-only" htmlFor={timeInputId}>Time</label>
      <input
        ref={timeInputRef}
        id={timeInputId}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
      <button
        type="button"
        className={cn(ACTIONBAR_BUTTON_CLASSNAME, 'w-[6.75rem] text-center sm:w-[8.25rem]')}
        disabled={disabled}
        onClick={() => timeInputRef.current?.showPicker()}
      >
        {formatTimeLabel(value)}
      </button>
    </div>
  )
}

export function ClassworkDueFields({
  dueDate,
  dueTime,
  disabled,
  onDueDateChange,
  onDueTimeChange,
}: ClassworkDueFieldsProps) {
  return (
    <div className="min-w-0 lg:w-[18rem]">
      <ClassworkModalTopLineField label="Due" required className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DateActionBar value={dueDate} onChange={onDueDateChange} layout="compact" disabled={disabled} />
          <ClassworkTimeAction value={dueTime} disabled={disabled} onChange={onDueTimeChange} />
        </div>
      </ClassworkModalTopLineField>
    </div>
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
          <label htmlFor={dateInputId} className="sr-only">{dateLabel}</label>
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
          <label htmlFor={timeInputId} className="sr-only">{timeLabel}</label>
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
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  )
}
