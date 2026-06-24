'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addMonths, addWeeks, endOfMonth, format, startOfMonth, subMonths, subWeeks } from 'date-fns'
import { CalendarActionBar } from '@/components/CalendarActionBar'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useRightSidebar } from '@/components/layout'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { applyPendingLessonPlanChanges, lessonPlansToMarkdown, markdownToLessonPlans } from '@/lib/lesson-plan-markdown'
import { useClassDays } from '@/hooks/useClassDays'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import type { Classroom, LessonPlan, Assignment, Announcement } from '@/types'
import { readCookie, writeCookie } from '@/lib/cookies'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT, TEACHER_ASSIGNMENTS_UPDATED_EVENT } from '@/lib/events'
import { normalizeLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import {
  fetchTeacherLessonPlansForRange,
  invalidateTeacherLessonPlansForClassroom,
} from '@/lib/teacher-lesson-plans-client'

/**
 * Returns true if the content change is identical to the last value emitted
 * for this date. Markdown editing no longer needs Tiptap normalization guards,
 * but duplicate-change suppression still avoids unnecessary autosave churn.
 */
export function isNormalizationNoise(
  lastSeen: Map<string, string>,
  lessonPlans: LessonPlan[],
  date: string,
  contentStr: string
): boolean {
  void lessonPlans
  const prev = lastSeen.get(date)
  return prev === contentStr
}

const AUTOSAVE_DEBOUNCE_MS = 3000
const AUTOSAVE_MIN_INTERVAL_MS = 10000
const MARKDOWN_SYNC_DEBOUNCE_MS = 300

export interface CalendarSidebarState {
  markdownContent: string
  markdownError: string | null
  bulkSaving: boolean
  onMarkdownChange: (content: string) => void
  onSave: () => void
}

interface Props {
  classroom: Classroom
  onSidebarStateChange?: (state: CalendarSidebarState | null) => void
  onNavigateToAssignments?: (assignmentId?: string | null) => void
  onNavigateToAnnouncements?: () => void
}

export function TeacherLessonCalendarTab({
  classroom,
  onSidebarStateChange,
  onNavigateToAssignments = () => {},
  onNavigateToAnnouncements = () => {},
}: Props) {
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [lessonPlansClassroomId, setLessonPlansClassroomId] = useState(classroom.id)
  const visibleLessonPlans = lessonPlansClassroomId === classroom.id ? lessonPlans : []
  const lessonPlansRef = useRef(visibleLessonPlans)
  lessonPlansRef.current = visibleLessonPlans
  // Track last-seen markdown per date to suppress duplicate autosave emissions.
  const lastSeenContentRef = useRef<Map<string, string>>(new Map())
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [assignmentsClassroomId, setAssignmentsClassroomId] = useState(classroom.id)
  const visibleAssignments = assignmentsClassroomId === classroom.id ? assignments : []
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [announcementsClassroomId, setAnnouncementsClassroomId] = useState(classroom.id)
  const visibleAnnouncements = announcementsClassroomId === classroom.id ? announcements : []
  const classDays = useClassDays(classroom.id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
    const saved = readCookie(`calendarViewMode:${classroom.id}`)
    return (saved === 'week' || saved === 'month' || saved === 'all') ? saved : 'week'
  })
  const handleViewModeChange = useCallback((mode: CalendarViewMode) => {
    setViewMode(mode)
    writeCookie(`calendarViewMode:${classroom.id}`, mode)
  }, [classroom.id])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownContentClassroomId, setMarkdownContentClassroomId] = useState('')
  const visibleMarkdownContent = markdownContentClassroomId === classroom.id ? markdownContent : ''
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const currentClassroomIdRef = useRef(classroom.id)
  currentClassroomIdRef.current = classroom.id

  const { toggle: toggleSidebar, isOpen: isSidebarOpen, setOpen: setSidebarOpen } = useRightSidebar()
  const { showMarkdown } = useMarkdownPreference()

  // Auto-save tracking
  const pendingChangesRef = useRef<Map<string, string>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAtRef = useRef<number>(0)
  const prevSidebarOpenRef = useRef(false)
  const needsRefreshRef = useRef(true) // Force refresh on first open or after save
  const markdownContentRef = useRef('') // Ref to avoid stale closure in save handler
  const markdownSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const applyLocalLessonPlanChange = useCallback((date: string, contentMarkdown: string) => {
    const normalized = normalizeLessonPlanMarkdown(contentMarkdown)
    const now = new Date().toISOString()

    setLessonPlansClassroomId(classroom.id)
    setLessonPlans((prev) => {
      const existing = prev.find((plan) => plan.date === date)

      if (normalized.trim().length === 0) {
        return existing ? prev.filter((plan) => plan.date !== date) : prev
      }

      if (existing) {
        return prev.map((plan) => (
          plan.date === date
            ? {
                ...plan,
                content_markdown: normalized,
                updated_at: now,
              }
            : plan
        ))
      }

      return [
        ...prev,
        {
          id: `local-${date}`,
          classroom_id: classroom.id,
          date,
          content: { type: 'doc', content: [] },
          content_markdown: normalized,
          created_at: now,
          updated_at: now,
        },
      ]
    })
  }, [classroom.id])

  // Always fetch the full term - switching views is then instant
  const fetchRange = useMemo(() => {
    const start = classroom.start_date || format(startOfMonth(currentDate), 'yyyy-MM-dd')
    const end = classroom.end_date || format(endOfMonth(currentDate), 'yyyy-MM-dd')
    return { start, end }
  }, [classroom.start_date, classroom.end_date, currentDate])

  // Fetch all lesson plans for the term once
  useEffect(() => {
    let cancelled = false
    const requestedClassroomId = classroom.id
    const isCurrentLoad = () => !cancelled && currentClassroomIdRef.current === requestedClassroomId

    async function loadLessonPlans() {
      setLoading(true)
      try {
        const plans = await fetchTeacherLessonPlansForRange(requestedClassroomId, fetchRange.start, fetchRange.end)
        if (!isCurrentLoad()) return
        // Seed last-seen content so Tiptap normalization doesn't trigger saves
        lastSeenContentRef.current.clear()
        for (const plan of plans) {
          lastSeenContentRef.current.set(plan.date, plan.content_markdown ?? '')
        }
        setLessonPlansClassroomId(requestedClassroomId)
        setLessonPlans(plans)
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading lesson plans:', err)
      } finally {
        if (isCurrentLoad()) {
          setLoading(false)
        }
      }
    }
    loadLessonPlans()

    return () => {
      cancelled = true
    }
  }, [classroom.id, fetchRange.start, fetchRange.end, refreshKey])

  // Fetch assignments for the classroom
  useEffect(() => {
    let cancelled = false
    const requestedClassroomId = classroom.id
    const isCurrentLoad = () => !cancelled && currentClassroomIdRef.current === requestedClassroomId

    async function loadAssignments() {
      try {
        const data = await fetchCachedJSON<{ assignments?: Assignment[] }>(
          `teacher-assignments:${requestedClassroomId}`,
          `/api/teacher/assignments?classroom_id=${requestedClassroomId}`,
          { errorMessage: 'Failed to load assignments', ttlMs: 20_000 },
        )
        if (!isCurrentLoad()) return
        setAssignmentsClassroomId(requestedClassroomId)
        setAssignments(data.assignments || [])
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading assignments:', err)
      }
    }
    loadAssignments()

    // Re-fetch when assignments are created, updated, or released
    const handleAssignmentsUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.classroomId || detail.classroomId === classroom.id) {
        invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
        loadAssignments()
      }
    }
    window.addEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    }
  }, [classroom.id])

  // Fetch announcements for the classroom
  useEffect(() => {
    let cancelled = false
    const requestedClassroomId = classroom.id
    const isCurrentLoad = () => !cancelled && currentClassroomIdRef.current === requestedClassroomId

    async function loadAnnouncements() {
      try {
        const data = await fetchCachedJSON<{ announcements?: Announcement[] }>(
          `teacher-announcements:${requestedClassroomId}`,
          `/api/teacher/classrooms/${requestedClassroomId}/announcements`,
          { errorMessage: 'Failed to load announcements', ttlMs: 20_000 },
        )
        if (!isCurrentLoad()) return
        setAnnouncementsClassroomId(requestedClassroomId)
        setAnnouncements(data.announcements || [])
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading announcements:', err)
      }
    }
    loadAnnouncements()

    return () => {
      cancelled = true
    }
  }, [classroom.id])

  // Save a single lesson plan
  const saveLessonPlan = useCallback(
    async (date: string, contentMarkdown: string) => {
      const requestedClassroomId = classroom.id
      try {
        const res = await fetch(`/api/teacher/classrooms/${requestedClassroomId}/lesson-plans/${date}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_markdown: contentMarkdown }),
        })
        if (res.ok) {
          const data = await res.json()
          invalidateTeacherLessonPlansForClassroom(requestedClassroomId)
          needsRefreshRef.current = true
          if (currentClassroomIdRef.current !== requestedClassroomId) return
          setLessonPlansClassroomId(requestedClassroomId)
          setLessonPlans((prev) => {
            if (!data.lesson_plan) {
              return prev.filter((plan) => plan.date !== date)
            }

            const existing = prev.findIndex((p) => p.date === date)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = data.lesson_plan
              return updated
            }
            return [...prev, data.lesson_plan]
          })
        }
      } catch (err) {
        console.error('Error saving lesson plan:', err)
      }
    },
    [classroom.id]
  )

  // Flush pending saves
  const flushPendingSaves = useCallback(async () => {
    if (pendingChangesRef.current.size === 0) return

    setSaving(true)
    const entries = Array.from(pendingChangesRef.current.entries())
    pendingChangesRef.current.clear()

    await Promise.all(entries.map(([date, content]) => saveLessonPlan(date, content)))
    lastSaveAtRef.current = Date.now()
    setSaving(false)
  }, [saveLessonPlan])

  // Schedule save with debounce and throttle
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    const timeSinceLastSave = Date.now() - lastSaveAtRef.current
    const delay = Math.max(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MIN_INTERVAL_MS - timeSinceLastSave)

    saveTimeoutRef.current = setTimeout(() => {
      flushPendingSaves()
    }, delay)
  }, [flushPendingSaves])

  // Handle content change from calendar
  const handleContentChange = useCallback(
    (date: string, contentMarkdown: string) => {
      if (loading) return
      const contentStr = contentMarkdown
      if (isNormalizationNoise(lastSeenContentRef.current, lessonPlansRef.current, date, contentStr)) {
        lastSeenContentRef.current.set(date, contentStr)
        return
      }
      lastSeenContentRef.current.set(date, contentStr)
      applyLocalLessonPlanChange(date, contentMarkdown)
      pendingChangesRef.current.set(date, contentMarkdown)
      scheduleSave()
    },
    [applyLocalLessonPlanChange, loading, scheduleSave]
  )

  // Flush on unmount and handle page close
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Synchronously save any pending changes before page unload
      if (pendingChangesRef.current.size > 0) {
        const entries = Array.from(pendingChangesRef.current.entries())
        for (const [date, contentMarkdown] of entries) {
          // Use sendBeacon for reliable delivery during page unload
          navigator.sendBeacon(
            `/api/teacher/classrooms/${classroom.id}/lesson-plans/${date}`,
            new Blob([JSON.stringify({ content_markdown: contentMarkdown })], { type: 'application/json' })
          )
        }
        pendingChangesRef.current.clear()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    // Capture ref value for cleanup
    const pendingChanges = pendingChangesRef.current

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (markdownSyncTimeoutRef.current) {
        clearTimeout(markdownSyncTimeoutRef.current)
      }
      // Flush any pending changes on component unmount (e.g., navigation)
      // The fetch will complete even after unmount
      if (pendingChanges.size > 0) {
        flushPendingSaves()
      }
    }
  }, [classroom.id, flushPendingSaves])

  // Fetch and generate markdown content
  const loadMarkdownContent = useCallback(async () => {
    const requestedClassroomId = classroom.id
    const isCurrentLoad = () => currentClassroomIdRef.current === requestedClassroomId

    setLoading(true)
    setMarkdownError(null)
    try {
      const start = classroom.start_date || fetchRange.start
      const end = classroom.end_date || fetchRange.end
      const cachedPlans = await fetchTeacherLessonPlansForRange(requestedClassroomId, start, end)
      if (!isCurrentLoad()) return
      const plans = applyPendingLessonPlanChanges(cachedPlans, pendingChangesRef.current, requestedClassroomId)
      const markdown = lessonPlansToMarkdown(classroom, plans, start, end)
      setMarkdownContentClassroomId(requestedClassroomId)
      setMarkdownContent(markdown)
      markdownContentRef.current = markdown
      needsRefreshRef.current = false
    } catch (err) {
      if (!isCurrentLoad()) return
      console.error('Error loading lesson plans:', err)
      setMarkdownError(err instanceof Error ? err.message : 'Failed to load lesson plans')
    } finally {
      if (isCurrentLoad()) {
        setLoading(false)
      }
    }
  }, [classroom, fetchRange])

  const previousMarkdownClassroomIdRef = useRef(classroom.id)
  useEffect(() => {
    if (previousMarkdownClassroomIdRef.current === classroom.id) return
    previousMarkdownClassroomIdRef.current = classroom.id
    markdownContentRef.current = ''
    setMarkdownContent('')
    setMarkdownContentClassroomId('')
    setMarkdownError(null)
    needsRefreshRef.current = true
    if (showMarkdown && isSidebarOpen) {
      loadMarkdownContent()
    }
  }, [classroom.id, isSidebarOpen, loadMarkdownContent, showMarkdown])

  // Handle markdown panel toggle - just toggle, effect handles loading
  const handleMarkdownToggle = useCallback(() => {
    if (!showMarkdown) return
    toggleSidebar()
  }, [showMarkdown, toggleSidebar])

  // Handle markdown content change - ref updates immediately, state updates debounced
  const handleMarkdownChange = useCallback((content: string) => {
    // Always update ref immediately so save has latest content
    markdownContentRef.current = content
    setMarkdownContentClassroomId(classroom.id)

    // Debounce state update to reduce parent re-renders
    if (markdownSyncTimeoutRef.current) {
      clearTimeout(markdownSyncTimeoutRef.current)
    }
    markdownSyncTimeoutRef.current = setTimeout(() => {
      setMarkdownContent(content)
    }, MARKDOWN_SYNC_DEBOUNCE_MS)
  }, [classroom.id])

  // Load markdown content when sidebar opens (handles both button click and keyboard shortcut)
  useEffect(() => {
    const wasOpen = prevSidebarOpenRef.current
    prevSidebarOpenRef.current = isSidebarOpen

    // Only load when transitioning from closed to open AND we need a refresh
    if (showMarkdown && isSidebarOpen && !wasOpen && needsRefreshRef.current) {
      loadMarkdownContent()
    }
  }, [isSidebarOpen, loadMarkdownContent, showMarkdown])

  useEffect(() => {
    if (showMarkdown || !isSidebarOpen) return
    setSidebarOpen(false)
  }, [isSidebarOpen, setSidebarOpen, showMarkdown])

  // Handle markdown save
  const handleMarkdownSave = useCallback(async () => {
    setMarkdownError(null)
    if (markdownContentClassroomId !== classroom.id) {
      setMarkdownError('Lesson plans are still loading')
      return
    }
    setBulkSaving(true)

    try {
      const result = markdownToLessonPlans(markdownContentRef.current, classroom)

      if (result.errors.length > 0) {
        setMarkdownError(result.errors.join('\n'))
        setBulkSaving(false)
        return
      }

      if (result.plans.length === 0 && result.clearedDates.length === 0) {
        invalidateTeacherLessonPlansForClassroom(classroom.id)
        needsRefreshRef.current = true
        setSidebarOpen(false)
        setRefreshKey((k) => k + 1)
        return
      }

      // Bulk save
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/lesson-plans/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans: result.plans, cleared_dates: result.clearedDates }),
      })

      if (!res.ok) {
        const data = await res.json()
        setMarkdownError(data.error || 'Failed to save')
        setBulkSaving(false)
        return
      }

      // Success - close panel and refresh calendar
      invalidateTeacherLessonPlansForClassroom(classroom.id)
      needsRefreshRef.current = true // Force refresh on next sidebar open
      setSidebarOpen(false)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Error saving markdown:', err)
      setMarkdownError('Failed to save lesson plans')
    } finally {
      setBulkSaving(false)
    }
  }, [classroom, markdownContentClassroomId, setSidebarOpen])

  // Handle assignment click - navigate to assignments tab with assignment selected
  const handleAssignmentClick = useCallback(
    (assignment: Assignment) => {
      // Set cookie for teacher assignment selection
      const cookieName = `teacherAssignmentsSelection:${classroom.id}`
      writeCookie(cookieName, assignment.id)
      // Dispatch event so NavItems updates
      window.dispatchEvent(
        new CustomEvent(TEACHER_ASSIGNMENTS_SELECTION_EVENT, {
          detail: { classroomId: classroom.id, value: assignment.id },
        })
      )
      onNavigateToAssignments(assignment.id)
    },
    [onNavigateToAssignments, classroom.id]
  )

  // Handle announcement click - navigate to Announcements
  const handleAnnouncementClick = useCallback(() => {
    onNavigateToAnnouncements()
  }, [onNavigateToAnnouncements])

  const handlePreviousDate = useCallback(() => {
    if (viewMode === 'week') {
      setCurrentDate((prev) => subWeeks(prev, 1))
    } else if (viewMode === 'month') {
      setCurrentDate((prev) => subMonths(prev, 1))
    }
  }, [viewMode])

  const handleNextDate = useCallback(() => {
    if (viewMode === 'week') {
      setCurrentDate((prev) => addWeeks(prev, 1))
    } else if (viewMode === 'month') {
      setCurrentDate((prev) => addMonths(prev, 1))
    }
  }, [viewMode])

  const handleToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // Notify parent when sidebar opens/closes, content changes, or error/saving state changes
  // Note: markdownContent IS included because the sidebar uses local state to avoid cursor jump.
  // TeacherLessonCalendarSidebar tracks isDirty and ignores external updates once user starts typing.
  useEffect(() => {
    if (showMarkdown && isSidebarOpen) {
      onSidebarStateChange?.({
        markdownContent: visibleMarkdownContent,
        markdownError,
        bulkSaving,
        onMarkdownChange: handleMarkdownChange,
        onSave: handleMarkdownSave,
      })
    } else {
      onSidebarStateChange?.(null)
    }
  }, [showMarkdown, isSidebarOpen, visibleMarkdownContent, markdownError, bulkSaving, onSidebarStateChange, handleMarkdownSave, handleMarkdownChange])

  if (loading && visibleLessonPlans.length === 0) {
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
        trailing={saving || showMarkdown ? (
          <div className="flex items-center gap-1.5">
            {saving && <span className="hidden text-sm text-text-muted sm:inline">Saving...</span>}
            {showMarkdown ? (
              <TeacherEditModeControls
                active={isSidebarOpen}
                onActiveChange={handleMarkdownToggle}
                disabled={Boolean(classroom.archived_at)}
                variant="secondary"
                className="[&>button>span]:sr-only sm:[&>button>span]:not-sr-only"
              />
            ) : null}
          </div>
        ) : null}
      />
      <PageContent className="pb-24 pt-2">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <LessonCalendar
            classroom={classroom}
            lessonPlans={visibleLessonPlans}
            assignments={visibleAssignments}
            announcements={visibleAnnouncements}
            classDays={classDays}
            viewMode={viewMode}
            currentDate={currentDate}
            editable={!classroom.archived_at}
            showHeader={false}
            onDateChange={setCurrentDate}
            onViewModeChange={handleViewModeChange}
            onContentChange={handleContentChange}
            onAssignmentClick={handleAssignmentClick}
            onAnnouncementClick={handleAnnouncementClick}
          />
        </div>
      </PageContent>
    </PageLayout>
  )
}

// Sidebar content component - rendered via page.tsx
// Uses local state to avoid cursor jump issues from parent re-renders
export function TeacherLessonCalendarSidebar({
  markdownContent: initialContent,
  markdownError,
  bulkSaving,
  onMarkdownChange,
  onSave,
}: {
  markdownContent: string
  markdownError: string | null
  bulkSaving: boolean
  onMarkdownChange: (content: string) => void
  onSave: () => void
}) {
  // Local state for textarea to avoid cursor jumping
  const [localContent, setLocalContent] = useState(initialContent)
  // Track if user has made local edits (dirty state)
  const [isDirty, setIsDirty] = useState(false)
  // Track the last synced content to detect external changes
  const lastSyncedContentRef = useRef(initialContent)

  // Sync local state when initialContent changes (e.g., on sidebar reopen)
  // Only sync if user hasn't made local edits OR if content is completely different
  // (indicating a fresh load rather than a race condition)
  useEffect(() => {
    const isCompletelyDifferent = initialContent !== lastSyncedContentRef.current
    if (!isDirty || isCompletelyDifferent) {
      setLocalContent(initialContent)
      lastSyncedContentRef.current = initialContent
      setIsDirty(false)
    }
  }, [initialContent, isDirty])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setLocalContent(newContent)
    setIsDirty(true)
    onMarkdownChange(newContent)
  }

  // Cmd+S / Ctrl+S to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      if (!bulkSaving) {
        onSave()
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {markdownError && (
        <div className="mx-2 mt-2 p-2 rounded bg-danger-bg text-sm text-danger whitespace-pre-wrap">
          {markdownError}
        </div>
      )}

      <textarea
        value={localContent}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="flex-1 w-full p-3 font-mono text-sm bg-surface text-text-default resize-none focus:outline-none"
      />
    </div>
  )
}
