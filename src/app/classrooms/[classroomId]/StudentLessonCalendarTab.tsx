'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addMonths, addWeeks, endOfMonth, format, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns'
import { CalendarActionBar } from '@/components/CalendarActionBar'
import { CalendarSourceErrors, type CalendarSourceFailure } from '@/components/CalendarSourceErrors'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useClassDaysContext } from '@/hooks/useClassDays'
import { readCookie, writeCookie } from '@/lib/cookies'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import { nowInToronto } from '@/lib/timezone'
import type { Classroom, LessonPlan, Assignment, Announcement } from '@/types'
import { Button, PageState, RefreshingIndicator } from '@/ui'

interface Props {
  classroom: Classroom
  onNavigateToAssignments?: (assignmentId: string) => void
  onNavigateToAnnouncements?: () => void
}

type StudentLessonPlansResponse = { lesson_plans?: LessonPlan[]; max_date?: string | null }
type StudentAssignmentsResponse = { assignments?: Assignment[] }
type StudentAnnouncementsResponse = { announcements?: Announcement[] }

type CalendarSource = 'lessonPlans' | 'assignments' | 'announcements'
type CalendarRetrySource = CalendarSource | 'classDays'
type SourceStatus = {
  classroomId: string | null
  error: boolean
  hasLoadedSnapshot: boolean
  isLoading: boolean
}

const initialSourceStatus = (): Record<CalendarSource, SourceStatus> => ({
  lessonPlans: { classroomId: null, error: false, hasLoadedSnapshot: false, isLoading: true },
  assignments: { classroomId: null, error: false, hasLoadedSnapshot: false, isLoading: true },
  announcements: { classroomId: null, error: false, hasLoadedSnapshot: false, isLoading: true },
})

export function StudentLessonCalendarTab({
  classroom,
  onNavigateToAssignments = () => {},
  onNavigateToAnnouncements = () => {},
}: Props) {
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [sourceStatus, setSourceStatus] = useState(initialSourceStatus)
  const loadRequestIdsRef = useRef<Record<CalendarSource, number>>({
    lessonPlans: 0,
    assignments: 0,
    announcements: 0,
  })
  const currentClassroomIdRef = useRef(classroom.id)
  const retryingSourcesRef = useRef<Set<CalendarRetrySource>>(new Set())
  const calendarWorkspaceRef = useRef<HTMLDivElement>(null)
  const {
    classDays,
    error: classDaysError,
    hasLoadedSnapshot: hasClassDaysSnapshot,
    isLoading: classDaysLoading,
    refresh: refreshClassDays,
  } = useClassDaysContext()
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
    const saved = readCookie(`calendarViewMode:${classroom.id}`)
    return (saved === 'week' || saved === 'month' || saved === 'all') ? saved : 'week'
  })
  const handleViewModeChange = useCallback((mode: CalendarViewMode) => {
    setViewMode(mode)
    writeCookie(`calendarViewMode:${classroom.id}`, mode)
  }, [classroom.id])
  const [currentDate, setCurrentDate] = useState(nowInToronto)
  const [maxDate, setMaxDate] = useState<string | null>(null)

  // Always fetch the full term - switching views is then instant
  const fetchRange = {
    start: classroom.start_date || format(startOfMonth(currentDate), 'yyyy-MM-dd'),
    end: classroom.end_date || format(endOfMonth(currentDate), 'yyyy-MM-dd'),
  }

  useLayoutEffect(() => {
    currentClassroomIdRef.current = classroom.id
    loadRequestIdsRef.current.lessonPlans += 1
    loadRequestIdsRef.current.assignments += 1
    loadRequestIdsRef.current.announcements += 1
    setLessonPlans([])
    setAssignments([])
    setAnnouncements([])
    setMaxDate(null)
    setSourceStatus(initialSourceStatus())
  }, [classroom.id])

  const loadLessonPlans = useCallback(async (force = false) => {
    const source: CalendarSource = 'lessonPlans'
    const requestedClassroomId = classroom.id
    const requestId = loadRequestIdsRef.current[source] + 1
    loadRequestIdsRef.current[source] = requestId
    const cacheKey = `student-lesson-plans:${requestedClassroomId}:${fetchRange.start}:${fetchRange.end}`
    if (force) invalidateCachedJSON(cacheKey)
    setSourceStatus((current) => ({
      ...current,
      [source]: {
        classroomId: requestedClassroomId,
        error: current[source].classroomId === requestedClassroomId && current[source].error,
        hasLoadedSnapshot: current[source].classroomId === requestedClassroomId && current[source].hasLoadedSnapshot,
        isLoading: true,
      },
    }))
    try {
      const data = await fetchCachedJSON<StudentLessonPlansResponse>(
        cacheKey,
        `/api/student/classrooms/${requestedClassroomId}/lesson-plans?start=${fetchRange.start}&end=${fetchRange.end}`,
        { ttlMs: 20_000, errorMessage: 'Failed to load lesson plans' },
      )
      if (loadRequestIdsRef.current[source] !== requestId || currentClassroomIdRef.current !== requestedClassroomId) return
      setLessonPlans(data.lesson_plans || [])
      setMaxDate(data.max_date || null)
      setSourceStatus((current) => ({
        ...current,
        [source]: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
      }))
    } catch (err) {
      if (loadRequestIdsRef.current[source] !== requestId || currentClassroomIdRef.current !== requestedClassroomId) return
      console.error('Error loading lesson plans:', err)
      setSourceStatus((current) => ({
        ...current,
        [source]: { ...current[source], classroomId: requestedClassroomId, error: true, isLoading: false },
      }))
    }
  }, [classroom.id, fetchRange.end, fetchRange.start])

  const loadAssignments = useCallback(async (force = false) => {
    const source: CalendarSource = 'assignments'
    const requestedClassroomId = classroom.id
    const requestId = loadRequestIdsRef.current[source] + 1
    loadRequestIdsRef.current[source] = requestId
    const cacheKey = `student-assignments:${requestedClassroomId}`
    if (force) invalidateCachedJSON(cacheKey)
    setSourceStatus((current) => ({
      ...current,
      [source]: {
        classroomId: requestedClassroomId,
        error: current[source].classroomId === requestedClassroomId && current[source].error,
        hasLoadedSnapshot: current[source].classroomId === requestedClassroomId && current[source].hasLoadedSnapshot,
        isLoading: true,
      },
    }))
    try {
      const data = await fetchCachedJSON<StudentAssignmentsResponse>(
        cacheKey,
        `/api/student/assignments?classroom_id=${requestedClassroomId}`,
        { ttlMs: 20_000, errorMessage: 'Failed to load assignments' },
      )
      if (loadRequestIdsRef.current[source] !== requestId || currentClassroomIdRef.current !== requestedClassroomId) return
      setAssignments(data.assignments || [])
      setSourceStatus((current) => ({
        ...current,
        [source]: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
      }))
    } catch (err) {
      if (loadRequestIdsRef.current[source] !== requestId || currentClassroomIdRef.current !== requestedClassroomId) return
      console.error('Error loading calendar assignments:', err)
      setSourceStatus((current) => ({
        ...current,
        [source]: { ...current[source], classroomId: requestedClassroomId, error: true, isLoading: false },
      }))
    }
  }, [classroom.id])

  const loadAnnouncements = useCallback(async (force = false) => {
    const source: CalendarSource = 'announcements'
    const requestedClassroomId = classroom.id
    const requestId = loadRequestIdsRef.current[source] + 1
    loadRequestIdsRef.current[source] = requestId
    const cacheKey = `student-announcements:${requestedClassroomId}`
    if (force) invalidateCachedJSON(cacheKey)
    setSourceStatus((current) => ({
      ...current,
      [source]: {
        classroomId: requestedClassroomId,
        error: current[source].classroomId === requestedClassroomId && current[source].error,
        hasLoadedSnapshot: current[source].classroomId === requestedClassroomId && current[source].hasLoadedSnapshot,
        isLoading: true,
      },
    }))
    try {
      const data = await fetchCachedJSON<StudentAnnouncementsResponse>(
        cacheKey,
        `/api/student/classrooms/${requestedClassroomId}/announcements`,
        { ttlMs: 20_000, errorMessage: 'Failed to load announcements' },
      )
      if (loadRequestIdsRef.current[source] !== requestId || currentClassroomIdRef.current !== requestedClassroomId) return
      setAnnouncements(data.announcements || [])
      setSourceStatus((current) => ({
        ...current,
        [source]: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
      }))
    } catch (err) {
      if (loadRequestIdsRef.current[source] !== requestId || currentClassroomIdRef.current !== requestedClassroomId) return
      console.error('Error loading calendar announcements:', err)
      setSourceStatus((current) => ({
        ...current,
        [source]: { ...current[source], classroomId: requestedClassroomId, error: true, isLoading: false },
      }))
    }
  }, [classroom.id])

  useEffect(() => {
    void Promise.all([loadLessonPlans(), loadAssignments(), loadAnnouncements()])
  }, [loadAnnouncements, loadAssignments, loadLessonPlans])

  const lessonPlansStatus = sourceStatus.lessonPlans
  const assignmentsStatus = sourceStatus.assignments
  const announcementsStatus = sourceStatus.announcements
  const currentLessonPlans = lessonPlansStatus.classroomId === classroom.id && lessonPlansStatus.hasLoadedSnapshot ? lessonPlans : []
  const currentAssignments = assignmentsStatus.classroomId === classroom.id && assignmentsStatus.hasLoadedSnapshot ? assignments : []
  const currentAnnouncements = announcementsStatus.classroomId === classroom.id && announcementsStatus.hasLoadedSnapshot ? announcements : []
  const localStatuses = [lessonPlansStatus, assignmentsStatus, announcementsStatus]
  const hasAnyLocalSnapshot = localStatuses.some((status) => (
    status.classroomId === classroom.id && status.hasLoadedSnapshot
  ))
  const hasAnySnapshot = hasAnyLocalSnapshot || hasClassDaysSnapshot
  const haveLocalSourcesInitialized = localStatuses.every((status) => status.classroomId === classroom.id)
  const isInitialLoading = !haveLocalSourcesInitialized || (
    !hasAnyLocalSnapshot && localStatuses.some((status) => status.isLoading)
  )
  const isRefreshing = localStatuses.some((status) => status.isLoading) || classDaysLoading
  const retryLessonPlans = useCallback(() => {
    retryingSourcesRef.current.add('lessonPlans')
    void loadLessonPlans(true)
  }, [loadLessonPlans])
  const retryAssignments = useCallback(() => {
    retryingSourcesRef.current.add('assignments')
    void loadAssignments(true)
  }, [loadAssignments])
  const retryAnnouncements = useCallback(() => {
    retryingSourcesRef.current.add('announcements')
    void loadAnnouncements(true)
  }, [loadAnnouncements])
  const retryClassDays = useCallback(() => {
    retryingSourcesRef.current.add('classDays')
    void refreshClassDays()
  }, [refreshClassDays])

  useEffect(() => {
    const statuses: Record<CalendarRetrySource, { error: boolean; isLoading: boolean }> = {
      lessonPlans: lessonPlansStatus,
      assignments: assignmentsStatus,
      announcements: announcementsStatus,
      classDays: { error: Boolean(classDaysError), isLoading: classDaysLoading },
    }
    for (const source of retryingSourcesRef.current) {
      const status = statuses[source]
      if (status.isLoading) continue
      retryingSourcesRef.current.delete(source)
      if (!status.error) calendarWorkspaceRef.current?.focus()
    }
  }, [announcementsStatus, assignmentsStatus, classDaysError, classDaysLoading, lessonPlansStatus])

  const failures: CalendarSourceFailure[] = []
  if (lessonPlansStatus.classroomId === classroom.id && lessonPlansStatus.error) {
    failures.push({ id: 'lesson-plans', label: 'lesson plans', isRetrying: lessonPlansStatus.isLoading, onRetry: retryLessonPlans })
  }
  if (assignmentsStatus.classroomId === classroom.id && assignmentsStatus.error) {
    failures.push({ id: 'assignments', label: 'assignments', isRetrying: assignmentsStatus.isLoading, onRetry: retryAssignments })
  }
  if (announcementsStatus.classroomId === classroom.id && announcementsStatus.error) {
    failures.push({ id: 'announcements', label: 'announcements', isRetrying: announcementsStatus.isLoading, onRetry: retryAnnouncements })
  }
  if (classDaysError) {
    failures.push({ id: 'class-days', label: 'class days', isRetrying: classDaysLoading, onRetry: retryClassDays })
  }

  const retryAll = useCallback(() => {
    retryLessonPlans()
    retryAssignments()
    retryAnnouncements()
    retryClassDays()
  }, [retryAnnouncements, retryAssignments, retryClassDays, retryLessonPlans])

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
    handleDateChange(nowInToronto())
  }, [handleDateChange])

  if (!hasAnySnapshot && failures.length > 0) {
    return (
      <PageLayout bleedX={false}>
        <PageContent>
          <PageState
            kind="error"
            title="Calendar couldn't load"
            description="Pika couldn't load this classroom's calendar information. Nothing was changed."
            action={(
              <Button type="button" onClick={retryAll} disabled={isRefreshing}>
                {isRefreshing ? 'Retrying...' : 'Retry'}
              </Button>
            )}
          />
        </PageContent>
      </PageLayout>
    )
  }

  if (isInitialLoading) {
    return (
      <PageLayout bleedX={false}>
        <PageContent>
          <PageState kind="loading" title="Loading calendar" />
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
        <div ref={calendarWorkspaceRef} role="region" aria-label="Calendar workspace" tabIndex={-1} className="outline-none">
          {isRefreshing ? <RefreshingIndicator label="Refreshing calendar" className="mb-2" /> : null}
          <CalendarSourceErrors failures={failures} />
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
        </div>
      </PageContent>
    </PageLayout>
  )
}
