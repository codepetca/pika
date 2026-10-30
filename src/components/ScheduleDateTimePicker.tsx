'use client'

import { useId, type Ref } from 'react'
import { Calendar } from 'lucide-react'
import { format, isValid, parseISO } from 'date-fns'
import { Button, Input } from '@/ui'

interface ScheduleDateTimePickerProps {
  date: string
  dateInputRef?: Ref<HTMLInputElement>
  time: string
  minDate?: string
  isFutureValid: boolean
  onDateChange: (next: string) => void
  onTimeChange: (next: string) => void
  onConfirm: () => void
  onCancel?: () => void
  confirmLabel?: string
  cancelLabel?: string
  cancelVariant?: 'secondary' | 'danger'
  title?: string
  dateLabel?: string
  timeLabel?: string
  showHeader?: boolean
  showTimezoneLabel?: boolean
  className?: string
  contextLabel?: string | null
  contextTone?: 'primary' | 'warning' | 'muted'
  validationMessage?: string | null
}

export function ScheduleDateTimePicker({
  date,
  dateInputRef,
  time,
  minDate,
  isFutureValid,
  onDateChange,
  onTimeChange,
  onConfirm,
  onCancel,
  confirmLabel = 'Done',
  cancelLabel = 'Cancel',
  cancelVariant = 'secondary',
  title = 'Schedule',
  dateLabel = 'Date (Toronto)',
  timeLabel = 'Time (Toronto)',
  showHeader = true,
  showTimezoneLabel = true,
  className = '',
  contextLabel,
  contextTone = 'muted',
  validationMessage,
}: ScheduleDateTimePickerProps) {
  const dateInputId = useId()
  const timeInputId = useId()
  const parsedDate = date ? parseISO(date) : null
  const readableDate = parsedDate && isValid(parsedDate) ? format(parsedDate, 'EEE MMM d, yyyy') : ''
  const contextToneClass =
    contextTone === 'warning'
      ? 'text-warning'
      : contextTone === 'primary'
        ? 'text-primary'
        : 'text-text-muted'

  return (
    <div className={`bg-surface rounded-lg shadow-lg border border-border p-3 ${className}`.trim()}>
      {showHeader && (
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-medium text-text-default">{title}</span>
        </div>
      )}

      {contextLabel && (
        <p className={`mb-3 text-sm font-medium ${contextToneClass}`}>
          {contextLabel}
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor={dateInputId} className="block text-xs text-text-muted mb-1">{dateLabel}</label>
          <div className="relative">
            <input
              ref={dateInputRef}
              id={dateInputId}
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => onDateChange(e.target.value)}
              onClick={(e) => {
                try { e.currentTarget.showPicker?.() } catch { /* Native input remains usable. */ }
              }}
              className="peer !absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <Input
              type="text"
              value={readableDate}
              placeholder="Choose a date"
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none pr-10 peer-focus-visible:border-primary peer-focus-visible:ring-foundation peer-focus-visible:ring-focus"
            />
            <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          </div>
        </div>

        <div>
          <label htmlFor={timeInputId} className="block text-xs text-text-muted mb-1">{timeLabel}</label>
          <input
            id={timeInputId}
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus-visible:border-primary focus-visible:ring-foundation focus-visible:ring-focus"
          />
        </div>
      </div>

      {showTimezoneLabel && (
        <p className="mt-2 text-xs text-text-muted">Timezone: America/Toronto</p>
      )}

      {date && !isFutureValid && (
        <p className="text-xs text-danger mt-2">Schedule must be in the future</p>
      )}

      {validationMessage && (
        <p className="text-xs text-danger mt-2">{validationMessage}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        {onCancel && (
          <Button variant={cancelVariant} size="sm" className="flex-1" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          className={onCancel ? 'flex-1' : 'w-full'}
          onClick={onConfirm}
          disabled={!date || !isFutureValid || !!validationMessage}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
