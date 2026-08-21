'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addMonths, addWeeks, endOfMonth, format, startOfMonth, subMonths, subWeeks } from 'date-fns'
import { CalendarActionBar } from '@/components/CalendarActionBar'
import { CalendarSourceErrors, type CalendarSourceFailure } from '@/components/CalendarSourceErrors'
import { LessonCalendar, CalendarViewMode } from '@/components/LessonCalendar'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { useRightSidebar } from '@/components/layout'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { applyPendingLessonPlanChanges, lessonPlansToMarkdown, markdownToLessonPlans } from '@/lib/lesson-plan-markdown'
import { useClassDaysContext } from '@/hooks/useClassDays'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import type { Classroom, LessonPlan, Assignment, Announcement } from '@/types'
import { readCookie, writeCookie } from '@/lib/cookies'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT, TEACHER_ASSIGNMENTS_UPDATED_EVENT } from '@/lib/events'
import { normalizeLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { nowInToronto } from '@/lib/timezone'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import {
  fetchTeacherLessonPlansForRange,
  invalidateTeacherLessonPlansForClassroom,
} from '@/lib/teacher-lesson-plans-client'
import {
  allocateTeacherLessonPlanMutationVersion,
  enqueueTeacherLessonPlanMutation,
  type TeacherLessonPlanMutationVersion,
} from '@/lib/teacher-lesson-plan-mutation-queue'
import { Button, PageState, RefreshingIndicator } from '@/ui'

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
const AUTOSAVE_MAX_RETRIES = 3
const MARKDOWN_SYNC_DEBOUNCE_MS = 300

type PendingLessonSave = {
  classroomId: string
  content: string
  date: string
  editGeneration?: number
  retries: number
  saveEpoch: number
  mutation: TeacherLessonPlanMutationVersion
}

type PendingBulkLessonSave = {
  body: string
  classroomId: string
  mutation: TeacherLessonPlanMutationVersion
}

type MarkdownLessonDraft = {
  content: string
  revision: number
}

function pendingLessonSaveKey(classroomId: string, date: string): string {
  return `${classroomId}:${date}`
}

function lessonSaveMutationKey(save: PendingLessonSave): string {
  return `${save.mutation.client_id}:${save.mutation.sequence}`
}

function pendingLessonChangesForClassroom(
  pendingSaves: Map<string, PendingLessonSave>,
  classroomId: string,
): Map<string, string> {
  return new Map(
    Array.from(pendingSaves.values())
      .filter((save) => save.classroomId === classroomId)
      .map((save) => [save.date, save.content]),
  )
}

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

export interface CalendarSidebarState {
  markdownContent: string
  markdownError: string | null
  bulkSaving: boolean
  onMarkdownChange: (content: string) => void
  onSave: () => Promise<void>
}

interface Props {
  classroom: Classroom
  showClasswork?: boolean
  showAnnouncements?: boolean
  onSidebarStateChange?: (state: CalendarSidebarState | null) => void
  onNavigateToAssignments?: (assignmentId?: string | null) => void
  onNavigateToAnnouncements?: () => void
}

export function TeacherLessonCalendarTab({
  classroom,
  showClasswork = true,
  showAnnouncements = true,
  onSidebarStateChange,
  onNavigateToAssignments = () => {},
  onNavigateToAnnouncements = () => {},
}: Props) {
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [lessonPlansClassroomId, setLessonPlansClassroomId] = useState(classroom.id)
  // Track last-seen markdown per date to suppress duplicate autosave emissions.
  const lastSeenContentRef = useRef<Map<string, string>>(new Map())
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [assignmentsClassroomId, setAssignmentsClassroomId] = useState(classroom.id)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [announcementsClassroomId, setAnnouncementsClassroomId] = useState(classroom.id)
  const [sourceStatus, setSourceStatus] = useState(initialSourceStatus)
  const lessonPlansStatus = sourceStatus.lessonPlans
  const assignmentsStatus = sourceStatus.assignments
  const announcementsStatus = sourceStatus.announcements
  const visibleLessonPlans = lessonPlansClassroomId === classroom.id && lessonPlansStatus.hasLoadedSnapshot ? lessonPlans : []
  const visibleAssignments = assignmentsClassroomId === classroom.id && assignmentsStatus.hasLoadedSnapshot ? assignments : []
  const visibleAnnouncements = announcementsClassroomId === classroom.id && announcementsStatus.hasLoadedSnapshot ? announcements : []
  const lessonPlansRef = useRef(visibleLessonPlans)
  lessonPlansRef.current = visibleLessonPlans
  const lessonEditGenerationRef = useRef(0)
  const lessonEditsRef = useRef<Map<string, { acknowledged: boolean; content: string; generation: number }>>(new Map())
  const {
    classDays,
    error: classDaysError,
    hasLoadedSnapshot: hasClassDaysSnapshot,
    isLoading: classDaysLoading,
    refresh: refreshClassDays,
  } = useClassDaysContext()
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
  const [currentDate, setCurrentDate] = useState(nowInToronto)
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownContentClassroomId, setMarkdownContentClassroomId] = useState('')
  const visibleMarkdownContent = markdownContentClassroomId === classroom.id ? markdownContent : ''
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [failedSaveClassroomIds, setFailedSaveClassroomIds] = useState<Set<string>>(() => new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [assignmentsRefreshKey, setAssignmentsRefreshKey] = useState(0)
  const [announcementsRefreshKey, setAnnouncementsRefreshKey] = useState(0)
  const currentClassroomIdRef = useRef(classroom.id)
  const classroomEpochRef = useRef(0)
  const sourceRequestIdsRef = useRef<Record<CalendarSource, number>>({
    lessonPlans: 0,
    assignments: 0,
    announcements: 0,
  })
  const retryingSourcesRef = useRef<Set<CalendarRetrySource>>(new Set())
  const calendarWorkspaceRef = useRef<HTMLDivElement>(null)

  const { toggle: toggleSidebar, isOpen: isSidebarOpen, setOpen: setSidebarOpen } = useRightSidebar()
  const { showMarkdown } = useMarkdownPreference()

  useLayoutEffect(() => {
    classroomEpochRef.current += 1
    currentClassroomIdRef.current = classroom.id
    sourceRequestIdsRef.current.lessonPlans += 1
    sourceRequestIdsRef.current.assignments += 1
    sourceRequestIdsRef.current.announcements += 1
    lessonEditGenerationRef.current = 0
    lessonEditsRef.current.clear()
    retryingSourcesRef.current.clear()
    setBulkSaving(false)
    setSourceStatus(initialSourceStatus())
  }, [classroom.id])

  // Auto-save tracking
  const pendingSavesRef = useRef<Map<string, PendingLessonSave>>(new Map())
  const unsettledSavesRef = useRef<Map<string, PendingLessonSave>>(new Map())
  const pendingBulkSavesRef = useRef<Map<string, PendingBulkLessonSave>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const flushInFlightRef = useRef<Promise<void> | null>(null)
  const lastSaveAtRef = useRef<number>(0)
  const prevSidebarOpenRef = useRef(false)
  const needsRefreshRef = useRef(true) // Force refresh on first open or after save
  const markdownContentRef = useRef('') // Ref to avoid stale closure in save handler
  const markdownDraftsRef = useRef<Map<string, MarkdownLessonDraft>>(new Map())
  const markdownDraftRevisionRef = useRef(0)
  const markdownErrorsRef = useRef<Map<string, string>>(new Map())
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

    async function loadLessonPlans() {
      const acknowledgedEditsAtRequestStart = new Map<string, number>()
      for (const [date, edit] of lessonEditsRef.current) {
        if (edit.acknowledged) acknowledgedEditsAtRequestStart.set(date, edit.generation)
      }
      const requestId = sourceRequestIdsRef.current.lessonPlans + 1
      sourceRequestIdsRef.current.lessonPlans = requestId
      const isCurrentLoad = () => (
        !cancelled &&
        sourceRequestIdsRef.current.lessonPlans === requestId &&
        currentClassroomIdRef.current === requestedClassroomId
      )
      setLoading(true)
      setSourceStatus((current) => ({
        ...current,
        lessonPlans: {
          classroomId: requestedClassroomId,
          error: current.lessonPlans.classroomId === requestedClassroomId && current.lessonPlans.error,
          hasLoadedSnapshot: current.lessonPlans.classroomId === requestedClassroomId && current.lessonPlans.hasLoadedSnapshot,
          isLoading: true,
        },
      }))
      try {
        const plans = await fetchTeacherLessonPlansForRange(requestedClassroomId, fetchRange.start, fetchRange.end)
        if (!isCurrentLoad()) return
        const plansWithPending = applyPendingLessonPlanChanges(
          plans,
          pendingLessonChangesForClassroom(pendingSavesRef.current, requestedClassroomId),
          requestedClassroomId,
        )
        const editsToPreserve = new Map<string, string>()
        for (const [date, edit] of lessonEditsRef.current) {
          if (acknowledgedEditsAtRequestStart.get(date) !== edit.generation) {
            editsToPreserve.set(date, edit.content)
          }
        }
        const plansWithCurrentEdits = applyPendingLessonPlanChanges(plansWithPending, editsToPreserve, requestedClassroomId)
        // Seed last-seen content so Tiptap normalization doesn't trigger saves.
        // Local edits remain authoritative while a background refresh settles.
        lastSeenContentRef.current.clear()
        for (const plan of plansWithCurrentEdits) {
          lastSeenContentRef.current.set(plan.date, plan.content_markdown ?? '')
        }
        setLessonPlansClassroomId(requestedClassroomId)
        setLessonPlans(plansWithCurrentEdits)
        for (const [date, generation] of acknowledgedEditsAtRequestStart) {
          const currentEdit = lessonEditsRef.current.get(date)
          if (currentEdit?.generation === generation && currentEdit.acknowledged) {
            lessonEditsRef.current.delete(date)
          }
        }
        setSourceStatus((current) => ({
          ...current,
          lessonPlans: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
        }))
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading lesson plans:', err)
        setSourceStatus((current) => ({
          ...current,
          lessonPlans: { ...current.lessonPlans, classroomId: requestedClassroomId, error: true, isLoading: false },
        }))
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

    if (!showClasswork) {
      setAssignmentsClassroomId(requestedClassroomId)
      setAssignments([])
      setSourceStatus((current) => ({
        ...current,
        assignments: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
      }))
      return
    }

    async function loadAssignments() {
      const requestId = sourceRequestIdsRef.current.assignments + 1
      sourceRequestIdsRef.current.assignments = requestId
      const isCurrentLoad = () => (
        !cancelled &&
        sourceRequestIdsRef.current.assignments === requestId &&
        currentClassroomIdRef.current === requestedClassroomId
      )
      setSourceStatus((current) => ({
        ...current,
        assignments: {
          classroomId: requestedClassroomId,
          error: current.assignments.classroomId === requestedClassroomId && current.assignments.error,
          hasLoadedSnapshot: current.assignments.classroomId === requestedClassroomId && current.assignments.hasLoadedSnapshot,
          isLoading: true,
        },
      }))
      try {
        const data = await fetchCachedJSON<{ assignments?: Assignment[] }>(
          `teacher-assignments:${requestedClassroomId}`,
          `/api/teacher/assignments?classroom_id=${requestedClassroomId}`,
          { errorMessage: 'Failed to load assignments', ttlMs: 20_000 },
        )
        if (!isCurrentLoad()) return
        setAssignmentsClassroomId(requestedClassroomId)
        setAssignments(data.assignments || [])
        setSourceStatus((current) => ({
          ...current,
          assignments: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
        }))
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading assignments:', err)
        setSourceStatus((current) => ({
          ...current,
          assignments: { ...current.assignments, classroomId: requestedClassroomId, error: true, isLoading: false },
        }))
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
  }, [assignmentsRefreshKey, classroom.id, showClasswork])

  // Fetch announcements for the classroom
  useEffect(() => {
    let cancelled = false
    const requestedClassroomId = classroom.id

    if (!showAnnouncements) {
      setAnnouncementsClassroomId(requestedClassroomId)
      setAnnouncements([])
      setSourceStatus((current) => ({
        ...current,
        announcements: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
      }))
      return
    }

    async function loadAnnouncements() {
      const requestId = sourceRequestIdsRef.current.announcements + 1
      sourceRequestIdsRef.current.announcements = requestId
      const isCurrentLoad = () => (
        !cancelled &&
        sourceRequestIdsRef.current.announcements === requestId &&
        currentClassroomIdRef.current === requestedClassroomId
      )
      setSourceStatus((current) => ({
        ...current,
        announcements: {
          classroomId: requestedClassroomId,
          error: current.announcements.classroomId === requestedClassroomId && current.announcements.error,
          hasLoadedSnapshot: current.announcements.classroomId === requestedClassroomId && current.announcements.hasLoadedSnapshot,
          isLoading: true,
        },
      }))
      try {
        const data = await fetchCachedJSON<{ announcements?: Announcement[] }>(
          `teacher-announcements:${requestedClassroomId}`,
          `/api/teacher/classrooms/${requestedClassroomId}/announcements`,
          { errorMessage: 'Failed to load announcements', ttlMs: 20_000 },
        )
        if (!isCurrentLoad()) return
        setAnnouncementsClassroomId(requestedClassroomId)
        setAnnouncements(data.announcements || [])
        setSourceStatus((current) => ({
          ...current,
          announcements: { classroomId: requestedClassroomId, error: false, hasLoadedSnapshot: true, isLoading: false },
        }))
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading announcements:', err)
        setSourceStatus((current) => ({
          ...current,
          announcements: { ...current.announcements, classroomId: requestedClassroomId, error: true, isLoading: false },
        }))
      }
    }
    loadAnnouncements()

    return () => {
      cancelled = true
    }
  }, [announcementsRefreshKey, classroom.id, showAnnouncements])

  // Save a single lesson plan
  const saveLessonPlan = useCallback(
    async (
      requestedClassroomId: string,
      date: string,
      contentMarkdown: string,
      saveEpoch: number,
      editGeneration?: number,
      mutation?: TeacherLessonPlanMutationVersion,
      options?: { updateView?: boolean },
    ) => {
      const mutationVersion = mutation ?? allocateTeacherLessonPlanMutationVersion()
      return enqueueTeacherLessonPlanMutation(requestedClassroomId, async () => {
        const res = await fetch(`/api/teacher/classrooms/${requestedClassroomId}/lesson-plans/${date}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_markdown: contentMarkdown, mutation: mutationVersion }),
          keepalive: true,
        })
        if (!res.ok) {
          throw new Error(`Failed to save lesson plan (${res.status})`)
        }

        const data = await res.json()
        invalidateTeacherLessonPlansForClassroom(requestedClassroomId)
        if (options?.updateView === false || classroomEpochRef.current !== saveEpoch) return
        needsRefreshRef.current = true
        if (currentClassroomIdRef.current !== requestedClassroomId) return
        const currentEdit = lessonEditsRef.current.get(date)
        if (editGeneration !== undefined) {
          if (currentEdit?.generation !== editGeneration || currentEdit.content !== contentMarkdown) return
          currentEdit.acknowledged = true
        }
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
      })
    },
    []
  )

  // Flush pending saves
  const flushPendingSaves = useCallback(async () => {
    if (flushInFlightRef.current) return flushInFlightRef.current
    if (pendingSavesRef.current.size === 0) return

    const flush = async () => {
      setSaving(true)
      const entries = Array.from(pendingSavesRef.current.entries())
      for (const [key, entry] of entries) {
        pendingSavesRef.current.delete(key)
        unsettledSavesRef.current.set(lessonSaveMutationKey(entry), entry)
      }

      const touchedClassroomIds = new Set(entries.map(([, entry]) => entry.classroomId))
      await Promise.all(entries.map(async ([key, entry]) => {
        const { classroomId, content, date, editGeneration, mutation, retries, saveEpoch } = entry
        try {
          await saveLessonPlan(classroomId, date, content, saveEpoch, editGeneration, mutation)
        } catch (err) {
          console.error('Error saving lesson plan:', err)
          if (!pendingSavesRef.current.has(key)) {
            pendingSavesRef.current.set(key, { ...entry, retries: retries + 1 })
          }
        } finally {
          unsettledSavesRef.current.delete(lessonSaveMutationKey(entry))
        }
      }))
      setFailedSaveClassroomIds((current) => {
        const next = new Set(current)
        for (const classroomId of touchedClassroomIds) {
          const exhausted = Array.from(pendingSavesRef.current.values()).some((save) => (
            save.classroomId === classroomId && save.retries > AUTOSAVE_MAX_RETRIES
          ))
          if (exhausted) next.add(classroomId)
          else next.delete(classroomId)
        }
        return next
      })
      lastSaveAtRef.current = Date.now()
      setSaving(false)
    }

    const flushPromise = flush().finally(() => {
      flushInFlightRef.current = null
      const hasRetryableSave = Array.from(pendingSavesRef.current.values())
        .some((save) => save.retries <= AUTOSAVE_MAX_RETRIES)
      if (hasRetryableSave) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = setTimeout(() => {
          void flushPendingSaves()
        }, AUTOSAVE_MIN_INTERVAL_MS)
      }
    })
    flushInFlightRef.current = flushPromise
    return flushPromise
  }, [saveLessonPlan])

  // Schedule save with debounce and throttle
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    const timeSinceLastSave = Date.now() - lastSaveAtRef.current
    const delay = Math.max(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MIN_INTERVAL_MS - timeSinceLastSave)

    saveTimeoutRef.current = setTimeout(() => {
      void flushPendingSaves()
    }, delay)
  }, [flushPendingSaves])

  // Handle content change from calendar
  const handleContentChange = useCallback(
    (date: string, contentMarkdown: string) => {
      if (!lessonPlansStatus.hasLoadedSnapshot) return
      const contentStr = contentMarkdown
      if (isNormalizationNoise(lastSeenContentRef.current, lessonPlansRef.current, date, contentStr)) {
        lastSeenContentRef.current.set(date, contentStr)
        return
      }
      lastSeenContentRef.current.set(date, contentStr)
      lessonEditGenerationRef.current += 1
      lessonEditsRef.current.set(date, {
        acknowledged: false,
        content: contentMarkdown,
        generation: lessonEditGenerationRef.current,
      })
      applyLocalLessonPlanChange(date, contentMarkdown)
      pendingSavesRef.current.set(pendingLessonSaveKey(classroom.id, date), {
        classroomId: classroom.id,
        content: contentMarkdown,
        date,
        editGeneration: lessonEditGenerationRef.current,
        retries: 0,
        saveEpoch: classroomEpochRef.current,
        mutation: allocateTeacherLessonPlanMutationVersion(),
      })
      scheduleSave()
    },
    [applyLocalLessonPlanChange, classroom.id, lessonPlansStatus.hasLoadedSnapshot, scheduleSave]
  )

  // Flush on unmount and handle page close
  useEffect(() => {
    const handleBeforeUnload = () => {
      const unloadSaves = new Map<string, PendingLessonSave>(unsettledSavesRef.current)
      for (const save of pendingSavesRef.current.values()) {
        unloadSaves.set(lessonSaveMutationKey(save), save)
      }
      if (unloadSaves.size > 0) {
        for (const { classroomId, content, date, mutation } of unloadSaves.values()) {
          void fetch(`/api/teacher/classrooms/${classroomId}/lesson-plans/${date}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content_markdown: content, mutation }),
            keepalive: true,
          }).catch((err) => {
            console.error('Error saving lesson plan during page unload:', err)
          })
        }
      }
      for (const { body, classroomId } of pendingBulkSavesRef.current.values()) {
        void fetch(`/api/teacher/classrooms/${classroomId}/lesson-plans/bulk`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch((err) => {
          console.error('Error saving bulk lesson plans during page unload:', err)
        })
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    // Capture ref value for cleanup
    const pendingSaves = pendingSavesRef.current

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
      if (pendingSaves.size > 0) {
        void flushPendingSaves()
      }
    }
  }, [classroom.id, flushPendingSaves, saveLessonPlan])

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
      const plans = applyPendingLessonPlanChanges(
        cachedPlans,
        pendingLessonChangesForClassroom(pendingSavesRef.current, requestedClassroomId),
        requestedClassroomId,
      )
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
    const retainedDraft = markdownDraftsRef.current.get(classroom.id)
    const retainedError = markdownErrorsRef.current.get(classroom.id) ?? null
    markdownContentRef.current = retainedDraft?.content ?? ''
    setMarkdownContent(retainedDraft?.content ?? '')
    setMarkdownContentClassroomId(retainedDraft === undefined ? '' : classroom.id)
    setMarkdownError(retainedError)
    needsRefreshRef.current = true
    if (retainedDraft === undefined && showMarkdown && isSidebarOpen) {
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
    markdownDraftRevisionRef.current += 1
    markdownDraftsRef.current.set(classroom.id, {
      content,
      revision: markdownDraftRevisionRef.current,
    })
    markdownErrorsRef.current.delete(classroom.id)
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
    const requestedClassroomId = classroom.id
    const requestedClassroomEpoch = classroomEpochRef.current
    const markdownPayload = markdownContentRef.current
    const mutation = allocateTeacherLessonPlanMutationVersion()
    const bulkMutationKey = `${mutation.client_id}:${mutation.sequence}`
    markdownDraftRevisionRef.current += 1
    const draftRevision = markdownDraftRevisionRef.current
    const draftIsCurrent = () => (
      markdownDraftsRef.current.get(requestedClassroomId)?.revision === draftRevision
    )
    const isCurrentOperation = () => (
      currentClassroomIdRef.current === requestedClassroomId &&
      classroomEpochRef.current === requestedClassroomEpoch
    )
    setMarkdownError(null)
    markdownErrorsRef.current.delete(requestedClassroomId)
    if (markdownContentClassroomId !== classroom.id) {
      setMarkdownError('Lesson plans are still loading')
      return
    }
    markdownDraftsRef.current.set(requestedClassroomId, {
      content: markdownPayload,
      revision: draftRevision,
    })
    setBulkSaving(true)

    try {
      const result = markdownToLessonPlans(markdownPayload, classroom)

      if (result.errors.length > 0) {
        const error = result.errors.join('\n')
        if (draftIsCurrent()) {
          markdownErrorsRef.current.set(requestedClassroomId, error)
          if (isCurrentOperation()) setMarkdownError(error)
        }
        return
      }

      if (result.plans.length === 0 && result.clearedDates.length === 0) {
        if (draftIsCurrent()) {
          markdownDraftsRef.current.delete(requestedClassroomId)
          markdownErrorsRef.current.delete(requestedClassroomId)
        }
        invalidateTeacherLessonPlansForClassroom(requestedClassroomId)
        if (!isCurrentOperation()) return
        needsRefreshRef.current = true
        setSidebarOpen(false)
        setRefreshKey((k) => k + 1)
        return
      }

      const bulkBody = JSON.stringify({
        plans: result.plans,
        cleared_dates: result.clearedDates,
        mutation,
      })
      pendingBulkSavesRef.current.set(bulkMutationKey, {
        body: bulkBody,
        classroomId: requestedClassroomId,
        mutation,
      })

      await flushPendingSaves()
      const hasPendingInlineSave = Array.from(pendingSavesRef.current.values())
        .some((save) => save.classroomId === classroom.id)
      if (hasPendingInlineSave) {
        const error = 'Pending calendar edits could not be saved. Try again.'
        if (draftIsCurrent()) {
          markdownErrorsRef.current.set(requestedClassroomId, error)
          if (isCurrentOperation()) setMarkdownError(error)
        }
        return
      }
      const res = await enqueueTeacherLessonPlanMutation(classroom.id, () => (
        fetch(`/api/teacher/classrooms/${classroom.id}/lesson-plans/bulk`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: bulkBody,
          keepalive: true,
        })
      ))

      if (!res.ok) {
        const data = await res.json()
        const error = data.error || 'Failed to save'
        if (draftIsCurrent()) {
          markdownErrorsRef.current.set(requestedClassroomId, error)
          if (isCurrentOperation()) setMarkdownError(error)
        }
        return
      }

      if (draftIsCurrent()) {
        markdownDraftsRef.current.delete(requestedClassroomId)
        markdownErrorsRef.current.delete(requestedClassroomId)
      }
      for (const [key, pending] of pendingBulkSavesRef.current) {
        if (
          pending.classroomId === requestedClassroomId &&
          pending.mutation.client_id === mutation.client_id &&
          pending.mutation.sequence <= mutation.sequence
        ) {
          pendingBulkSavesRef.current.delete(key)
        }
      }
      invalidateTeacherLessonPlansForClassroom(requestedClassroomId)
      if (!isCurrentOperation()) return
      needsRefreshRef.current = true // Force refresh on next sidebar open
      setSidebarOpen(false)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Error saving markdown:', err)
      const error = 'Failed to save lesson plans'
      if (draftIsCurrent()) {
        markdownErrorsRef.current.set(requestedClassroomId, error)
        if (isCurrentOperation()) setMarkdownError(error)
      }
    } finally {
      if (isCurrentOperation()) setBulkSaving(false)
    }
  }, [classroom, flushPendingSaves, markdownContentClassroomId, setSidebarOpen])

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
    setCurrentDate(nowInToronto())
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

  const retryLessonPlans = useCallback(() => {
    retryingSourcesRef.current.add('lessonPlans')
    invalidateTeacherLessonPlansForClassroom(classroom.id)
    setRefreshKey((key) => key + 1)
  }, [classroom.id])

  const retryAssignments = useCallback(() => {
    retryingSourcesRef.current.add('assignments')
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    setAssignmentsRefreshKey((key) => key + 1)
  }, [classroom.id])

  const retryAnnouncements = useCallback(() => {
    retryingSourcesRef.current.add('announcements')
    invalidateCachedJSON(`teacher-announcements:${classroom.id}`)
    setAnnouncementsRefreshKey((key) => key + 1)
  }, [classroom.id])

  const retryClassDays = useCallback(() => {
    retryingSourcesRef.current.add('classDays')
    void refreshClassDays()
  }, [refreshClassDays])

  const retryFailedSaves = useCallback(() => {
    for (const [key, save] of pendingSavesRef.current) {
      if (save.classroomId === classroom.id) {
        pendingSavesRef.current.set(key, { ...save, retries: 0 })
      }
    }
    setFailedSaveClassroomIds((current) => {
      const next = new Set(current)
      next.delete(classroom.id)
      return next
    })
    void flushPendingSaves()
  }, [classroom.id, flushPendingSaves])

  const localStatuses = [lessonPlansStatus, assignmentsStatus, announcementsStatus]
  const hasAnyLocalSnapshot = localStatuses.some((status) => (
    status.classroomId === classroom.id && status.hasLoadedSnapshot
  ))
  const hasAnySnapshot = hasAnyLocalSnapshot || hasClassDaysSnapshot
  const haveLocalSourcesInitialized = localStatuses.every((status) => status.classroomId === classroom.id)
  const isInitialLoading = !haveLocalSourcesInitialized || (
    !hasAnyLocalSnapshot && localStatuses.some((status) => status.isLoading)
  )
  const isRefreshing = loading || localStatuses.some((status) => status.isLoading) || classDaysLoading

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
  const saveFailures: CalendarSourceFailure[] = failedSaveClassroomIds.has(classroom.id)
    ? [{ id: 'lesson-plan-saves', label: 'lesson plan changes', isRetrying: saving, onRetry: retryFailedSaves }]
    : []
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
        <div ref={calendarWorkspaceRef} role="region" aria-label="Calendar workspace" tabIndex={-1} className="outline-none">
          {isRefreshing ? <RefreshingIndicator label="Refreshing calendar" className="mb-2" /> : null}
          <CalendarSourceErrors failures={failures} />
          <CalendarSourceErrors
            failures={saveFailures}
            message="Some lesson plan changes could not be saved."
          />
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
