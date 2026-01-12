'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Spinner } from '@/components/Spinner'
import { WeekActionBar } from '@/components/WeekActionBar'
import { DayPlanCard } from '@/components/DayPlanCard'
import {
  getCurrentWeekStart,
  getWeekDays,
  getNextWeekStart,
  getPreviousWeekStart,
} from '@/lib/week-utils'
import { getTodayInToronto } from '@/lib/timezone'
import type { Classroom, DailyPlan, FuturePlansVisibility, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 5000
const AUTOSAVE_MIN_INTERVAL_MS = 15000

interface DayState {
  content: TiptapContent
  saveStatus: 'saved' | 'saving' | 'unsaved'
  lastSavedContent: string
}

interface TeacherWeeklyPlanTabProps {
  classroom: Classroom
}

export function TeacherWeeklyPlanTab({ classroom }: TeacherWeeklyPlanTabProps) {
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart())
  const [visibility, setVisibility] = useState<FuturePlansVisibility>('current')
  const [dayStates, setDayStates] = useState<Record<string, DayState>>({})
  const [error, setError] = useState('')

  // Refs for autosave per day
  const saveTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({})
  const throttleTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({})
  const lastSaveAttemptRef = useRef<Record<string, number>>({})
  const pendingContentRef = useRef<Record<string, TiptapContent>>({})

  const weekDays = getWeekDays(weekStart)
  const today = getTodayInToronto()

  const loadWeekPlans = useCallback(async (week: string) => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        `/api/classrooms/${classroom.id}/daily-plans?week_start=${week}`
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load plans')
      }

      setVisibility(data.visibility)

      // Initialize day states
      const days = getWeekDays(week)
      const newDayStates: Record<string, DayState> = {}

      for (const date of days) {
        const plan = data.plans[date] as DailyPlan | null
        const content = plan?.rich_content ?? EMPTY_DOC
        newDayStates[date] = {
          content,
          saveStatus: 'saved',
          lastSavedContent: JSON.stringify(content),
        }
      }

      setDayStates(newDayStates)
    } catch (err: any) {
      console.error('Error loading week plans:', err)
      setError(err.message || 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    loadWeekPlans(weekStart)

    // Capture refs for cleanup
    const saveTimeouts = saveTimeoutsRef.current
    const throttleTimeouts = throttleTimeoutsRef.current

    return () => {
      // Clear all timeouts on unmount
      Object.values(saveTimeouts).forEach(clearTimeout)
      Object.values(throttleTimeouts).forEach(clearTimeout)
    }
  }, [weekStart, loadWeekPlans])

  const savePlan = useCallback(async (date: string, content: TiptapContent) => {
    const contentStr = JSON.stringify(content)
    const dayState = dayStates[date]

    if (dayState && contentStr === dayState.lastSavedContent) {
      setDayStates(prev => ({
        ...prev,
        [date]: { ...prev[date], saveStatus: 'saved' },
      }))
      return
    }

    setDayStates(prev => ({
      ...prev,
      [date]: { ...prev[date], saveStatus: 'saving' },
    }))

    lastSaveAttemptRef.current[date] = Date.now()

    try {
      const response = await fetch(`/api/classrooms/${classroom.id}/daily-plans`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, rich_content: content }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      setDayStates(prev => ({
        ...prev,
        [date]: {
          ...prev[date],
          saveStatus: 'saved',
          lastSavedContent: contentStr,
        },
      }))
    } catch (err: any) {
      console.error(`Error saving plan for ${date}:`, err)
      setDayStates(prev => ({
        ...prev,
        [date]: { ...prev[date], saveStatus: 'unsaved' },
      }))
    }
  }, [classroom.id, dayStates])

  const scheduleSave = useCallback((date: string, content: TiptapContent, options?: { force?: boolean }) => {
    pendingContentRef.current[date] = content

    if (throttleTimeoutsRef.current[date]) {
      clearTimeout(throttleTimeoutsRef.current[date])
      delete throttleTimeoutsRef.current[date]
    }

    const now = Date.now()
    const lastAttempt = lastSaveAttemptRef.current[date] || 0
    const msSinceLastAttempt = now - lastAttempt

    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      void savePlan(date, content)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttleTimeoutsRef.current[date] = setTimeout(() => {
      delete throttleTimeoutsRef.current[date]
      const latest = pendingContentRef.current[date]
      if (latest) {
        void savePlan(date, latest)
      }
    }, waitMs)
  }, [savePlan])

  const handleContentChange = useCallback((date: string, newContent: TiptapContent) => {
    setDayStates(prev => ({
      ...prev,
      [date]: { ...prev[date], content: newContent, saveStatus: 'unsaved' },
    }))

    pendingContentRef.current[date] = newContent

    if (saveTimeoutsRef.current[date]) {
      clearTimeout(saveTimeoutsRef.current[date])
    }

    saveTimeoutsRef.current[date] = setTimeout(() => {
      delete saveTimeoutsRef.current[date]
      scheduleSave(date, newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [scheduleSave])

  const handleBlur = useCallback((date: string) => {
    const dayState = dayStates[date]
    const pending = pendingContentRef.current[date]

    if (dayState?.saveStatus === 'unsaved' && pending) {
      scheduleSave(date, pending, { force: true })
    }
  }, [dayStates, scheduleSave])

  const handleVisibilityChange = useCallback(async (newVisibility: FuturePlansVisibility) => {
    const prevVisibility = visibility
    setVisibility(newVisibility) // Optimistic update

    try {
      const response = await fetch(`/api/classrooms/${classroom.id}/daily-plans`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update visibility')
      }
    } catch (err: any) {
      console.error('Error updating visibility:', err)
      setVisibility(prevVisibility) // Rollback
    }
  }, [classroom.id, visibility])

  const handlePreviousWeek = useCallback(() => {
    setWeekStart(getPreviousWeekStart(weekStart))
  }, [weekStart])

  const handleNextWeek = useCallback(() => {
    setWeekStart(getNextWeekStart(weekStart))
  }, [weekStart])

  const handleToday = useCallback(() => {
    setWeekStart(getCurrentWeekStart())
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
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
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
        isTeacher={true}
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {weekDays.map(date => {
            const dayState = dayStates[date]
            return (
              <DayPlanCard
                key={date}
                date={date}
                content={dayState?.content ?? EMPTY_DOC}
                onChange={(content) => handleContentChange(date, content)}
                onBlur={() => handleBlur(date)}
                saveStatus={dayState?.saveStatus ?? 'saved'}
                isEditable={true}
                isToday={date === today}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
