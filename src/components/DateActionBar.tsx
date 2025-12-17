'use client'

import { useRef } from 'react'
import { format, parseISO } from 'date-fns'

interface DateActionBarProps {
  value: string
  onChange: (next: string) => void
  onPrev: () => void
  onNext: () => void
  rightActions?: React.ReactNode
}

export function DateActionBar({ value, onChange, onPrev, onNext, rightActions }: DateActionBarProps) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const formattedDate = value ? format(parseISO(value), 'EEE MMM d') : ''
  const navButtonClasses =
    'px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={navButtonClasses} onClick={onPrev}>
          ←
        </button>

        <input
          ref={dateInputRef}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
          tabIndex={-1}
        />

        <button
          type="button"
          className={navButtonClasses}
          onClick={() => dateInputRef.current?.showPicker()}
        >
          {formattedDate || 'Select date'}
        </button>

        <button type="button" className={navButtonClasses} onClick={onNext}>
          →
        </button>
      </div>

      {rightActions && <div className="flex items-center gap-2">{rightActions}</div>}
    </div>
  )
}
