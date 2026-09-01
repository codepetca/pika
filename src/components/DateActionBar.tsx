'use client'

import { useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { DateLabelButton } from '@/components/DateLabelButton'

interface DateActionBarProps {
  value: string
  onChange: (next: string) => void
  rightActions?: React.ReactNode
  className?: string
  layout?: 'default' | 'compact'
  subtitle?: string | null
}

export function DateActionBar({
  value,
  onChange,
  rightActions,
  className = '',
  layout = 'default',
  subtitle,
}: DateActionBarProps) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const formattedDate = value ? format(parseISO(value), 'EEE MMM d') : ''
  const isCompact = layout === 'compact'
  const containerClassName = isCompact
    ? 'flex items-center gap-2'
    : 'flex w-full flex-wrap items-center justify-between gap-4'
  const buttonClassName = isCompact
    ? 'w-[6.75rem] text-center sm:w-[8.25rem]'
    : 'min-w-[7rem] text-center'

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

        <DateLabelButton
          type="button"
          variant="subtle"
          size="sm"
          className={`${buttonClassName}${subtitle ? ' flex-col gap-0' : ''}`}
          onClick={() => dateInputRef.current?.showPicker()}
          label={formattedDate || 'Select date'}
          subtitle={subtitle}
          reserveSubtitleSpace
          ariaLabel={formattedDate || 'Select date'}
        />
      </div>

      {rightActions && <div className="flex items-center gap-2">{rightActions}</div>}
    </div>
  )
}
