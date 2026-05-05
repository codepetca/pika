'use client'

import { useId } from 'react'
import { Calendar } from 'lucide-react'
import { Button } from '@/ui'

interface ScheduleDateTimePickerProps {
  date: string
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
          <input
            id={dateInputId}
            type="date"
            value={date}
            min={minDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor={timeInputId} className="block text-xs text-text-muted mb-1">{timeLabel}</label>
          <input
            id={timeInputId}
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500"
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
