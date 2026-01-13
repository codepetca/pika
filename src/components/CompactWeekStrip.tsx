'use client'

import { useMemo } from 'react'
import { format, parseISO, addDays } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getWeekStartForDate, getNextWeekStart, getPreviousWeekStart } from '@/lib/week-utils'

const TORONTO_TZ = 'America/Toronto'
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

interface CompactWeekStripProps {
  /** Selected date (YYYY-MM-DD) */
  selectedDate: string
  /** Callback when user selects a date */
  onSelectDate: (date: string) => void
  /** Set of dates that have content (shown with dot indicator) */
  datesWithContent?: Set<string>
  /** Minimum selectable date (YYYY-MM-DD) */
  minDate?: string
  /** Maximum selectable date (YYYY-MM-DD) */
  maxDate?: string
}

export function CompactWeekStrip({
  selectedDate,
  onSelectDate,
  datesWithContent,
  minDate,
  maxDate,
}: CompactWeekStripProps) {
  const nowInToronto = toZonedTime(new Date(), TORONTO_TZ)
  const todayStr = format(nowInToronto, 'yyyy-MM-dd')

  const weekStart = getWeekStartForDate(selectedDate)

  // Generate 7 days starting from Monday
  const weekDays = useMemo(() => {
    const monday = parseISO(weekStart)
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(monday, i)
      return format(day, 'yyyy-MM-dd')
    })
  }, [weekStart])

  // Check navigation limits
  const canGoPrev = !minDate || getPreviousWeekStart(weekStart) >= getWeekStartForDate(minDate)
  const canGoNext = !maxDate || weekDays[6] < maxDate

  const handlePrevWeek = () => {
    if (!canGoPrev) return
    const prevWeek = getPreviousWeekStart(weekStart)
    // Select same day of week in previous week
    const dayIndex = weekDays.indexOf(selectedDate)
    const newDate = format(addDays(parseISO(prevWeek), dayIndex >= 0 ? dayIndex : 0), 'yyyy-MM-dd')
    onSelectDate(newDate)
  }

  const handleNextWeek = () => {
    if (!canGoNext) return
    const nextWeek = getNextWeekStart(weekStart)
    // Select same day of week in next week
    const dayIndex = weekDays.indexOf(selectedDate)
    const newDate = format(addDays(parseISO(nextWeek), dayIndex >= 0 ? dayIndex : 0), 'yyyy-MM-dd')
    onSelectDate(newDate)
  }

  const isDateSelectable = (dateStr: string) => {
    if (minDate && dateStr < minDate) return false
    if (maxDate && dateStr > maxDate) return false
    return true
  }

  return (
    <div className="flex items-center gap-2">
      {/* Previous week */}
      <button
        type="button"
        onClick={handlePrevWeek}
        disabled={!canGoPrev}
        className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Previous week"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Week days */}
      <div className="flex-1 flex items-center justify-center gap-1">
        {weekDays.map((dateStr, i) => {
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const hasContent = datesWithContent?.has(dateStr)
          const isSelectable = isDateSelectable(dateStr)
          const isWeekend = i >= 5

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => isSelectable && onSelectDate(dateStr)}
              disabled={!isSelectable}
              className={[
                'flex flex-col items-center gap-0.5 px-2 py-1 rounded-md transition-colors',
                isSelected
                  ? 'bg-blue-600 text-white'
                  : isToday
                    ? 'ring-2 ring-blue-500 ring-inset text-gray-900 dark:text-white'
                    : isWeekend
                      ? 'text-gray-400 dark:text-gray-500'
                      : 'text-gray-700 dark:text-gray-200',
                !isSelected && isSelectable && 'hover:bg-gray-100 dark:hover:bg-gray-800',
                !isSelectable && 'opacity-40 cursor-not-allowed',
              ].join(' ')}
              aria-label={format(parseISO(dateStr), 'EEEE, MMMM d')}
              aria-pressed={isSelected}
            >
              <span className="text-[10px] font-medium">{WEEKDAY_LABELS[i]}</span>
              <span className="text-sm font-semibold">{format(parseISO(dateStr), 'd')}</span>
              {/* Content indicator */}
              <span
                className={[
                  'w-1 h-1 rounded-full',
                  hasContent
                    ? isSelected
                      ? 'bg-white'
                      : 'bg-blue-500'
                    : 'bg-transparent',
                ].join(' ')}
              />
            </button>
          )
        })}
      </div>

      {/* Next week */}
      <button
        type="button"
        onClick={handleNextWeek}
        disabled={!canGoNext}
        className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Next week"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
