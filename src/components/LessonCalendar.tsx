'use client'

import { useMemo, useState, useEffect } from 'react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, isWeekend } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ChevronLeft, ChevronRight, Code, CircleDot } from 'lucide-react'
import { LessonDayCell } from './LessonDayCell'
import type { LessonPlan, TiptapContent, Classroom, Assignment } from '@/types'

const TIMEZONE = 'America/Toronto'

export type CalendarViewMode = 'week' | 'month' | 'all'

interface LessonCalendarProps {
  classroom: Classroom
  lessonPlans: LessonPlan[]
  assignments?: Assignment[]
  viewMode: CalendarViewMode
  currentDate: Date
  editable: boolean
  saving?: boolean
  showHeader?: boolean
  onDateChange: (date: Date) => void
  onViewModeChange: (mode: CalendarViewMode) => void
  onContentChange?: (date: string, content: TiptapContent) => void
  onAssignmentClick?: (assignment: Assignment) => void
  onMarkdownToggle?: () => void
  holidays?: Set<string>
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Grid columns: weekends ~2.5%, weekdays ~19% each
const GRID_COLUMNS_7 = '2.5% 19% 19% 19% 19% 19% 2.5%'
// Grid with month column: 24px for month, then same proportions
const GRID_COLUMNS_8 = '24px 2.4% 18.52% 18.52% 18.52% 18.52% 18.52% 2.4%'

// Determine which month a week belongs to (month with 3+ days wins)
function getWeekMonth(week: Date[]): { key: string; name: string } {
  const monthCounts = new Map<string, { count: number; date: Date }>()
  for (const day of week) {
    const monthKey = format(day, 'yyyy-MM')
    const existing = monthCounts.get(monthKey)
    if (existing) {
      existing.count++
    } else {
      monthCounts.set(monthKey, { count: 1, date: day })
    }
  }
  let maxMonth = ''
  let maxCount = 0
  let monthDate: Date = week[0]
  for (const [month, data] of monthCounts) {
    if (data.count > maxCount) {
      maxCount = data.count
      maxMonth = month
      monthDate = data.date
    }
  }
  return { key: maxMonth, name: format(monthDate, 'MMMM') }
}

export function LessonCalendar({
  classroom,
  lessonPlans,
  assignments = [],
  viewMode,
  currentDate,
  editable,
  saving = false,
  showHeader = true,
  onDateChange,
  onViewModeChange,
  onContentChange,
  onAssignmentClick,
  onMarkdownToggle,
  holidays = new Set(),
}: LessonCalendarProps) {
  const today = useMemo(() => toZonedTime(new Date(), TIMEZONE), [])
  const [expandedWeekIdx, setExpandedWeekIdx] = useState<number | null>(null)

  // Build a map of date -> lesson plan for quick lookup
  const plansByDate = useMemo(() => {
    const map = new Map<string, LessonPlan>()
    lessonPlans.forEach((plan) => {
      map.set(plan.date, plan)
    })
    return map
  }, [lessonPlans])

  // Build a map of date -> assignments for quick lookup
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    assignments.forEach((assignment) => {
      // Convert due_at to Toronto timezone before extracting date
      const dueInToronto = toZonedTime(new Date(assignment.due_at), TIMEZONE)
      const dueDate = format(dueInToronto, 'yyyy-MM-dd')
      const existing = map.get(dueDate)
      if (existing) {
        existing.push(assignment)
      } else {
        map.set(dueDate, [assignment])
      }
    })
    return map
  }, [assignments])

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

  // Find the index of the week containing today
  const todayWeekIdx = useMemo(() => {
    for (let i = 0; i < weeks.length; i++) {
      if (weeks[i].some(day => isSameDay(day, today))) {
        return i
      }
    }
    return null
  }, [weeks, today])

  // Set expanded week to current week when view mode changes (for month/all views)
  useEffect(() => {
    if (viewMode === 'week') {
      setExpandedWeekIdx(null)
    } else {
      setExpandedWeekIdx(todayWeekIdx)
    }
  }, [viewMode, todayWeekIdx])

  // Calculate month spans for the month label column
  // Returns array of { month: string, monthName: string, startIdx: number, count: number }
  const monthSpans = useMemo(() => {
    if (weeks.length === 0) return []

    const spans: { month: string; monthName: string; startIdx: number; count: number }[] = []
    let current = getWeekMonth(weeks[0])
    let startIdx = 0
    let count = 1

    for (let i = 1; i < weeks.length; i++) {
      const weekMonth = getWeekMonth(weeks[i])
      if (weekMonth.key === current.key) {
        count++
      } else {
        spans.push({
          month: current.key,
          monthName: current.name,
          startIdx,
          count,
        })
        current = weekMonth
        startIdx = i
        count = 1
      }
    }
    // Push the last span
    spans.push({
      month: current.key,
      monthName: current.name,
      startIdx,
      count,
    })

    return spans
  }, [weeks])

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
    if (viewMode === 'week' || viewMode === 'month') {
      return format(currentDate, 'MMMM yyyy')
    }
    // 'all' mode
    if (classroom.start_date && classroom.end_date) {
      return `${format(new Date(classroom.start_date), 'MMM d, yyyy')} - ${format(new Date(classroom.end_date), 'MMM d, yyyy')}`
    }
    return 'All Dates'
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  return (
    <div className="flex flex-col">
      {/* Header with navigation, view mode selector, and actions */}
      {showHeader && (
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          {/* Left: Navigation with month label */}
          <div className="flex items-center gap-1 flex-1">
            {viewMode !== 'all' && (
              <button
                onClick={handlePrev}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Previous"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100 mx-1 min-w-[120px] text-center">
              {headerLabel}
            </span>
            {viewMode !== 'all' && (
              <>
                <button
                  onClick={handleNext}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <button
                  onClick={handleToday}
                  className="ml-2 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Go to today"
                  title="Today"
                >
                  <CircleDot className="w-5 h-5" />
                </button>
              </>
            )}
          </div>

          {/* Center: View mode selector */}
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

          {/* Right: Actions */}
          <div className="flex items-center gap-2 flex-1 justify-end">
            {saving && (
              <span className="text-sm text-gray-500">Saving...</span>
            )}
            {onMarkdownToggle && (
              <button
                onClick={onMarkdownToggle}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Edit as Markdown"
                title="Edit as Markdown"
              >
                <Code className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Day headers */}
      <div
        className="grid border-b-2 border-gray-200 dark:border-gray-700"
        style={{ gridTemplateColumns: viewMode === 'all' ? GRID_COLUMNS_8 : GRID_COLUMNS_7 }}
      >
        {/* Empty cell for month column (only in 'all' mode) */}
        {viewMode === 'all' && <div className="border-r border-gray-200 dark:border-gray-700" />}
        {DAY_LABELS.map((label, idx) => {
          const isWeekendDay = idx === 0 || idx === 6
          return (
            <div
              key={label}
              className={`py-2 text-center text-sm font-medium border-r border-gray-200 dark:border-gray-700 last:border-r-0 ${
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
      <div
        className="grid overflow-auto"
        style={{
          gridTemplateColumns: viewMode === 'all' ? GRID_COLUMNS_8 : GRID_COLUMNS_7,
          gridTemplateRows: weeks.map((_, idx) => {
            const isExpanded = expandedWeekIdx === idx
            const isCompactView = viewMode !== 'week'
            if (viewMode === 'week') return 'minmax(80px, auto)'
            if (isExpanded) return 'minmax(80px, auto)'
            return 'minmax(32px, 80px)'
          }).join(' '),
        }}
      >
        {/* Render month labels first (they span rows) - only in 'all' mode */}
        {viewMode === 'all' && monthSpans.map((span) => (
          <div
            key={span.month}
            className="relative border-b border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center"
            style={{
              gridColumn: 1,
              gridRow: `${span.startIdx + 1} / span ${span.count}`,
            }}
          >
            <span
              className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
              style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
              }}
            >
              {span.monthName}
            </span>
          </div>
        ))}

        {/* Render all day cells */}
        {weeks.map((week, weekIdx) => {
          const isExpanded = expandedWeekIdx === weekIdx
          const isCompactView = viewMode !== 'week'

          return week.map((day, dayIdx) => {
            const dateString = format(day, 'yyyy-MM-dd')
            const lessonPlan = plansByDate.get(dateString) || null
            const isToday = isSameDay(day, today)
            const isWeekendDay = isWeekend(day)
            const isHoliday = holidays.has(dateString)
            // In 'all' mode, column starts at 2 (after month column)
            const colStart = viewMode === 'all' ? dayIdx + 2 : dayIdx + 1

            return (
              <div
                key={dateString}
                className={`border-r border-b border-gray-200 dark:border-gray-700 ${isCompactView ? 'cursor-pointer' : ''}`}
                style={{
                  gridColumn: colStart,
                  gridRow: weekIdx + 1,
                  // Allow overflow on weekends for assignment tooltips
                  overflow: isCompactView && !isExpanded && !isWeekendDay ? 'hidden' : undefined,
                }}
                onClick={isCompactView ? () => setExpandedWeekIdx(isExpanded ? null : weekIdx) : undefined}
              >
                <LessonDayCell
                  date={dateString}
                  day={day}
                  lessonPlan={lessonPlan}
                  assignments={assignmentsByDate.get(dateString) || []}
                  isWeekend={isWeekendDay}
                  isToday={isToday}
                  isHoliday={isHoliday}
                  editable={editable && !isWeekendDay}
                  compact={viewMode !== 'week' && !isExpanded}
                  onContentChange={onContentChange}
                  onAssignmentClick={onAssignmentClick}
                />
              </div>
            )
          })
        })}
      </div>
    </div>
  )
}
