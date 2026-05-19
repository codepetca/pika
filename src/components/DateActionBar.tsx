'use client'

import { useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { ACTIONBAR_BUTTON_CLASSNAME } from '@/components/PageLayout'

interface DateActionBarProps {
  value: string
  onChange: (next: string) => void
  rightActions?: React.ReactNode
  className?: string
  layout?: 'default' | 'compact'
}

export function DateActionBar({
  value,
  onChange,
  rightActions,
  className = '',
  layout = 'default',
}: DateActionBarProps) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const formattedDate = value ? format(parseISO(value), 'EEE MMM d') : ''
  const isCompact = layout === 'compact'
  const containerClassName = isCompact
    ? 'flex items-center gap-2'
    : 'flex w-full flex-wrap items-center justify-between gap-4'
  const buttonClassName = isCompact
    ? `${ACTIONBAR_BUTTON_CLASSNAME} w-[6.75rem] text-center sm:w-[8.25rem]`
    : `${ACTIONBAR_BUTTON_CLASSNAME} min-w-[7rem] text-center`

  return (
    <div className={[containerClassName, className].join(' ')}>
      <div className="flex flex-wrap items-center gap-2">
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
          className={buttonClassName}
          onClick={() => dateInputRef.current?.showPicker()}
        >
          {formattedDate || 'Select date'}
        </button>
      </div>

      {rightActions && <div className="flex items-center gap-2">{rightActions}</div>}
    </div>
  )
}
