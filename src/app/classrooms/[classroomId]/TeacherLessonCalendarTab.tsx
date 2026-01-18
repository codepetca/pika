'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { getOntarioHolidays } from '@/lib/calendar'
import { useRightSidebar } from '@/components/layout'
import { lessonPlansToMarkdown, markdownToLessonPlans } from '@/lib/lesson-plan-markdown'
import { useClassDays } from '@/hooks/useClassDays'
import type { Classroom, LessonPlan, TiptapContent, Assignment } from '@/types'
import { writeCookie } from '@/lib/cookies'

const AUTOSAVE_DEBOUNCE_MS = 3000
const AUTOSAVE_MIN_INTERVAL_MS = 10000

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
}

export function TeacherLessonCalendarTab({ classroom, onSidebarStateChange }: Props) {
  const router = useRouter()
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const classDays = useClassDays(classroom.id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const { toggle: toggleSidebar, isOpen: isSidebarOpen, setOpen: setSidebarOpen } = useRightSidebar()

  // Auto-save tracking
  const pendingChangesRef = useRef<Map<string, TiptapContent>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAtRef = useRef<number>(0)
  const prevSidebarOpenRef = useRef(false)
  const needsRefreshRef = useRef(true) // Force refresh on first open or after save

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
          `/api/teacher/classrooms/${classroom.id}/lesson-plans?start=${fetchRange.start}&end=${fetchRange.end}`
        )
        const data = await res.json()
        setLessonPlans(data.lesson_plans || [])
      } catch (err) {
        console.error('Error loading lesson plans:', err)
      } finally {
        setLoading(false)
      }
    }
    loadLessonPlans()
  }, [classroom.id, fetchRange.start, fetchRange.end, refreshKey])

  // Fetch assignments for the classroom
  useEffect(() => {
    async function loadAssignments() {
      try {
        const res = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`)
        const data = await res.json()
        setAssignments(data.assignments || [])
      } catch (err) {
        console.error('Error loading assignments:', err)
      }
    }
    loadAssignments()
  }, [classroom.id])

  // Save a single lesson plan
  const saveLessonPlan = useCallback(
    async (date: string, content: TiptapContent) => {
      try {
        const res = await fetch(`/api/teacher/classrooms/${classroom.id}/lesson-plans/${date}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        if (res.ok) {
          const data = await res.json()
          // Update local state
          setLessonPlans((prev) => {
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
    (date: string, content: TiptapContent) => {
      pendingChangesRef.current.set(date, content)
      scheduleSave()
    },
    [scheduleSave]
  )

  // Flush on unmount and handle page close
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Synchronously save any pending changes before page unload
      if (pendingChangesRef.current.size > 0) {
        const entries = Array.from(pendingChangesRef.current.entries())
        for (const [date, content] of entries) {
          // Use sendBeacon for reliable delivery during page unload
          navigator.sendBeacon(
            `/api/teacher/classrooms/${classroom.id}/lesson-plans/${date}`,
            new Blob([JSON.stringify({ content })], { type: 'application/json' })
          )
        }
        pendingChangesRef.current.clear()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Flush any pending changes on component unmount (e.g., navigation)
      // The fetch will complete even after unmount
      if (pendingChangesRef.current.size > 0) {
        flushPendingSaves()
      }
    }
  }, [classroom.id, flushPendingSaves])

  // Fetch and generate markdown content
  const loadMarkdownContent = useCallback(async () => {
    setLoading(true)
    setMarkdownError(null)
    try {
      const start = classroom.start_date || fetchRange.start
      const end = classroom.end_date || fetchRange.end
      const res = await fetch(
        `/api/teacher/classrooms/${classroom.id}/lesson-plans?start=${start}&end=${end}`
      )
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      const plans = data.lesson_plans || []
      const markdown = lessonPlansToMarkdown(classroom, plans, start, end)
      setMarkdownContent(markdown)
      needsRefreshRef.current = false
    } catch (err) {
      console.error('Error generating markdown:', err)
      setMarkdownError('Failed to load lesson plans')
    } finally {
      setLoading(false)
    }
  }, [classroom, fetchRange])

  // Handle markdown panel toggle - just toggle, effect handles loading
  const handleMarkdownToggle = useCallback(() => {
    toggleSidebar()
  }, [toggleSidebar])

  // Load markdown content when sidebar opens (handles both button click and keyboard shortcut)
  useEffect(() => {
    const wasOpen = prevSidebarOpenRef.current
    prevSidebarOpenRef.current = isSidebarOpen

    // Only load when transitioning from closed to open AND we need a refresh
    if (isSidebarOpen && !wasOpen && needsRefreshRef.current) {
      loadMarkdownContent()
    }
  }, [isSidebarOpen, loadMarkdownContent])

  // Handle markdown save
  const handleMarkdownSave = useCallback(async () => {
    setMarkdownError(null)
    setBulkSaving(true)

    try {
      const result = markdownToLessonPlans(markdownContent, classroom)

      if (result.errors.length > 0) {
        setMarkdownError(result.errors.join('\n'))
        setBulkSaving(false)
        return
      }

      // Bulk save
      const res = await fetch(`/api/teacher/classrooms/${classroom.id}/lesson-plans/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans: result.plans }),
      })

      if (!res.ok) {
        const data = await res.json()
        setMarkdownError(data.error || 'Failed to save')
        setBulkSaving(false)
        return
      }

      // Success - close panel and refresh calendar
      needsRefreshRef.current = true // Force refresh on next sidebar open
      setSidebarOpen(false)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Error saving markdown:', err)
      setMarkdownError('Failed to save lesson plans')
    } finally {
      setBulkSaving(false)
    }
  }, [markdownContent, classroom, setSidebarOpen])

  // Handle assignment click - navigate to assignments tab with assignment selected
  const handleAssignmentClick = useCallback(
    (assignment: Assignment) => {
      // Set cookie for teacher assignment selection
      const cookieName = `teacherAssignmentsSelection:${classroom.id}`
      writeCookie(cookieName, assignment.id)
      // Dispatch event so NavItems updates
      window.dispatchEvent(
        new CustomEvent('pika:teacherAssignmentsSelection', {
          detail: { classroomId: classroom.id, value: assignment.id },
        })
      )
      router.push(`/classrooms/${classroom.id}?tab=assignments`)
    },
    [router, classroom.id]
  )

  // Notify parent when sidebar opens/closes or error/saving state changes
  // Note: markdownContent is intentionally excluded to avoid cursor jump on every keystroke
  useEffect(() => {
    if (isSidebarOpen) {
      onSidebarStateChange?.({
        markdownContent,
        markdownError,
        bulkSaving,
        onMarkdownChange: setMarkdownContent,
        onSave: handleMarkdownSave,
      })
    } else {
      onSidebarStateChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSidebarOpen, markdownError, bulkSaving, onSidebarStateChange, handleMarkdownSave])

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
          assignments={assignments.filter((a) => !a.is_draft)}
          classDays={classDays}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={!classroom.archived_at}
          saving={saving}
          onDateChange={setCurrentDate}
          onViewModeChange={setViewMode}
          onContentChange={handleContentChange}
          onAssignmentClick={handleAssignmentClick}
          onMarkdownToggle={handleMarkdownToggle}
          isSidebarOpen={isSidebarOpen}
          holidays={holidays}
        />
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

  // Sync local state when initialContent changes (e.g., on sidebar reopen)
  useEffect(() => {
    setLocalContent(initialContent)
  }, [initialContent])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setLocalContent(newContent)
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
        <div className="mx-2 mt-2 p-2 rounded bg-red-50 dark:bg-red-900/30 text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">
          {markdownError}
        </div>
      )}

      <textarea
        value={localContent}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="flex-1 w-full p-3 font-mono text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-none focus:outline-none"
        placeholder="Loading..."
      />
    </div>
  )
}
