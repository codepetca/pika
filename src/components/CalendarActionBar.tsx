'use client'

import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, SegmentedControl } from '@/ui'
import { PageActionBar } from '@/components/PageLayout'
import {
  TeacherWorkSurfaceActionBar,
  TeacherWorkSurfaceFloatingActionCluster,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import type { CalendarViewMode } from '@/components/LessonCalendar'
import { cn } from '@/ui/utils'

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
}: CalendarDateNavigatorProps) {
  return (
    <div className={`flex min-w-0 items-center gap-1 sm:gap-2 ${className}`}>
      {showNavigation && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0"
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
          className="truncate rounded-control px-2 py-1 text-sm font-semibold text-text-default transition-colors hover:bg-surface-hover sm:text-base"
          aria-label={labelAriaLabel}
        >
          {label}
        </button>
      ) : (
        <span className="truncate px-2 py-1 text-sm font-semibold text-text-default sm:text-base">
          {label}
        </span>
      )}

      {showNavigation && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0"
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
  const headerLabel = getHeaderLabel(viewMode, currentDate, rangeStart, rangeEnd)
  const hasTrailing = Boolean(trailing)

  return (
    <PageActionBar
      className={cn('pb-10', className)}
      primary={
        <>
          <TeacherWorkSurfaceActionBar
            center={
              <div className="flex max-w-full flex-col items-center justify-center gap-1.5">
                <div className="flex w-full max-w-full items-center justify-center">
                  <CalendarDateNavigator
                    label={headerLabel}
                    onPrev={onPrev}
                    onNext={onNext}
                    onLabelClick={viewMode === 'all' ? undefined : onToday}
                    showNavigation={viewMode !== 'all'}
                    className="max-w-full"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5">
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
                </div>
              </div>
            }
            centerClassName={hasTrailing ? 'max-w-[calc(100vw-9rem)] sm:max-w-[calc(100vw-1rem)]' : undefined}
            centerPlacement="floating"
          />

          {hasTrailing ? (
            <TeacherWorkSurfaceFloatingActionCluster className="left-auto right-3 max-w-[calc(50vw-0.75rem)] translate-x-0 sm:right-4 sm:max-w-[calc(100vw-1rem)]">
              {trailing}
            </TeacherWorkSurfaceFloatingActionCluster>
          ) : null}
        </>
      }
    />
  )
}
