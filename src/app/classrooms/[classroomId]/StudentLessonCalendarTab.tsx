'use client'

import { useCallback, useEffect, useState } from 'react'
import { startOfWeek, format, startOfMonth, endOfMonth } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useClassDays } from '@/hooks/useClassDays'
import { readCookie, writeCookie } from '@/lib/cookies'
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

  // Fetch lesson plans, assignments, and announcements in parallel
  useEffect(() => {
    async function loadCalendarData() {
      setLoading(true)
      try {
        const [lessonPlansRes, assignmentsRes, announcementsRes] = await Promise.all([
          fetch(`/api/student/classrooms/${classroom.id}/lesson-plans?start=${fetchRange.start}&end=${fetchRange.end}`),
          fetch(`/api/student/assignments?classroom_id=${classroom.id}`),
          fetch(`/api/student/classrooms/${classroom.id}/announcements`),
        ])
        const [lessonPlansData, assignmentsData, announcementsData] = await Promise.all([
          lessonPlansRes.json(),
          assignmentsRes.json(),
          announcementsRes.json(),
        ])
        setLessonPlans(lessonPlansData.lesson_plans || [])
        setMaxDate(lessonPlansData.max_date || null)
        setAssignments(assignmentsData.assignments || [])
        setAnnouncements(announcementsData.announcements || [])
      } catch (err) {
        console.error('Error loading calendar data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadCalendarData()
  }, [classroom.id, fetchRange.start, fetchRange.end])

  // Handle assignment click - navigate to assignments tab with the assignment selected
  const handleAssignmentClick = useCallback(
    (assignment: Assignment) => {
      onNavigateToAssignments(assignment.id)
    },
    [onNavigateToAssignments]
  )

  // Handle announcement click - navigate to Resources > Announcements
  const handleAnnouncementClick = useCallback(() => {
    onNavigateToAnnouncements()
  }, [onNavigateToAnnouncements])

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
      <PageContent className="-mt-[8px]">
        <LessonCalendar
          classroom={classroom}
          lessonPlans={lessonPlans}
          assignments={assignments}
          announcements={announcements}
          classDays={classDays}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={false}
          onDateChange={handleDateChange}
          onViewModeChange={handleViewModeChange}
          onAssignmentClick={handleAssignmentClick}
          onAnnouncementClick={handleAnnouncementClick}
        />
      </PageContent>
    </PageLayout>
  )
}
