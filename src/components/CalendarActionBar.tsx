'use client'

import type { ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, SegmentedControl } from '@/ui'
import { PageActionBar } from '@/components/PageLayout'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import type { CalendarViewMode } from '@/components/LessonCalendar'
import { cn } from '@/ui'

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

interface CalendarDateNavigatorProps {
  label: string
  onPrev?: () => void
  onNext?: () => void
  onLabelClick?: () => void
  showNavigation?: boolean
  labelAriaLabel?: string
  prevAriaLabel?: string
  nextAriaLabel?: string
  className?: string
  labelClassName?: string
  joined?: boolean
}

export function getCalendarHeaderLabel(
  viewMode: CalendarViewMode,
  currentDate: Date,
  rangeStart?: string | null,
  rangeEnd?: string | null,
) {
  if (viewMode === 'week' || viewMode === 'month') {
    return format(currentDate, 'MMMM yyyy')
  }

  if (rangeStart && rangeEnd) {
    return `${format(parseISO(rangeStart), 'MMM d, yyyy')} - ${format(parseISO(rangeEnd), 'MMM d, yyyy')}`
  }

  return 'All Dates'
}

export function CalendarDateNavigator({
  label,
  onPrev,
  onNext,
  onLabelClick,
  showNavigation = true,
  labelAriaLabel = 'Go to today',
  prevAriaLabel = 'Previous',
  nextAriaLabel = 'Next',
  className = '',
  labelClassName = '',
  joined = false,
}: CalendarDateNavigatorProps) {
  return (
    <div className={cn(
      'flex min-w-0 items-center',
      joined
        ? 'overflow-hidden rounded-control border border-border-strong bg-surface'
        : 'gap-1 sm:gap-2',
      className,
    )}>
      {showNavigation && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-9 w-9 px-0',
            joined && 'rounded-none border-0 border-r border-border',
          )}
          onClick={onPrev}
          aria-label={prevAriaLabel}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}

      {onLabelClick ? (
        <button
          type="button"
          onClick={onLabelClick}
          className={cn(
            'min-w-0 truncate px-2 py-1 text-sm font-semibold text-text-default transition-colors hover:bg-surface-hover sm:text-base',
            joined ? 'min-h-control rounded-none' : 'rounded-control',
            labelClassName,
          )}
          aria-label={labelAriaLabel}
        >
          {label}
        </button>
      ) : (
        <span className={cn(
          'min-w-0 truncate px-2 py-1 text-sm font-semibold text-text-default sm:text-base',
          joined && 'flex min-h-control items-center',
          labelClassName,
        )}>
          {label}
        </span>
      )}

      {showNavigation && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-9 w-9 px-0',
            joined && 'rounded-none border-0 border-l border-border',
          )}
          onClick={onNext}
          aria-label={nextAriaLabel}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
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
  const headerLabel = getCalendarHeaderLabel(viewMode, currentDate, rangeStart, rangeEnd)

  return (
    <PageActionBar
      className={cn('pb-14 sm:pb-2', className)}
      primary={
        <TeacherWorkSurfaceActionBar
          label={
            <CalendarDateNavigator
              label={headerLabel}
              onPrev={onPrev}
              onNext={onNext}
              onLabelClick={viewMode === 'all' ? undefined : onToday}
              showNavigation={viewMode !== 'all'}
              className="max-w-full"
            />
          }
          labelClassName="w-max"
          centerClassName="top-[5.75rem] sm:top-[3.25rem]"
          center={
            <div className="flex max-w-full flex-col items-center justify-center gap-1.5">
              <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
                <SegmentedControl<CalendarViewMode>
                  ariaLabel="Calendar view"
                  value={viewMode}
                  onChange={onViewModeChange}
                  capitalizeLabels
                  options={[
                    { value: 'week', label: 'Week' },
                    { value: 'month', label: 'Month' },
                    { value: 'all', label: 'All' },
                  ]}
                />
                {trailing}
              </div>
            </div>
          }
          centerPlacement="floating"
        />
      }
    />
  )
}
