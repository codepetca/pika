'use client'

import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, cn } from '@/ui'
import { PageActionBar } from '@/components/PageLayout'
import type { CalendarViewMode } from '@/components/LessonCalendar'

interface CalendarActionBarProps {
  viewMode: CalendarViewMode
  currentDate: Date
  rangeStart?: string | null
  rangeEnd?: string | null
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onViewModeChange: (mode: CalendarViewMode) => void
  trailing?: ReactNode
  className?: string
}

function getHeaderLabel(viewMode: CalendarViewMode, currentDate: Date, rangeStart?: string | null, rangeEnd?: string | null) {
  if (viewMode === 'week' || viewMode === 'month') {
    return format(currentDate, 'MMMM yyyy')
  }

  if (rangeStart && rangeEnd) {
    return `${format(new Date(rangeStart), 'MMM d, yyyy')} - ${format(new Date(rangeEnd), 'MMM d, yyyy')}`
  }

  return 'All Dates'
}

export function CalendarActionBar({
  viewMode,
  currentDate,
  rangeStart,
  rangeEnd,
  onPrev,
  onNext,
  onToday,
  onViewModeChange,
  trailing,
  className = '',
}: CalendarActionBarProps) {
  const headerLabel = getHeaderLabel(viewMode, currentDate, rangeStart, rangeEnd)

  return (
    <PageActionBar
      className={className}
      primary={
        <div className="relative flex min-h-9 w-full items-center">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            {viewMode !== 'all' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                onClick={onPrev}
                aria-label="Previous"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}

            <button
              type="button"
              onClick={onToday}
              className="truncate rounded-control px-2 py-1 text-sm font-semibold text-text-default transition-colors hover:bg-surface-hover sm:text-base"
              aria-label="Go to today"
            >
              {headerLabel}
            </button>

            {viewMode !== 'all' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                onClick={onNext}
                aria-label="Next"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:flex items-center gap-1 rounded-control bg-surface-2 p-0.5">
            {(['week', 'month', 'all'] as CalendarViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                className={cn(
                  'rounded-control px-3 py-1 text-xs font-medium capitalize transition-colors sm:text-sm',
                  viewMode === mode
                    ? 'bg-info-bg text-primary'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-default'
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:absolute sm:right-0 sm:top-1/2 sm:-translate-y-1/2">
            <div className="flex items-center gap-1 rounded-control bg-surface-2 p-0.5 sm:hidden">
              {(['week', 'month', 'all'] as CalendarViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onViewModeChange(mode)}
                  className={cn(
                    'rounded-control px-3 py-1 text-xs font-medium capitalize transition-colors',
                    viewMode === mode
                      ? 'bg-info-bg text-primary'
                      : 'text-text-muted hover:bg-surface-hover hover:text-text-default'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            {trailing}
          </div>
        </div>
      }
    />
  )
}
