'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useRightSidebar } from '@/components/layout'
import { lessonPlansToMarkdown, markdownToLessonPlans } from '@/lib/lesson-plan-markdown'
import { isEmpty as isEmptyTiptapContent } from '@/lib/tiptap-content'
import { useClassDays } from '@/hooks/useClassDays'
import type { Classroom, LessonPlan, TiptapContent, Assignment, Announcement } from '@/types'
import { readCookie, writeCookie } from '@/lib/cookies'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT } from '@/lib/events'

/**
 * Returns true if the content change is just Tiptap normalizing stored content
 * on editor mount (e.g. the Markdown extension restructuring nodes). Compares
 * against a mutable map of last-seen stringified content per date.
 */
export function isNormalizationNoise(
  lastSeen: Map<string, string>,
  lessonPlans: LessonPlan[],
  date: string,
  contentStr: string
): boolean {
  const prev = lastSeen.get(date)
  // Exact duplicate of last emission
  if (prev === contentStr) return true
  // First emission for a date with no stored plan — skip if empty handled by caller
  if (prev === undefined) return false
  // First divergence from stored content with no pending user edit — normalization
  const existing = lessonPlans.find((p) => p.date === date)
  if (existing && prev === JSON.stringify(existing.content)) return true
  return false
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
}

export function TeacherLessonCalendarTab({ classroom, onSidebarStateChange }: Props) {
  const router = useRouter()
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const lessonPlansRef = useRef(lessonPlans)
  lessonPlansRef.current = lessonPlans
  // Track the last content seen per date to suppress Tiptap normalization noise.
  // Populated from fetched plans and updated on each onChange call.
  const lastSeenContentRef = useRef<Map<string, string>>(new Map())
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
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
  const markdownContentRef = useRef('') // Ref to avoid stale closure in save handler
  const markdownSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Always fetch the full term - switching views is then instant
  const fetchRange = useMemo(() => {
    const start = classroom.start_date || format(startOfMonth(currentDate), 'yyyy-MM-dd')
    const end = classroom.end_date || format(endOfMonth(currentDate), 'yyyy-MM-dd')
    return { start, end }
  }, [classroom.start_date, classroom.end_date, currentDate])

  // Fetch all lesson plans for the term once
  useEffect(() => {
    async function loadLessonPlans() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/teacher/classrooms/${classroom.id}/lesson-plans?start=${fetchRange.start}&end=${fetchRange.end}`
        )
        const data = await res.json()
        const plans = data.lesson_plans || []
        // Seed last-seen content so Tiptap normalization doesn't trigger saves
        lastSeenContentRef.current.clear()
        for (const plan of plans) {
          lastSeenContentRef.current.set(plan.date, JSON.stringify(plan.content))
        }
        setLessonPlans(plans)
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

  // Fetch announcements for the classroom
  useEffect(() => {
    async function loadAnnouncements() {
      try {
        const res = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`)
        const data = await res.json()
        setAnnouncements(data.announcements || [])
      } catch (err) {
        console.error('Error loading announcements:', err)
      }
    }
    loadAnnouncements()
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
      if (loading) return
      const contentStr = JSON.stringify(content)
      if (isNormalizationNoise(lastSeenContentRef.current, lessonPlansRef.current, date, contentStr)) {
        // Record normalized version so future real edits are compared against it
        lastSeenContentRef.current.set(date, contentStr)
        return
      }
      if (!lastSeenContentRef.current.has(date) && isEmptyTiptapContent(content)) {
        lastSeenContentRef.current.set(date, contentStr)
        return
      }
      lastSeenContentRef.current.set(date, contentStr)
      pendingChangesRef.current.set(date, content)
      scheduleSave()
    },
    [loading, scheduleSave]
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
    setLoading(true)
    setMarkdownError(null)
    try {
      const start = classroom.start_date || fetchRange.start
      const end = classroom.end_date || fetchRange.end
      const res = await fetch(
        `/api/teacher/classrooms/${classroom.id}/lesson-plans?start=${start}&end=${end}`
      )
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Not authorized to view lesson plans')
        } else if (res.status === 404) {
          throw new Error('Classroom not found')
        } else {
          throw new Error(`Failed to load lesson plans (${res.status})`)
        }
      }
      const data = await res.json()
      const plans = data.lesson_plans || []
      const markdown = lessonPlansToMarkdown(classroom, plans, start, end)
      setMarkdownContent(markdown)
      markdownContentRef.current = markdown
      needsRefreshRef.current = false
    } catch (err) {
      console.error('Error loading lesson plans:', err)
      setMarkdownError(err instanceof Error ? err.message : 'Failed to load lesson plans')
    } finally {
      setLoading(false)
    }
  }, [classroom, fetchRange])

  // Handle markdown panel toggle - just toggle, effect handles loading
  const handleMarkdownToggle = useCallback(() => {
    toggleSidebar()
  }, [toggleSidebar])

  // Handle markdown content change - ref updates immediately, state updates debounced
  const handleMarkdownChange = useCallback((content: string) => {
    // Always update ref immediately so save has latest content
    markdownContentRef.current = content

    // Debounce state update to reduce parent re-renders
    if (markdownSyncTimeoutRef.current) {
      clearTimeout(markdownSyncTimeoutRef.current)
    }
    markdownSyncTimeoutRef.current = setTimeout(() => {
      setMarkdownContent(content)
    }, MARKDOWN_SYNC_DEBOUNCE_MS)
  }, [])

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
      // Use ref to get latest content (avoids stale closure)
      const result = markdownToLessonPlans(markdownContentRef.current, classroom)

      if (result.errors.length > 0) {
        setMarkdownError(result.errors.join('\n'))
        setBulkSaving(false)
        return
      }

      // If no plans with content, just close (nothing to save)
      if (result.plans.length === 0) {
        needsRefreshRef.current = true
        setSidebarOpen(false)
        setRefreshKey((k) => k + 1)
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
  }, [classroom, setSidebarOpen])

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
      router.push(`/classrooms/${classroom.id}?tab=assignments`)
    },
    [router, classroom.id]
  )

  // Handle announcement click - navigate to Resources > Announcements
  const handleAnnouncementClick = useCallback(() => {
    router.push(`/classrooms/${classroom.id}?tab=resources&section=announcements`)
  }, [router, classroom.id])

  // Notify parent when sidebar opens/closes, content changes, or error/saving state changes
  // Note: markdownContent IS included because the sidebar uses local state to avoid cursor jump.
  // TeacherLessonCalendarSidebar tracks isDirty and ignores external updates once user starts typing.
  useEffect(() => {
    if (isSidebarOpen) {
      onSidebarStateChange?.({
        markdownContent,
        markdownError,
        bulkSaving,
        onMarkdownChange: handleMarkdownChange,
        onSave: handleMarkdownSave,
      })
    } else {
      onSidebarStateChange?.(null)
    }
  }, [isSidebarOpen, markdownContent, markdownError, bulkSaving, onSidebarStateChange, handleMarkdownSave, handleMarkdownChange])

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
          assignments={assignments.filter((a) => !a.is_draft)}
          announcements={announcements}
          classDays={classDays}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={!classroom.archived_at}
          saving={saving}
          onDateChange={setCurrentDate}
          onViewModeChange={handleViewModeChange}
          onContentChange={handleContentChange}
          onAssignmentClick={handleAssignmentClick}
          onAnnouncementClick={handleAnnouncementClick}
          onMarkdownToggle={handleMarkdownToggle}
          isSidebarOpen={isSidebarOpen}
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
