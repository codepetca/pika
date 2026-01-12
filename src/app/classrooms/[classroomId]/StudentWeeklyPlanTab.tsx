'use client'

import { useEffect, useState, useCallback } from 'react'
import { Spinner } from '@/components/Spinner'
import { WeekActionBar } from '@/components/WeekActionBar'
import { DayPlanCard } from '@/components/DayPlanCard'
import {
  getCurrentWeekStart,
  getWeekDays,
  getNextWeekStart,
  getPreviousWeekStart,
  canStudentViewWeek,
} from '@/lib/week-utils'
import { getTodayInToronto } from '@/lib/timezone'
import type { Classroom, DailyPlan, FuturePlansVisibility, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }

interface StudentWeeklyPlanTabProps {
  classroom: Classroom
}

export function StudentWeeklyPlanTab({ classroom }: StudentWeeklyPlanTabProps) {
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart())
  const [visibility, setVisibility] = useState<FuturePlansVisibility>('current')
  const [plans, setPlans] = useState<Record<string, DailyPlan | null>>({})
  const [error, setError] = useState('')

  const weekDays = getWeekDays(weekStart)
  const today = getTodayInToronto()
  const currentWeekStart = getCurrentWeekStart()

  const loadWeekPlans = useCallback(async (week: string) => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        `/api/classrooms/${classroom.id}/daily-plans?week_start=${week}`
      )
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 403) {
          // Week not visible - don't show error, just empty state
          setPlans({})
          setError('This week is not available yet.')
          return
        }
        throw new Error(data.error || 'Failed to load plans')
      }

      setVisibility(data.visibility)
      setPlans(data.plans)
    } catch (err: any) {
      console.error('Error loading week plans:', err)
      setError(err.message || 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    loadWeekPlans(weekStart)
  }, [weekStart, loadWeekPlans])

  const handlePreviousWeek = useCallback(() => {
    setWeekStart(getPreviousWeekStart(weekStart))
  }, [weekStart])

  const handleNextWeek = useCallback(() => {
    const nextWeek = getNextWeekStart(weekStart)
    // Check if student can navigate to next week
    if (canStudentViewWeek(nextWeek, visibility, currentWeekStart)) {
      setWeekStart(nextWeek)
    }
  }, [weekStart, visibility, currentWeekStart])

  const handleToday = useCallback(() => {
    setWeekStart(getCurrentWeekStart())
  }, [])

  // Determine if student can navigate to next week
  const canNavigateNext = canStudentViewWeek(
    getNextWeekStart(weekStart),
    visibility,
    currentWeekStart
  )

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error && !error.includes('not available')) {
    return (
      <div className="p-4">
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => loadWeekPlans(weekStart)}
            className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <WeekActionBar
        weekStart={weekStart}
        onPreviousWeek={handlePreviousWeek}
        onNextWeek={handleNextWeek}
        onToday={handleToday}
        canNavigateNext={canNavigateNext}
        isTeacher={false}
      />

      <div className="flex-1 overflow-auto p-4">
        {error && error.includes('not available') ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500 dark:text-gray-400 text-center">
              {error}
              <br />
              <span className="text-sm">Check back later or navigate to an earlier week.</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {weekDays.map(date => {
              const plan = plans[date]
              return (
                <DayPlanCard
                  key={date}
                  date={date}
                  content={plan?.rich_content ?? null}
                  isEditable={false}
                  isToday={date === today}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
