'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, parseISO, addWeeks } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { MonthCalendar } from '@/components/MonthCalendar'
import { CompactWeekStrip } from '@/components/CompactWeekStrip'
import { DayWeekToggle, type ViewMode } from '@/components/DayWeekToggle'
import { DayPlanCard } from '@/components/DayPlanCard'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { getWeekStartForDate, getWeekDays, getCurrentWeekStart } from '@/lib/week-utils'
import { getTodayInToronto } from '@/lib/timezone'
import type { Classroom, DailyPlan, FuturePlansVisibility, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }

interface StudentWeeklyPlanTabProps {
  classroom: Classroom
}

export function StudentWeeklyPlanTab({ classroom }: StudentWeeklyPlanTabProps) {
  const today = getTodayInToronto()
  const currentWeekStart = getCurrentWeekStart()

  // Core state
  const [selectedDate, setSelectedDate] = useState(today)
  const [currentMonth, setCurrentMonth] = useState(today)
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [visibility, setVisibility] = useState<FuturePlansVisibility>(
    classroom.future_plans_visibility || 'current'
  )

  // Data state
  const [loading, setLoading] = useState(true)
  const [datesWithContent, setDatesWithContent] = useState<Set<string>>(new Set())
  const [dayPlan, setDayPlan] = useState<DailyPlan | null>(null)
  const [weekPlans, setWeekPlans] = useState<Record<string, DailyPlan | null>>({})
  const [error, setError] = useState('')

  // Calculate max date based on visibility
  const getMaxDate = useCallback((): string | undefined => {
    switch (visibility) {
      case 'current':
        // Friday of current week
        return getWeekDays(currentWeekStart)[4]
      case 'next':
        // Friday of next week
        const nextWeekStart = format(addWeeks(parseISO(currentWeekStart), 1), 'yyyy-MM-dd')
        return getWeekDays(nextWeekStart)[4]
      case 'all':
        return undefined // No limit
      default:
        return getWeekDays(currentWeekStart)[4]
    }
  }, [visibility, currentWeekStart])

  // Load dates with content for calendar dots
  const loadDatesWithContent = useCallback(async (month: string) => {
    try {
      const monthStr = format(parseISO(month), 'yyyy-MM')
      const response = await fetch(
        `/api/classrooms/${classroom.id}/daily-plans?month=${monthStr}`
      )
      const data = await response.json()

      if (response.ok && data.dates_with_content) {
        setDatesWithContent(new Set(data.dates_with_content))
      }
    } catch (err) {
      console.error('Error loading dates with content:', err)
    }
  }, [classroom.id])

  // Load single day plan
  const loadDayPlan = useCallback(async (date: string) => {
    setError('')
    try {
      const response = await fetch(
        `/api/classrooms/${classroom.id}/daily-plans?date=${date}`
      )
      const data = await response.json()

      if (response.ok) {
        setDayPlan(data.plan)
        if (data.visibility) {
          setVisibility(data.visibility)
        }
      } else if (response.status === 403) {
        setError('This date is not available yet.')
        setDayPlan(null)
      }
    } catch (err) {
      console.error('Error loading day plan:', err)
    }
  }, [classroom.id])

  // Load week plans
  const loadWeekPlans = useCallback(async (weekStart: string) => {
    setError('')
    try {
      const response = await fetch(
        `/api/classrooms/${classroom.id}/daily-plans?week_start=${weekStart}`
      )
      const data = await response.json()

      if (response.ok) {
        setWeekPlans(data.plans)
        if (data.visibility) {
          setVisibility(data.visibility)
        }
      } else if (response.status === 403) {
        setError('This week is not available yet.')
        setWeekPlans({})
      }
    } catch (err) {
      console.error('Error loading week plans:', err)
    }
  }, [classroom.id])

  // Initial load
  useEffect(() => {
    async function init() {
      setLoading(true)
      await loadDatesWithContent(currentMonth)
      if (viewMode === 'day') {
        await loadDayPlan(selectedDate)
      } else {
        await loadWeekPlans(getWeekStartForDate(selectedDate))
      }
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When month changes, reload dates with content
  useEffect(() => {
    loadDatesWithContent(currentMonth)
  }, [currentMonth, loadDatesWithContent])

  // When selected date changes, reload data
  useEffect(() => {
    if (viewMode === 'day') {
      loadDayPlan(selectedDate)
    }
  }, [selectedDate, viewMode, loadDayPlan])

  // When switching to week view or selected date changes in week view
  useEffect(() => {
    if (viewMode === 'week') {
      loadWeekPlans(getWeekStartForDate(selectedDate))
    }
  }, [selectedDate, viewMode, loadWeekPlans])

  // Handle date selection
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date)
    // Update month if needed
    if (format(parseISO(currentMonth), 'yyyy-MM') !== format(parseISO(date), 'yyyy-MM')) {
      setCurrentMonth(format(parseISO(date), 'yyyy-MM-dd'))
    }
  }, [currentMonth])

  const weekStart = getWeekStartForDate(selectedDate)
  const weekDays = getWeekDays(weekStart)
  const maxDate = getMaxDate()

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Mobile: Compact week strip */}
      <div className="lg:hidden border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
        <CompactWeekStrip
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          datesWithContent={datesWithContent}
          maxDate={maxDate}
        />
      </div>

      {/* Desktop: Month calendar sidebar */}
      <div className="hidden lg:flex lg:flex-col w-80 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <MonthCalendar
          currentMonth={currentMonth}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onMonthChange={setCurrentMonth}
          datesWithContent={datesWithContent}
          maxDate={maxDate}
        />
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with toggle */}
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <DayWeekToggle mode={viewMode} onChange={setViewMode} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {error ? (
            <div className="max-w-4xl mx-auto">
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
                <p className="text-gray-600 dark:text-gray-400">{error}</p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                  Check back later or select an earlier date.
                </p>
              </div>
            </div>
          ) : viewMode === 'day' ? (
            /* Day View: Full-width viewer */
            <div className="max-w-4xl mx-auto">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')}
              </h2>
              {dayPlan?.rich_content ? (
                <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <RichTextViewer content={dayPlan.rich_content} />
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
                  <p className="text-gray-500 dark:text-gray-400 italic">
                    No plan for this day
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Week View: Vertically stacked cards */
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Week of {format(parseISO(weekStart), 'MMMM d, yyyy')}
              </h2>
              {weekDays.map((date) => {
                const plan = weekPlans[date]
                const isSelected = date === selectedDate

                return (
                  <div
                    key={date}
                    className={[
                      'cursor-pointer transition-all',
                      isSelected ? 'ring-2 ring-blue-500 rounded-lg' : '',
                    ].join(' ')}
                    onClick={() => {
                      setSelectedDate(date)
                      setViewMode('day')
                    }}
                  >
                    <DayPlanCard
                      date={date}
                      content={plan?.rich_content ?? null}
                      isToday={date === today}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
