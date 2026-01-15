'use client'

import { useMemo } from 'react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, isWeekend } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { LessonDayCell } from './LessonDayCell'
import type { LessonPlan, TiptapContent, Classroom } from '@/types'

const TIMEZONE = 'America/Toronto'

export type CalendarViewMode = 'week' | 'month' | 'all'

interface LessonCalendarProps {
  classroom: Classroom
  lessonPlans: LessonPlan[]
  viewMode: CalendarViewMode
  currentDate: Date
  editable: boolean
  onDateChange: (date: Date) => void
  onViewModeChange: (mode: CalendarViewMode) => void
  onContentChange?: (date: string, content: TiptapContent) => void
  onCopy?: (fromDate: string) => void
  holidays?: Set<string>
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Grid: weekends ~4%, weekdays ~18.4% each (totals 100%)
const GRID_COLUMNS = '4% 18.4% 18.4% 18.4% 18.4% 18.4% 4%'

export function LessonCalendar({
  classroom,
  lessonPlans,
  viewMode,
  currentDate,
  editable,
  onDateChange,
  onViewModeChange,
  onContentChange,
  onCopy,
  holidays = new Set(),
}: LessonCalendarProps) {
  const today = useMemo(() => toZonedTime(new Date(), TIMEZONE), [])

  // Build a map of date -> lesson plan for quick lookup
  const plansByDate = useMemo(() => {
    const map = new Map<string, LessonPlan>()
    lessonPlans.forEach((plan) => {
      map.set(plan.date, plan)
    })
    return map
  }, [lessonPlans])

  // Calculate days to display based on view mode
  const days = useMemo(() => {
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
      return eachDayOfInterval({ start: weekStart, end: weekEnd })
    }

    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate)
      const monthEnd = endOfMonth(currentDate)
      // Extend to full weeks
      const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
      const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
      return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
    }

    // 'all' mode: show entire term if available
    if (classroom.start_date && classroom.end_date) {
      const termStart = new Date(classroom.start_date)
      const termEnd = new Date(classroom.end_date)
      // Extend to full weeks
      const calendarStart = startOfWeek(termStart, { weekStartsOn: 0 })
      const calendarEnd = endOfWeek(termEnd, { weekStartsOn: 0 })
      return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
    }

    // Fallback: show current month
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  // Group days into weeks for rendering
  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7))
    }
    return result
  }, [days])

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === 'week') {
      onDateChange(subWeeks(currentDate, 1))
    } else if (viewMode === 'month') {
      onDateChange(subMonths(currentDate, 1))
    }
  }

  const handleNext = () => {
    if (viewMode === 'week') {
      onDateChange(addWeeks(currentDate, 1))
    } else if (viewMode === 'month') {
      onDateChange(addMonths(currentDate, 1))
    }
  }

  const handleToday = () => {
    onDateChange(today)
  }

  // Format header label
  const headerLabel = useMemo(() => {
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
    }
    if (viewMode === 'month') {
      return format(currentDate, 'MMMM yyyy')
    }
    // 'all' mode
    if (classroom.start_date && classroom.end_date) {
      return `${format(new Date(classroom.start_date), 'MMM d, yyyy')} - ${format(new Date(classroom.end_date), 'MMM d, yyyy')}`
    }
    return 'All Dates'
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  return (
    <div className="flex flex-col h-full">
      {/* Header with navigation and view mode selector */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          {viewMode !== 'all' && (
            <>
              <button
                onClick={handlePrev}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Previous"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={handleNext}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Next"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                onClick={handleToday}
                className="px-3 py-1.5 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Today
              </button>
            </>
          )}
          <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
            {headerLabel}
          </span>
        </div>

        {/* View mode selector */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(['week', 'month', 'all'] as CalendarViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={`px-3 py-1 text-sm rounded-md capitalize transition-colors ${
                viewMode === mode
                  ? 'bg-white dark:bg-gray-700 shadow-sm font-medium'
                  : 'hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Day headers */}
      <div
        className="grid border-b border-gray-200 dark:border-gray-700"
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        {DAY_LABELS.map((label, idx) => {
          const isWeekendDay = idx === 0 || idx === 6
          return (
            <div
              key={label}
              className={`py-2 text-center text-sm font-medium ${
                isWeekendDay
                  ? 'text-gray-400 dark:text-gray-500'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {isWeekendDay ? label.charAt(0) : label}
            </div>
          )
        })}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        {weeks.map((week, weekIdx) => (
          <div
            key={weekIdx}
            className="grid border-b border-gray-200 dark:border-gray-700 last:border-b-0"
            style={{
              gridTemplateColumns: GRID_COLUMNS,
              minHeight: '80px',
            }}
          >
            {week.map((day) => {
              const dateString = format(day, 'yyyy-MM-dd')
              const lessonPlan = plansByDate.get(dateString) || null
              const isToday = isSameDay(day, today)
              const isWeekendDay = isWeekend(day)
              const isHoliday = holidays.has(dateString)

              return (
                <LessonDayCell
                  key={dateString}
                  date={dateString}
                  day={day}
                  lessonPlan={lessonPlan}
                  isWeekend={isWeekendDay}
                  isToday={isToday}
                  isHoliday={isHoliday}
                  editable={editable && !isWeekendDay}
                  compact={viewMode !== 'week'}
                  onContentChange={onContentChange}
                  onCopy={onCopy}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
