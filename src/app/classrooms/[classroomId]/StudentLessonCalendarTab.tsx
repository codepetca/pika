'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { getOntarioHolidays } from '@/lib/calendar'
import type { ClassDay, Classroom, LessonPlan, Assignment } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentLessonCalendarTab({ classroom }: Props) {
  const router = useRouter()
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [maxDate, setMaxDate] = useState<string | null>(null)

  // Always fetch the full term - switching views is then instant
  const fetchRange = useMemo(() => {
    const start = classroom.start_date || format(startOfMonth(currentDate), 'yyyy-MM-dd')
    const end = classroom.end_date || format(endOfMonth(currentDate), 'yyyy-MM-dd')
    return { start, end }
  }, [classroom.start_date, classroom.end_date, currentDate])

  // Holidays for the full term (computed once)
  const holidays = useMemo(() => {
    const startDate = startOfWeek(new Date(fetchRange.start), { weekStartsOn: 0 })
    const endDate = endOfWeek(new Date(fetchRange.end), { weekStartsOn: 0 })
    const holidayList = getOntarioHolidays(startDate, endDate)
    return new Set(holidayList)
  }, [fetchRange])

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

  // Fetch class days for the classroom
  useEffect(() => {
    async function loadClassDays() {
      try {
        const res = await fetch(`/api/classrooms/${classroom.id}/class-days`)
        const data = await res.json()
        setClassDays(data.class_days || [])
      } catch (err) {
        console.error('Error loading class days:', err)
      }
    }
    loadClassDays()
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
      <PageContent className="-mt-4">
        <LessonCalendar
          classroom={classroom}
          lessonPlans={lessonPlans}
          assignments={assignments}
          classDays={classDays}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={false}
          onDateChange={handleDateChange}
          onViewModeChange={setViewMode}
          onAssignmentClick={handleAssignmentClick}
          holidays={holidays}
        />
      </PageContent>
    </PageLayout>
  )
}
