'use client'

import { useMemo, useRef, useEffect } from 'react'
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isWeekend,
} from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const TORONTO_TZ = 'America/Toronto'
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// How many months to show total
const MONTHS_TO_SHOW = 2

interface MonthCalendarProps {
  /** Currently displayed month (YYYY-MM-DD, any day in the month) */
  currentMonth: string
  /** Selected date (YYYY-MM-DD) */
  selectedDate: string
  /** Callback when user selects a date */
  onSelectDate: (date: string) => void
  /** Callback when user navigates to a different month */
  onMonthChange: (month: string) => void
  /** Set of dates that have content (shown with dot indicator) */
  datesWithContent?: Set<string>
  /** Minimum selectable date (YYYY-MM-DD) */
  minDate?: string
  /** Maximum selectable date (YYYY-MM-DD) */
  maxDate?: string
}

interface SingleMonthProps {
  monthDate: Date
  selectedDate: string
  todayStr: string
  datesWithContent?: Set<string>
  minDate?: string
  maxDate?: string
  onSelectDate: (date: string) => void
  isFirstMonth?: boolean
}

function SingleMonth({
  monthDate,
  selectedDate,
  todayStr,
  datesWithContent,
  minDate,
  maxDate,
  onSelectDate,
  isFirstMonth,
}: SingleMonthProps) {
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  const monthLabel = format(monthDate, 'MMMM yyyy')

  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({ start: monthStart, end: monthEnd })
  }, [monthStart, monthEnd])

  const firstDayOfWeek = monthStart.getDay()
  const leadingEmptyCells = Array(firstDayOfWeek).fill(null)

  const isDateSelectable = (dateStr: string) => {
    if (minDate && dateStr < minDate) return false
    if (maxDate && dateStr > maxDate) return false
    return true
  }

  return (
    <div className={isFirstMonth ? '' : 'mt-6'}>
      {/* Month header */}
      <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
        {monthLabel}
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((day, i) => (
          <div
            key={i}
            className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {leadingEmptyCells.map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}

        {daysInMonth.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const hasContent = datesWithContent?.has(dateStr)
          const isWeekendDay = isWeekend(day)
          const isSelectable = isDateSelectable(dateStr)

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => isSelectable && onSelectDate(dateStr)}
              disabled={!isSelectable}
              className={[
                'aspect-square flex flex-col items-center justify-center rounded-md text-sm relative',
                'transition-colors',
                isSelected
                  ? 'bg-blue-600 text-white'
                  : isToday
                    ? 'ring-2 ring-blue-500 ring-inset text-gray-900 dark:text-white'
                    : isWeekendDay
                      ? 'text-gray-400 dark:text-gray-500'
                      : 'text-gray-700 dark:text-gray-200',
                !isSelected && isSelectable && 'hover:bg-gray-100 dark:hover:bg-gray-800',
                !isSelectable && 'opacity-40 cursor-not-allowed',
              ].join(' ')}
              aria-label={format(day, 'EEEE, MMMM d, yyyy')}
              aria-pressed={isSelected}
            >
              <span>{format(day, 'd')}</span>
              {hasContent && !isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-blue-500" />
              )}
              {hasContent && isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-white" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MonthCalendar({
  currentMonth,
  selectedDate,
  onSelectDate,
  onMonthChange,
  datesWithContent,
  minDate,
  maxDate,
}: MonthCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowInToronto = toZonedTime(new Date(), TORONTO_TZ)
  const todayStr = format(nowInToronto, 'yyyy-MM-dd')

  // Generate months to display: current + next month
  const months = useMemo(() => {
    const baseMonth = parseISO(currentMonth)
    const result: Date[] = []
    for (let i = 0; i < MONTHS_TO_SHOW; i++) {
      result.push(addMonths(baseMonth, i))
    }
    return result
  }, [currentMonth])

  // When selected date changes, scroll to that month
  useEffect(() => {
    if (!scrollRef.current) return
    const selectedMonth = selectedDate.slice(0, 7) // YYYY-MM
    const monthElement = scrollRef.current.querySelector(`[data-month="${selectedMonth}"]`)
    if (monthElement) {
      monthElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedDate])

  // Handle date selection - also update currentMonth if selecting a different month
  const handleSelectDate = (date: string) => {
    onSelectDate(date)
    const selectedMonthStr = date.slice(0, 7)
    const currentMonthStr = currentMonth.slice(0, 7)
    if (selectedMonthStr !== currentMonthStr) {
      onMonthChange(format(parseISO(date), 'yyyy-MM-dd'))
    }
  }

  // Navigation handlers
  const handlePrevMonth = () => {
    const prev = subMonths(parseISO(currentMonth), 1)
    onMonthChange(format(prev, 'yyyy-MM-dd'))
  }

  const handleNextMonth = () => {
    const next = addMonths(parseISO(currentMonth), 1)
    onMonthChange(format(next, 'yyyy-MM-dd'))
  }

  return (
    <div className="select-none flex flex-col h-full">
      {/* Navigation header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={handleNextMonth}
          className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Next month"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Scrollable months container */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pr-2 -mr-2"
      >
        {months.map((monthDate, index) => (
          <div
            key={format(monthDate, 'yyyy-MM')}
            data-month={format(monthDate, 'yyyy-MM')}
          >
            <SingleMonth
              monthDate={monthDate}
              selectedDate={selectedDate}
              todayStr={todayStr}
              datesWithContent={datesWithContent}
              minDate={minDate}
              maxDate={maxDate}
              onSelectDate={handleSelectDate}
              isFirstMonth={index === 0}
            />
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span>Has plan</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded ring-2 ring-blue-500 ring-inset" />
          <span>Today</span>
        </div>
      </div>
    </div>
  )
}
