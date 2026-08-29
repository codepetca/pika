'use client'

import type { ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { SegmentedControl, cn } from '@/ui'
import { PageActionBar } from '@/components/PageLayout'
import { DateNavigator } from '@/components/DateNavigator'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
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
      className={cn('pb-2', className)}
      primary={
        <TeacherWorkSurfaceContextBar
          ariaLabel="Calendar controls"
          primaryClassName="max-w-full"
          primary={
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
              <DateNavigator
                label={headerLabel}
                onPrev={onPrev}
                onNext={onNext}
                onLabelClick={viewMode === 'all' ? undefined : onToday}
                showNavigation={viewMode !== 'all'}
                className="max-w-full"
                joined
              />
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
          }
        />
      }
    />
  )
}
