'use client'

import { useEffect, useMemo, useState } from 'react'
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { getOntarioHolidays } from '@/lib/calendar'
import type { Classroom, LessonPlan, LessonPlanVisibility } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentLessonCalendarTab({ classroom }: Props) {
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [visibility, setVisibility] = useState<LessonPlanVisibility>('current_week')
  const [maxDate, setMaxDate] = useState<string | null>(null)

  // Calculate date range for fetching
  const dateRange = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 })
      const end = endOfWeek(currentDate, { weekStartsOn: 0 })
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    }
    if (viewMode === 'month') {
      const start = startOfMonth(currentDate)
      const end = endOfMonth(currentDate)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    }
    // 'all' mode: use classroom term dates or default to wide range
    const start = classroom.start_date || '2020-01-01'
    const end = classroom.end_date || '2030-12-31'
    return { start, end }
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  // Holidays for the displayed range (including overflow days in month/all views)
  const holidays = useMemo(() => {
    let startDate = new Date(dateRange.start)
    let endDate = new Date(dateRange.end)

    // Extend to full weeks to include overflow days
    if (viewMode === 'month' || viewMode === 'all') {
      startDate = startOfWeek(startDate, { weekStartsOn: 0 })
      endDate = endOfWeek(endDate, { weekStartsOn: 0 })
    }

    const holidayList = getOntarioHolidays(startDate, endDate)
    return new Set(holidayList)
  }, [dateRange, viewMode])

  // Fetch lesson plans when date range changes
  useEffect(() => {
    async function loadLessonPlans() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/student/classrooms/${classroom.id}/lesson-plans?start=${dateRange.start}&end=${dateRange.end}`
        )
        const data = await res.json()
        setLessonPlans(data.lesson_plans || [])
        setVisibility(data.visibility || 'current_week')
        setMaxDate(data.max_date || null)
      } catch (err) {
        console.error('Error loading lesson plans:', err)
      } finally {
        setLoading(false)
      }
    }
    loadLessonPlans()
  }, [classroom.id, dateRange.start, dateRange.end])

  // Prevent navigation beyond max date
  const handleDateChange = (newDate: Date) => {
    if (maxDate) {
      const newDateStr = format(startOfWeek(newDate, { weekStartsOn: 0 }), 'yyyy-MM-dd')
      if (newDateStr > maxDate) {
        // Don't allow navigation past max date
        return
      }
    }
    setCurrentDate(newDate)
  }

  if (loading && lessonPlans.length === 0) {
    return (
      <PageLayout>
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner />
          </div>
        </PageContent>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <PageContent>
        {maxDate && visibility !== 'all' && (
          <div className="mb-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm text-blue-700 dark:text-blue-300">
            {visibility === 'current_week'
              ? 'You can view lesson plans for the current week and past weeks.'
              : 'You can view lesson plans up to one week ahead.'}
          </div>
        )}
        <LessonCalendar
          classroom={classroom}
          lessonPlans={lessonPlans}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={false}
          onDateChange={handleDateChange}
          onViewModeChange={setViewMode}
          holidays={holidays}
        />
      </PageContent>
    </PageLayout>
  )
}
