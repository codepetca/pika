'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addMonths, addWeeks, endOfMonth, format, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns'
import { CalendarActionBar } from '@/components/CalendarActionBar'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useClassDays } from '@/hooks/useClassDays'
import { readCookie, writeCookie } from '@/lib/cookies'
import { fetchJSONWithCache } from '@/lib/request-cache'
import type { Classroom, LessonPlan, Assignment, Announcement } from '@/types'

interface Props {
  classroom: Classroom
  onNavigateToAssignments?: (assignmentId: string) => void
  onNavigateToAnnouncements?: () => void
}

export function StudentLessonCalendarTab({
  classroom,
  onNavigateToAssignments = () => {},
  onNavigateToAnnouncements = () => {},
}: Props) {
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  currentClassroomIdRef.current = classroom.id
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

  useEffect(() => {
    loadRequestIdRef.current += 1
    setLessonPlans([])
    setAssignments([])
    setAnnouncements([])
    setMaxDate(null)
    setLoadedClassroomId(null)
    setLoading(true)
  }, [classroom.id])

  // Fetch lesson plans, assignments, and announcements in parallel
  useEffect(() => {
    async function loadCalendarData() {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      const requestedClassroomId = classroom.id
      const isCurrentLoad = () => (
        loadRequestIdRef.current === requestId &&
        currentClassroomIdRef.current === requestedClassroomId
      )

      setLoading(true)
      try {
        const [lessonPlansData, assignmentsData, announcementsData] = await Promise.all([
          fetchJSONWithCache<{ lesson_plans?: LessonPlan[]; max_date?: string | null }>(
            `student-lesson-plans:${classroom.id}:${fetchRange.start}:${fetchRange.end}`,
            async () => {
              const res = await fetch(`/api/student/classrooms/${classroom.id}/lesson-plans?start=${fetchRange.start}&end=${fetchRange.end}`)
              if (!res.ok) throw new Error('Failed to load lesson plans')
              return res.json()
            },
            20_000,
          ).catch((err) => {
            console.error('Error loading lesson plans:', err)
            return { lesson_plans: [], max_date: null }
          }),
          fetchJSONWithCache<{ assignments?: Assignment[] }>(
            `student-assignments:${classroom.id}`,
            async () => {
              const res = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
              if (!res.ok) throw new Error('Failed to load assignments')
              return res.json()
            },
            20_000,
          ).catch((err) => {
            console.error('Error loading calendar assignments:', err)
            return { assignments: [] }
          }),
          fetchJSONWithCache<{ announcements?: Announcement[] }>(
            `student-announcements:${classroom.id}`,
            async () => {
              const res = await fetch(`/api/student/classrooms/${classroom.id}/announcements`)
              if (!res.ok) throw new Error('Failed to load announcements')
              return res.json()
            },
            20_000,
          ).catch((err) => {
            console.error('Error loading calendar announcements:', err)
            return { announcements: [] }
          }),
        ])
        if (!isCurrentLoad()) return
        setLessonPlans(lessonPlansData.lesson_plans || [])
        setMaxDate(lessonPlansData.max_date || null)
        setAssignments(assignmentsData.assignments || [])
        setAnnouncements(announcementsData.announcements || [])
        setLoadedClassroomId(requestedClassroomId)
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading calendar data:', err)
        setLessonPlans([])
        setMaxDate(null)
        setAssignments([])
        setAnnouncements([])
        setLoadedClassroomId(requestedClassroomId)
      } finally {
        if (isCurrentLoad()) {
          setLoading(false)
        }
      }
    }
    loadCalendarData()
  }, [classroom.id, fetchRange.start, fetchRange.end])

  const hasCurrentClassroomData = loadedClassroomId === classroom.id
  const currentLessonPlans = hasCurrentClassroomData ? lessonPlans : []
  const currentAssignments = hasCurrentClassroomData ? assignments : []
  const currentAnnouncements = hasCurrentClassroomData ? announcements : []
  const isLoading = loading || !hasCurrentClassroomData

  // Handle assignment click - navigate to assignments tab with the assignment selected
  const handleAssignmentClick = useCallback(
    (assignment: Assignment) => {
      onNavigateToAssignments(assignment.id)
    },
    [onNavigateToAssignments]
  )

  // Handle announcement click - navigate to Announcements
  const handleAnnouncementClick = useCallback(() => {
    onNavigateToAnnouncements()
  }, [onNavigateToAnnouncements])

  // Prevent navigation beyond max date
  const handleDateChange = useCallback((newDate: Date) => {
    if (maxDate) {
      const newDateStr = format(startOfWeek(newDate, { weekStartsOn: 0 }), 'yyyy-MM-dd')
      if (newDateStr > maxDate) {
        // Don't allow navigation past max date
        return
      }
    }
    setCurrentDate(newDate)
  }, [maxDate])

  const handlePreviousDate = useCallback(() => {
    if (viewMode === 'week') {
      handleDateChange(subWeeks(currentDate, 1))
    } else if (viewMode === 'month') {
      handleDateChange(subMonths(currentDate, 1))
    }
  }, [currentDate, handleDateChange, viewMode])

  const handleNextDate = useCallback(() => {
    if (viewMode === 'week') {
      handleDateChange(addWeeks(currentDate, 1))
    } else if (viewMode === 'month') {
      handleDateChange(addMonths(currentDate, 1))
    }
  }, [currentDate, handleDateChange, viewMode])

  const handleToday = useCallback(() => {
    handleDateChange(new Date())
  }, [handleDateChange])

  if (isLoading && currentLessonPlans.length === 0) {
    return (
      <PageLayout bleedX={false}>
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner />
          </div>
        </PageContent>
      </PageLayout>
    )
  }

  return (
    <PageLayout bleedX={false}>
      <CalendarActionBar
        viewMode={viewMode}
        currentDate={currentDate}
        rangeStart={classroom.start_date}
        rangeEnd={classroom.end_date}
        onPrev={handlePreviousDate}
        onNext={handleNextDate}
        onToday={handleToday}
        onViewModeChange={handleViewModeChange}
      />
      <PageContent className="pb-24 pt-2">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <LessonCalendar
            classroom={classroom}
            lessonPlans={currentLessonPlans}
            assignments={currentAssignments}
            announcements={currentAnnouncements}
            classDays={classDays}
            viewMode={viewMode}
            currentDate={currentDate}
            editable={false}
            showHeader={false}
            onDateChange={handleDateChange}
            onViewModeChange={handleViewModeChange}
            onAssignmentClick={handleAssignmentClick}
            onAnnouncementClick={handleAnnouncementClick}
          />
        </div>
      </PageContent>
    </PageLayout>
  )
}
