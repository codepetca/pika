'use client'

import { useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ACTIONBAR_BUTTON_CLASSNAME, ACTIONBAR_ICON_BUTTON_CLASSNAME } from '@/components/PageLayout'

interface DateActionBarProps {
  value: string
  onChange: (next: string) => void
  onPrev: () => void
  onNext: () => void
  rightActions?: React.ReactNode
  className?: string
}

export function DateActionBar({ value, onChange, onPrev, onNext, rightActions, className = '' }: DateActionBarProps) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const formattedDate = value ? format(parseISO(value), 'EEE MMM d') : ''

  return (
    <div className={['flex w-full flex-wrap items-center justify-between gap-4', className].join(' ')}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ACTIONBAR_ICON_BUTTON_CLASSNAME} onClick={onPrev} aria-label="Previous day">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
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
          className={ACTIONBAR_BUTTON_CLASSNAME}
          onClick={() => dateInputRef.current?.showPicker()}
        >
          {formattedDate || 'Select date'}
        </button>

        <button type="button" className={ACTIONBAR_ICON_BUTTON_CLASSNAME} onClick={onNext} aria-label="Next day">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {rightActions && <div className="flex items-center gap-2">{rightActions}</div>}
    </div>
  )
}
