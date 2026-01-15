'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth } from 'date-fns'
import { FileText } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { getOntarioHolidays } from '@/lib/calendar'
import { useRightSidebar } from '@/components/layout'
import { lessonPlansToMarkdown, markdownToLessonPlans } from '@/lib/lesson-plan-markdown'
import type { Classroom, LessonPlan, TiptapContent } from '@/types'

const AUTOSAVE_DEBOUNCE_MS = 3000
const AUTOSAVE_MIN_INTERVAL_MS = 10000

interface Props {
  classroom: Classroom
}

export function TeacherLessonCalendarTab({ classroom }: Props) {
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [allLessonPlans, setAllLessonPlans] = useState<LessonPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)

  const { toggle: toggleSidebar, isOpen: isSidebarOpen, setOpen: setSidebarOpen } = useRightSidebar()

  // Auto-save tracking
  const pendingChangesRef = useRef<Map<string, TiptapContent>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAtRef = useRef<number>(0)

  // Calculate date range for fetching
  const dateRange = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 })
      const end = endOfWeek(currentDate, { weekStartsOn: 0 })
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    }
    if (viewMode === 'month') {
      const start = startOfMonth(currentDate)
      const end = endOfMonth(currentDate)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    }
    // 'all' mode: use classroom term dates or default to wide range
    const start = classroom.start_date || '2020-01-01'
    const end = classroom.end_date || '2030-12-31'
    return { start, end }
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  // Holidays for the current view range
  const holidays = useMemo(() => {
    const startDate = new Date(dateRange.start)
    const endDate = new Date(dateRange.end)
    const holidayList = getOntarioHolidays(startDate, endDate)
    return new Set(holidayList)
  }, [dateRange])

  // Fetch lesson plans when date range changes
  useEffect(() => {
    async function loadLessonPlans() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/teacher/classrooms/${classroom.id}/lesson-plans?start=${dateRange.start}&end=${dateRange.end}`
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
  }, [classroom.id, dateRange.start, dateRange.end])

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

  // Handle copy
  const handleCopy = useCallback((fromDate: string) => {
    // TODO: Implement copy modal
    console.log('Copy from:', fromDate)
  }, [])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Handle markdown panel toggle
  const handleMarkdownToggle = useCallback(async () => {
    if (!isSidebarOpen) {
      // Opening: generate markdown from all term lesson plans
      setLoading(true)
      setMarkdownError(null)
      try {
        // Fetch all lesson plans for the term
        const start = classroom.start_date || dateRange.start
        const end = classroom.end_date || dateRange.end
        const res = await fetch(
          `/api/teacher/classrooms/${classroom.id}/lesson-plans?start=${start}&end=${end}`
        )
        const data = await res.json()
        const plans = data.lesson_plans || []
        setAllLessonPlans(plans)

        // Generate markdown
        const markdown = lessonPlansToMarkdown(classroom, plans, start, end)
        setMarkdownContent(markdown)
      } catch (err) {
        console.error('Error generating markdown:', err)
        setMarkdownError('Failed to load lesson plans')
      } finally {
        setLoading(false)
      }
    }
    toggleSidebar()
  }, [isSidebarOpen, toggleSidebar, classroom, dateRange])

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

      // Success - close panel and refresh
      setSidebarOpen(false)
      // Trigger re-fetch
      setCurrentDate(new Date(currentDate))
    } catch (err) {
      console.error('Error saving markdown:', err)
      setMarkdownError('Failed to save lesson plans')
    } finally {
      setBulkSaving(false)
    }
  }, [markdownContent, classroom, setSidebarOpen, currentDate])

  // Handle copy to clipboard
  const handleCopyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(markdownContent)
  }, [markdownContent])

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
      <PageActionBar
        primary={
          <div className="flex items-center gap-2">
            {saving && <span className="text-sm text-gray-500">Saving...</span>}
          </div>
        }
        trailing={
          <button
            onClick={handleMarkdownToggle}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <FileText className="w-4 h-4" />
            Edit as Markdown
          </button>
        }
      />
      <PageContent>
        <LessonCalendar
          classroom={classroom}
          lessonPlans={lessonPlans}
          viewMode={viewMode}
          currentDate={currentDate}
          editable={!classroom.archived_at}
          onDateChange={setCurrentDate}
          onViewModeChange={setViewMode}
          onContentChange={handleContentChange}
          onCopy={handleCopy}
          holidays={holidays}
        />
      </PageContent>
    </PageLayout>
  )
}

// Sidebar content component - rendered via page.tsx
export function TeacherLessonCalendarSidebar({
  markdownContent,
  markdownError,
  bulkSaving,
  onMarkdownChange,
  onSave,
  onCopyToClipboard,
}: {
  markdownContent: string
  markdownError: string | null
  bulkSaving: boolean
  onMarkdownChange: (content: string) => void
  onSave: () => void
  onCopyToClipboard: () => void
}) {
  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Lesson Plans (Markdown)
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onCopyToClipboard}
            className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Copy
          </button>
          <button
            onClick={onSave}
            disabled={bulkSaving}
            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {bulkSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {markdownError && (
        <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-900/30 text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">
          {markdownError}
        </div>
      )}

      <textarea
        value={markdownContent}
        onChange={(e) => onMarkdownChange(e.target.value)}
        className="flex-1 w-full p-3 font-mono text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-none"
        placeholder="Loading..."
      />
    </div>
  )
}
