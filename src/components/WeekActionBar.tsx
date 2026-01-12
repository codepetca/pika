'use client'

import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import type { FuturePlansVisibility } from '@/types'

interface WeekActionBarProps {
  weekStart: string // YYYY-MM-DD (Monday)
  onPreviousWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  canNavigateNext?: boolean
  canNavigatePrevious?: boolean
  // Teacher-only: visibility controls
  visibility?: FuturePlansVisibility
  onVisibilityChange?: (visibility: FuturePlansVisibility) => void
  isTeacher?: boolean
}

const visibilityLabels: Record<FuturePlansVisibility, string> = {
  current: 'Current week only',
  next: 'This & next week',
  all: 'All weeks',
}

export function WeekActionBar({
  weekStart,
  onPreviousWeek,
  onNextWeek,
  onToday,
  canNavigateNext = true,
  canNavigatePrevious = true,
  visibility,
  onVisibilityChange,
  isTeacher = false,
}: WeekActionBarProps) {
  const weekStartDate = parseISO(weekStart)
  const weekEndDate = parseISO(weekStart)
  weekEndDate.setDate(weekEndDate.getDate() + 4) // Friday

  // Format: "Jan 12 - 16, 2026" or "Dec 29 - Jan 2, 2026" if crossing months
  const startMonth = format(weekStartDate, 'MMM')
  const endMonth = format(weekEndDate, 'MMM')
  const startDay = format(weekStartDate, 'd')
  const endDay = format(weekEndDate, 'd')
  const year = format(weekEndDate, 'yyyy')

  const dateRange =
    startMonth === endMonth
      ? `${startMonth} ${startDay} - ${endDay}, ${year}`
      : `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPreviousWeek}
          disabled={!canNavigatePrevious}
          className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onToday}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md flex items-center gap-1.5"
        >
          <Calendar className="h-4 w-4" />
          Today
        </button>

        <button
          type="button"
          onClick={onNextWeek}
          disabled={!canNavigateNext}
          className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Next week"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <span className="ml-2 text-sm font-medium text-gray-900 dark:text-white">
          {dateRange}
        </span>
      </div>

      {isTeacher && visibility && onVisibilityChange && (
        <div className="flex items-center gap-2">
          <label htmlFor="visibility-select" className="text-sm text-gray-600 dark:text-gray-400">
            Students can see:
          </label>
          <select
            id="visibility-select"
            value={visibility}
            onChange={(e) => onVisibilityChange(e.target.value as FuturePlansVisibility)}
            className="text-sm px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="current">{visibilityLabels.current}</option>
            <option value="next">{visibilityLabels.next}</option>
            <option value="all">{visibilityLabels.all}</option>
          </select>
        </div>
      )}
    </div>
  )
}
