'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { MonthCalendar } from '@/components/MonthCalendar'
import { CompactWeekStrip } from '@/components/CompactWeekStrip'
import { DayWeekToggle, type ViewMode } from '@/components/DayWeekToggle'
import { DayPlanCard } from '@/components/DayPlanCard'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { getWeekStartForDate, getWeekDays } from '@/lib/week-utils'
import { getTodayInToronto } from '@/lib/timezone'
import type { Classroom, DailyPlan, FuturePlansVisibility, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 5000
const AUTOSAVE_MIN_INTERVAL_MS = 15000

interface TeacherWeeklyPlanTabProps {
  classroom: Classroom
}

export function TeacherWeeklyPlanTab({ classroom }: TeacherWeeklyPlanTabProps) {
  const today = getTodayInToronto()

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

  // Autosave state for day view
  const [dayContent, setDayContent] = useState<TiptapContent>(EMPTY_DOC)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptRef = useRef(0)
  const lastSavedContentRef = useRef('')
  const pendingContentRef = useRef<TiptapContent | null>(null)

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
    try {
      const response = await fetch(
        `/api/classrooms/${classroom.id}/daily-plans?date=${date}`
      )
      const data = await response.json()

      if (response.ok) {
        const plan = data.plan as DailyPlan | null
        setDayPlan(plan)
        const content = plan?.rich_content ?? EMPTY_DOC
        setDayContent(content)
        lastSavedContentRef.current = JSON.stringify(content)
        setSaveStatus('saved')
        if (data.visibility) {
          setVisibility(data.visibility)
        }
      }
    } catch (err) {
      console.error('Error loading day plan:', err)
    }
  }, [classroom.id])

  // Load week plans
  const loadWeekPlans = useCallback(async (weekStart: string) => {
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

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (throttleTimeoutRef.current) clearTimeout(throttleTimeoutRef.current)
    }
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

  // Save plan
  const savePlan = useCallback(async (date: string, content: TiptapContent) => {
    const contentStr = JSON.stringify(content)
    if (contentStr === lastSavedContentRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')
    lastSaveAttemptRef.current = Date.now()

    try {
      const response = await fetch(`/api/classrooms/${classroom.id}/daily-plans`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, rich_content: content }),
      })

      if (response.ok) {
        lastSavedContentRef.current = contentStr
        setSaveStatus('saved')
        // Update dates with content
        setDatesWithContent(prev => new Set([...prev, date]))
      } else {
        setSaveStatus('unsaved')
      }
    } catch (err) {
      console.error('Error saving plan:', err)
      setSaveStatus('unsaved')
    }
  }, [classroom.id])

  // Schedule save with debounce and throttle
  const scheduleSave = useCallback((content: TiptapContent, options?: { force?: boolean }) => {
    pendingContentRef.current = content

    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current)
      throttleTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastAttempt = now - lastSaveAttemptRef.current

    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      void savePlan(selectedDate, content)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttleTimeoutRef.current = setTimeout(() => {
      throttleTimeoutRef.current = null
      const latest = pendingContentRef.current
      if (latest) {
        void savePlan(selectedDate, latest)
      }
    }, waitMs)
  }, [savePlan, selectedDate])

  // Handle content change in day view
  const handleContentChange = useCallback((newContent: TiptapContent) => {
    setDayContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      scheduleSave(newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [scheduleSave])

  // Handle blur - flush pending save
  const handleBlur = useCallback(() => {
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      scheduleSave(pendingContentRef.current, { force: true })
    }
  }, [saveStatus, scheduleSave])

  // Handle visibility change
  const handleVisibilityChange = useCallback(async (newVisibility: FuturePlansVisibility) => {
    const prevVisibility = visibility
    setVisibility(newVisibility)

    try {
      const response = await fetch(`/api/classrooms/${classroom.id}/daily-plans`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      })

      if (!response.ok) {
        setVisibility(prevVisibility)
      }
    } catch (err) {
      setVisibility(prevVisibility)
    }
  }, [classroom.id, visibility])

  // Handle date selection
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date)
    // Update month if needed
    const newMonth = format(parseISO(date), 'yyyy-MM-dd')
    if (format(parseISO(currentMonth), 'yyyy-MM') !== format(parseISO(date), 'yyyy-MM')) {
      setCurrentMonth(newMonth)
    }
  }, [currentMonth])

  const weekStart = getWeekStartForDate(selectedDate)
  const weekDays = getWeekDays(weekStart)

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
        />
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with toggle and visibility */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <DayWeekToggle mode={viewMode} onChange={setViewMode} />

          <div className="flex items-center gap-2">
            <label htmlFor="visibility-select" className="text-sm text-gray-600 dark:text-gray-400">
              Students see:
            </label>
            <select
              id="visibility-select"
              value={visibility}
              onChange={(e) => handleVisibilityChange(e.target.value as FuturePlansVisibility)}
              className="text-sm px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="current">Current week only</option>
              <option value="next">This & next week</option>
              <option value="all">All weeks</option>
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {viewMode === 'day' ? (
            /* Day View: Full-width editor */
            <div className="max-w-4xl mx-auto">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')}
                </h2>
                <span
                  className={[
                    'text-sm',
                    saveStatus === 'saved'
                      ? 'text-green-600 dark:text-green-400'
                      : saveStatus === 'saving'
                        ? 'text-gray-500 dark:text-gray-400'
                        : 'text-orange-600 dark:text-orange-400',
                  ].join(' ')}
                >
                  {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
                </span>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <RichTextEditor
                  content={dayContent}
                  onChange={handleContentChange}
                  onBlur={handleBlur}
                  placeholder="Add lesson plan for this day..."
                  editable={true}
                  className="min-h-[400px]"
                />
              </div>
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
