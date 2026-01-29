'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startOfWeek, format, startOfMonth, endOfMonth } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useClassDays } from '@/hooks/useClassDays'
import { readCookie, writeCookie } from '@/lib/cookies'
import type { Classroom, LessonPlan, Assignment } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentLessonCalendarTab({ classroom }: Props) {
  const router = useRouter()
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const classDays = useClassDays(classroom.id)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
    const saved = readCookie(`calendarViewMode:${classroom.id}`)
    return (saved === 'week' || saved === 'month' || saved === 'all') ? saved : 'week'
  })
  const handleViewModeChange = useCallback((mode: CalendarViewMode) => {
    setViewMode(mode)
    writeCookie(`calendarViewMode:${classroom.id}`, mode)
  }, [classroom.id])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [maxDate, setMaxDate] = useState<string | null>(null)

  // Always fetch the full term - switching views is then instant
  const fetchRange = {
    start: classroom.start_date || format(startOfMonth(currentDate), 'yyyy-MM-dd'),
    end: classroom.end_date || format(endOfMonth(currentDate), 'yyyy-MM-dd'),
  }

  // Fetch all lesson plans for the term once
  useEffect(() => {
    async function loadLessonPlans() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/student/classrooms/${classroom.id}/lesson-plans?start=${fetchRange.start}&end=${fetchRange.end}`
        )
        const data = await res.json()
        setLessonPlans(data.lesson_plans || [])
        setMaxDate(data.max_date || null)
      } catch (err) {
        console.error('Error loading lesson plans:', err)
      } finally {
        setLoading(false)
      }
    }
    loadLessonPlans()
  }, [classroom.id, fetchRange.start, fetchRange.end])

  // Fetch assignments for the classroom
  useEffect(() => {
    async function loadAssignments() {
      try {
        const res = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
        const data = await res.json()
        setAssignments(data.assignments || [])
      } catch (err) {
        console.error('Error loading assignments:', err)
      }
    }
    loadAssignments()
  }, [classroom.id])

  // Handle assignment click - navigate to assignments tab with the assignment selected
  const handleAssignmentClick = useCallback(
    (assignment: Assignment) => {
      router.push(`/classrooms/${classroom.id}?tab=assignments&assignmentId=${assignment.id}`)
    },
    [router, classroom.id]
  )

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
      <PageContent className="-mt-2">
        <LessonCalendar
          classroom={classroom}
          lessonPlans={lessonPlans}
          assignments={assignments}
          classDays={classDays}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={false}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
          onAssignmentClick={handleAssignmentClick}
        />
      </PageContent>
    </PageLayout>
  )
}
