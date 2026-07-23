'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ClockAlert, LogOut, Maximize } from 'lucide-react'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { Spinner } from '@/components/Spinner'
import { PageContent, PageLayout, PageStack } from '@/components/PageLayout'
import { TestTextDocumentViewer } from '@/components/TestTextDocumentViewer'
import {
  getTestExitCount,
  getTestStatusBadgeClass,
  TEST_EXIT_BURST_WINDOW_MS,
} from '@/lib/tests'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import { StudentTestForm } from '@/components/StudentTestForm'
import { StudentTestResults } from '@/components/StudentTestResults'
import { Button, ConfirmDialog, EmptyState, PageState } from '@/ui'
import { readTestFromPayload, readTestsFromPayload } from '@/lib/test-api-contract'
import {
  STUDENT_TEST_EXAM_MODE_CHANGE_EVENT,
  STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT,
} from '@/lib/events'
import { normalizeTestDocuments } from '@/lib/test-documents'
import type {
  Classroom,
  TestAssessmentType,
  TestFocusSummary,
  TestAssessmentQuestion,
  StudentTestStatus,
  StudentTestView,
  TestResponseDraftValue,
} from '@/types'

interface Props {
  classroom: Classroom
  assessmentType: TestAssessmentType
  isActive?: boolean
}

interface RouteExitAttemptDetail {
  classroomId?: string
  source?: string
  metadata?: Record<string, unknown> | null
  dedupe?: boolean
}

interface AllowedDocItem {
  id: string
  title: string
  source: 'link' | 'upload' | 'text'
  url?: string
  content?: string
}

interface RemoteClosureNotice {
  title: string
  description: string
}

interface StudentTestSessionStatusSummary {
  id: string
  status: 'draft' | 'active' | 'closed'
  assessment_type: 'test'
  student_status: StudentTestStatus
  returned_at: string | null
}

interface StudentTestSessionStatusResponse {
  test?: StudentTestSessionStatusSummary
  quiz?: StudentTestSessionStatusSummary
  student_status: StudentTestStatus
  returned_at: string | null
  can_continue: boolean
  message: string | null
}

interface StudentTestListResponse {
  tests?: StudentTestView[]
  /** Legacy compatibility key emitted during the Tests contract transition. */
  quizzes?: StudentTestView[]
}

interface StudentTestDetailResponse {
  test?: StudentTestView
  /** Legacy compatibility key emitted during the Tests contract transition. */
  quiz?: StudentTestView
  questions?: TestAssessmentQuestion[]
  student_responses?: Record<string, number | TestResponseDraftValue>
  student_status?: StudentTestStatus
  focus_summary?: TestFocusSummary | null
}

type FullscreenCapableElement = HTMLElement & {
  requestFullscreen?: () => Promise<void>
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  if (safe < 60) return `${safe}s`
  if (safe < 3600) return `${Math.floor(safe / 60)}m`
  return `${Math.floor(safe / 3600)}h`
}

function createFocusSessionId(): string {
  return `focus_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function formatPointsTotal(points: number): string {
  const rounded = Math.round(points * 100) / 100
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  const unit = Math.abs(rounded) === 1 ? 'pt' : 'pts'
  return `${formatted} ${unit} total`
}

function formatTestOverviewLabel(questions: TestAssessmentQuestion[]): string {
  const questionCount = questions.length
  const totalPoints = questions.reduce((sum, question) => {
    const points = Number(question.points ?? 0)
    return Number.isFinite(points) ? sum + points : sum
  }, 0)
  const questionLabel = `${questionCount} question${questionCount === 1 ? '' : 's'}`
  return `${questionLabel} · ${formatPointsTotal(totalPoints)}`
}

function isFullscreenActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement)
}

function isFullscreenApiSupported(): boolean {
  if (typeof document === 'undefined') return false
  const fullscreenElement = document.documentElement as FullscreenCapableElement
  return typeof fullscreenElement?.requestFullscreen === 'function'
}

function isMobileBrowserWithoutFullscreen(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (isFullscreenApiSupported()) return false

  const maxTouchPoints = window.navigator?.maxTouchPoints ?? 0
  const hasCoarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const hasTouchInput = maxTouchPoints > 0 || hasCoarsePointer
  const compactViewport = Math.min(window.innerWidth, window.innerHeight) <= 1024

  return hasTouchInput && compactViewport
}

const EXAM_WINDOW_COMPLIANCE_GRACE_MS = 400
const EXAM_WINDOW_MIN_WIDTH_RATIO = 0.92
const EXAM_WINDOW_MIN_HEIGHT_RATIO = 0.88
const EXAM_LOCK_OVERLAY_ENABLED = true
const EXAM_FORM_INTERACTION_RESIZE_SUPPRESSION_MS = 1500
const DOCS_EXIT_SUPPRESSION_WINDOW_MS = 1200
const UNSUPPRESSED_ROUTE_EXIT_SOURCES = new Set([
  'tab_navigation',
  'home_navigation',
  'classroom_switch',
])

type ExamWindowComplianceSnapshot = {
  isFullscreen: boolean
  isCompliant: boolean
  widthRatio: number
  heightRatio: number
  innerWidth: number
  innerHeight: number
  availWidth: number
  availHeight: number
}

function getExamWindowComplianceSnapshot(): ExamWindowComplianceSnapshot {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      isFullscreen: false,
      isCompliant: true,
      widthRatio: 1,
      heightRatio: 1,
      innerWidth: 0,
      innerHeight: 0,
      availWidth: 0,
      availHeight: 0,
    }
  }

  const isFullscreen = isFullscreenActive()
  const innerWidth = window.innerWidth
  const innerHeight = window.innerHeight
  const availWidth = window.screen?.availWidth || innerWidth
  const availHeight = window.screen?.availHeight || innerHeight
  const widthRatio = availWidth > 0 ? innerWidth / availWidth : 1
  const heightRatio = availHeight > 0 ? innerHeight / availHeight : 1
  const mobileFullscreenFallback = isMobileBrowserWithoutFullscreen()

  return {
    isFullscreen,
    isCompliant:
      isFullscreen ||
      mobileFullscreenFallback ||
      (widthRatio >= EXAM_WINDOW_MIN_WIDTH_RATIO && heightRatio >= EXAM_WINDOW_MIN_HEIGHT_RATIO),
    widthRatio,
    heightRatio,
    innerWidth,
    innerHeight,
    availWidth,
    availHeight,
  }
}

function extractAllowedDocLinks(questions: TestAssessmentQuestion[]): AllowedDocItem[] {
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const plainUrlPattern = /\bhttps?:\/\/[^\s)]+/g
  const linksByUrl = new Map<string, AllowedDocItem>()

  for (const question of questions) {
    const text = question.question_text || ''

    for (const match of text.matchAll(markdownLinkPattern)) {
      const title = (match[1] || '').trim()
      const url = (match[2] || '').trim()
      if (!url || linksByUrl.has(url)) continue
      linksByUrl.set(url, { id: url, title: title || url, source: 'link', url })
    }

    for (const match of text.matchAll(plainUrlPattern)) {
      const url = (match[0] || '').trim()
      if (!url || linksByUrl.has(url)) continue
      linksByUrl.set(url, { id: url, title: url, source: 'link', url })
    }
  }

  return Array.from(linksByUrl.values())
}

function getRemoteClosureDescription(
  studentStatus: StudentTestStatus | 'unavailable',
  message?: string | null
): string {
  if (message?.trim()) return message
  if (studentStatus === 'can_view_results') {
    return 'Your current work has been submitted. Results are now available from the tests list.'
  }
  if (studentStatus === 'responded') {
    return 'Your current work has been submitted.'
  }
  return 'This test is no longer available.'
}

export function StudentTestsTab({ classroom, isActive = true }: Props) {
  const notifications = useStudentNotifications()
  const [tests, setTests] = useState<StudentTestView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedTestsScope, setLoadedTestsScope] = useState<string | null>(null)
  const [listErrorState, setListErrorState] = useState<{ scope: string; message: string } | null>(null)
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [focusSummary, setFocusSummary] = useState<TestFocusSummary | null>(null)
  const [selectedTest, setSelectedTest] = useState<{
    test: StudentTestView
    questions: TestAssessmentQuestion[]
    studentResponses: Record<string, number | TestResponseDraftValue>
  } | null>(null)
  const [startedTestId, setStartedTestId] = useState<string | null>(null)
  const [loadingTest, setLoadingTest] = useState(false)
  const [showStartTestConfirm, setShowStartTestConfirm] = useState(false)
  const [pendingStartTestId, setPendingStartTestId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isWindowCompliantNow, setIsWindowCompliantNow] = useState(true)
  const [isWindowCompliantStable, setIsWindowCompliantStable] = useState(true)
  const [activeDoc, setActiveDoc] = useState<AllowedDocItem | null>(null)
  const [remoteClosureNotice, setRemoteClosureNotice] = useState<RemoteClosureNotice | null>(null)
  const selectedTestIdRef = useRef<string | null>(null)
  const focusSessionIdRef = useRef<string | null>(null)
  const awayStartedAtRef = useRef<number | null>(null)
  const focusEnabledRef = useRef(false)
  const fullscreenActiveRef = useRef(false)
  const isWindowCompliantStableRef = useRef(true)
  const pendingNonCompliantTimeoutRef = useRef<number | null>(null)
  const pendingNonCompliantSourceRef = useRef<'fullscreen_exit' | 'window_resize' | null>(null)
  const lastRouteExitRef = useRef<{ source: string; loggedAtMs: number } | null>(null)
  const lastWindowSignalRef = useRef<{ source: string; loggedAtMs: number } | null>(null)
  const lastExamFormInteractionAtRef = useRef(0)
  const findIntentUntilRef = useRef(0)
  const findSuppressionUntilRef = useRef(0)
  const docsInteractionSuppressionUntilRef = useRef(0)
  const sessionStatusInFlightRef = useRef(false)
  const listRequestIdRef = useRef(0)
  const detailRequestIdRef = useRef(0)
  const testsRegionRef = useRef<HTMLDivElement>(null)
  const assessmentType: TestAssessmentType = 'test'
  const currentScopeRef = useRef({ classroomId: classroom.id, assessmentType })
  const isTestsView = true
  const apiBasePath = '/api/student/tests'
  const currentTestsScope = `${assessmentType}:${classroom.id}`
  const hasCurrentTestsSnapshot = loadedTestsScope === currentTestsScope
  const visibleTests = hasCurrentTestsSnapshot ? tests : []
  const listError = listErrorState?.scope === currentTestsScope ? listErrorState.message : null
  currentScopeRef.current = { classroomId: classroom.id, assessmentType }
  const focusEnabled = useMemo(() => {
    if (!selectedTest) return false
    const hasSubmitted = selectedTest.test.student_status !== 'not_started'
    const hasStarted = startedTestId === selectedTest.test.id
    return isTestsView && isActive && !hasSubmitted && hasStarted
  }, [isActive, isTestsView, selectedTest, startedTestId])
  const allowedDocs = useMemo(() => {
    const teacherManagedDocs = normalizeTestDocuments(selectedTest?.test?.documents).map((doc) => {
      const snapshotUrl =
        doc.source === 'link' && selectedTest?.test?.id && doc.snapshot_path
          ? `/api/student/tests/${selectedTest.test.id}/documents/${doc.id}/snapshot`
          : undefined

      return {
        id: doc.id,
        title: doc.title,
        source: doc.source,
        url: doc.source === 'link' ? snapshotUrl : doc.url,
        content: doc.content,
      }
    })
    if (teacherManagedDocs.length > 0) return teacherManagedDocs
    return extractAllowedDocLinks(selectedTest?.questions || [])
  }, [selectedTest?.questions, selectedTest?.test?.documents, selectedTest?.test?.id])

  useEffect(() => {
    if (!isTestsView) return
    setActiveDoc((previous) => {
      if (!previous) return null
      return allowedDocs.some((doc) => doc.id === previous.id) ? previous : null
    })
  }, [allowedDocs, isTestsView])

  useEffect(() => {
    selectedTestIdRef.current = selectedTestId
  }, [selectedTestId])

  useEffect(() => {
    isWindowCompliantStableRef.current = isWindowCompliantStable
  }, [isWindowCompliantStable])

  const clearPendingNonCompliantTimeout = useCallback(() => {
    if (pendingNonCompliantTimeoutRef.current !== null) {
      window.clearTimeout(pendingNonCompliantTimeoutRef.current)
      pendingNonCompliantTimeoutRef.current = null
    }
    pendingNonCompliantSourceRef.current = null
  }, [])

  useEffect(() => {
    focusEnabledRef.current = focusEnabled
    if (!focusEnabled) {
      clearPendingNonCompliantTimeout()
      lastRouteExitRef.current = null
      lastWindowSignalRef.current = null
      lastExamFormInteractionAtRef.current = 0
      findIntentUntilRef.current = 0
      findSuppressionUntilRef.current = 0
      docsInteractionSuppressionUntilRef.current = 0
    }
  }, [clearPendingNonCompliantTimeout, focusEnabled])

  useEffect(() => {
    const snapshot = getExamWindowComplianceSnapshot()
    fullscreenActiveRef.current = snapshot.isFullscreen
    setIsFullscreen(snapshot.isFullscreen)
    setIsWindowCompliantNow(snapshot.isCompliant)
    setIsWindowCompliantStable(snapshot.isCompliant)
  }, [])

  useEffect(() => {
    return () => {
      clearPendingNonCompliantTimeout()
    }
  }, [clearPendingNonCompliantTimeout])

  const loadTests = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    const classroomId = classroom.id
    const viewAssessmentType = assessmentType
    const basePath = apiBasePath
    const requestScope = `${viewAssessmentType}:${classroomId}`
    const cacheKey = `student-assessments:${viewAssessmentType}:${classroomId}`
    const requestId = listRequestIdRef.current + 1
    listRequestIdRef.current = requestId
    if (options.forceRefresh) {
      invalidateCachedJSON(cacheKey)
    }
    setLoading(true)
    setListErrorState((current) => current?.scope === requestScope ? null : current)
    try {
      const query = new URLSearchParams({ classroom_id: classroomId })
      const data = await fetchJSONWithCache<StudentTestListResponse>(
        cacheKey,
        async () => {
          const res = await fetch(`${basePath}?${query.toString()}`)
          const payload = await res.json().catch(() => null) as StudentTestListResponse & { error?: string } | null
          if (!res.ok) {
            throw new Error(payload?.error || 'Failed to load tests')
          }
          return payload ?? {}
        },
        0,
      )
      if (
        listRequestIdRef.current !== requestId ||
        currentScopeRef.current.classroomId !== classroomId ||
        currentScopeRef.current.assessmentType !== viewAssessmentType
      ) {
        return
      }
      setTests(readTestsFromPayload(data))
      setLoadedTestsScope(requestScope)
      setListErrorState(null)
    } catch (err) {
      if (
        listRequestIdRef.current === requestId &&
        currentScopeRef.current.classroomId === classroomId &&
        currentScopeRef.current.assessmentType === viewAssessmentType
      ) {
        console.error('Error loading tests:', err)
        setListErrorState({
          scope: requestScope,
          message: err instanceof Error ? err.message : 'Failed to load tests',
        })
      }
    } finally {
      if (
        listRequestIdRef.current === requestId &&
        currentScopeRef.current.classroomId === classroomId &&
        currentScopeRef.current.assessmentType === viewAssessmentType
      ) {
        setLoading(false)
      }
    }
  }, [apiBasePath, assessmentType, classroom.id])

  const retryTests = useCallback(() => {
    testsRegionRef.current?.focus()
    void loadTests({ forceRefresh: true })
  }, [loadTests])

  useEffect(() => {
    loadTests()
  }, [loadTests])

  useEffect(() => {
    detailRequestIdRef.current += 1
    selectedTestIdRef.current = null
    setSelectedTestId(null)
    setSelectedTest(null)
    setFocusSummary(null)
    setStartedTestId(null)
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
    setActiveDoc(null)
    setRemoteClosureNotice(null)
  }, [assessmentType, classroom.id])

  const handleRemoteTestClosure = useCallback((options?: {
    studentStatus?: StudentTestStatus
    message?: string | null
  }) => {
    clearPendingNonCompliantTimeout()
    const nextStudentStatus = options?.studentStatus ?? 'responded'
    setSelectedTest((current) => {
      if (!current) return current
      return {
        ...current,
        test: {
          ...current.test,
          status: 'closed',
          student_status: nextStudentStatus,
        },
      }
    })
    setStartedTestId(null)
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
    setActiveDoc(null)
    setRemoteClosureNotice({
      title: 'This test is closed.',
      description: getRemoteClosureDescription(nextStudentStatus, options?.message),
    })
    focusSessionIdRef.current = null
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
  }, [clearPendingNonCompliantTimeout])

  async function handleSelectTest(testId: string) {
    const classroomId = classroom.id
    const viewAssessmentType = assessmentType
    const basePath = apiBasePath
    const requestId = detailRequestIdRef.current + 1
    detailRequestIdRef.current = requestId
    selectedTestIdRef.current = testId
    setSelectedTestId(testId)
    setLoadingTest(true)
    setActiveDoc(null)
    setRemoteClosureNotice(null)
    focusSessionIdRef.current = createFocusSessionId()
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
    findIntentUntilRef.current = 0
    findSuppressionUntilRef.current = 0
    docsInteractionSuppressionUntilRef.current = 0

    try {
      // Bypass fetchJSONWithCache for selected detail freshness; request ids guard stale responses.
      const res = await fetch(`${basePath}/${testId}`)
      const data = await res.json() as StudentTestDetailResponse
      if (
        detailRequestIdRef.current !== requestId ||
        selectedTestIdRef.current !== testId ||
        currentScopeRef.current.classroomId !== classroomId ||
        currentScopeRef.current.assessmentType !== viewAssessmentType
      ) {
        return
      }
      const responseTest = readTestFromPayload<StudentTestView>(data)
      const listTest = tests.find((test) => test.id === testId)
      const nextTest = responseTest ?? listTest
      if (!nextTest) throw new Error('Test not found')
      const studentStatus = data.student_status ?? responseTest?.student_status ?? listTest?.student_status ?? 'not_started'
      setSelectedTest({
        test: { ...nextTest, student_status: studentStatus },
        questions: data.questions || [],
        studentResponses: data.student_responses || {},
      })
      setFocusSummary((data.focus_summary as TestFocusSummary | null) || null)
    } catch (err) {
      if (
        detailRequestIdRef.current === requestId &&
        selectedTestIdRef.current === testId &&
        currentScopeRef.current.classroomId === classroomId &&
        currentScopeRef.current.assessmentType === viewAssessmentType
      ) {
        console.error('Error loading test:', err)
      }
    } finally {
      if (
        detailRequestIdRef.current === requestId &&
        selectedTestIdRef.current === testId &&
        currentScopeRef.current.classroomId === classroomId &&
        currentScopeRef.current.assessmentType === viewAssessmentType
      ) {
        setLoadingTest(false)
      }
    }
  }

  const revalidateActiveTestSession = useCallback(async () => {
    if (!isTestsView || !focusEnabledRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

    const testId = selectedTestIdRef.current
    if (!testId || sessionStatusInFlightRef.current) return

    sessionStatusInFlightRef.current = true
    try {
      // Bypass fetchJSONWithCache for active exam session freshness.
      const res = await fetch(`${apiBasePath}/${testId}/session-status`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))

      if (selectedTestIdRef.current !== testId) return

      if (res.status === 404) {
        handleRemoteTestClosure({ message: 'This test is no longer available.' })
        return
      }

      if (!res.ok) {
        console.error('Error checking student test session status:', data?.error || res.status)
        return
      }

      const sessionStatus = data as StudentTestSessionStatusResponse
      if (sessionStatus.can_continue) return

      handleRemoteTestClosure({
        studentStatus: sessionStatus.student_status,
        message: sessionStatus.message,
      })
    } catch (err) {
      console.error('Error checking student test session status:', err)
    } finally {
      sessionStatusInFlightRef.current = false
    }
  }, [apiBasePath, handleRemoteTestClosure, isTestsView])

  const postFocusEvent = useCallback(async (
    eventType: 'away_start' | 'away_end' | 'route_exit_attempt' | 'window_unmaximize_attempt',
    metadata?: Record<string, unknown>,
    options?: {
      testId?: string | null
      sessionId?: string | null
      updateSummary?: boolean
    }
  ) => {
    const testId = options?.testId ?? selectedTestIdRef.current
    const sessionId = options?.sessionId ?? focusSessionIdRef.current

    if (!testId || !sessionId) return

    try {
      const res = await fetch(`${apiBasePath}/${testId}/focus-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: eventType,
          session_id: sessionId,
          metadata: metadata || null,
        }),
        keepalive: true,
      })

      if (options?.updateSummary === false) return

      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.focus_summary) {
        setFocusSummary(data.focus_summary as TestFocusSummary)
      }
    } catch (err) {
      console.error('Error posting test focus event:', err)
    }
  }, [apiBasePath])

  const shouldSuppressForBrowserFind = useCallback(() => {
    const now = Date.now()
    if (now <= findSuppressionUntilRef.current) {
      return true
    }
    if (now <= findIntentUntilRef.current) {
      findIntentUntilRef.current = 0
      findSuppressionUntilRef.current = now + 500
      return true
    }
    return false
  }, [])

  const markAllowedDocInteraction = useCallback(() => {
    if (!focusEnabledRef.current || !isTestsView) return
    docsInteractionSuppressionUntilRef.current = Date.now() + DOCS_EXIT_SUPPRESSION_WINDOW_MS
  }, [isTestsView])

  const markExamFormInteraction = useCallback(() => {
    if (!focusEnabledRef.current || !isTestsView) return
    lastExamFormInteractionAtRef.current = Date.now()
  }, [isTestsView])

  const shouldSuppressForDocInteraction = useCallback((source?: string) => {
    if (!focusEnabledRef.current || !isTestsView) return false
    if (source && UNSUPPRESSED_ROUTE_EXIT_SOURCES.has(source)) return false
    return Date.now() <= docsInteractionSuppressionUntilRef.current
  }, [isTestsView])

  const handleTextDocPointerUp = useCallback(() => {
    const selectedText = window.getSelection?.()?.toString().trim()
    if (selectedText) {
      markAllowedDocInteraction()
    }
  }, [markAllowedDocInteraction])

  const logRouteExitAttempt = useCallback((
    source: string,
    metadata?: Record<string, unknown>,
    options?: {
      dedupe?: boolean
      updateSummary?: boolean
    }
  ) => {
    if (shouldSuppressForDocInteraction(source)) {
      return
    }
    const now = Date.now()
    if (
      options?.dedupe &&
      lastRouteExitRef.current &&
      lastRouteExitRef.current.source === source &&
      now - lastRouteExitRef.current.loggedAtMs < 1200
    ) {
      return
    }
    lastRouteExitRef.current = { source, loggedAtMs: now }
    void postFocusEvent(
      'route_exit_attempt',
      {
        source,
        ...(metadata || {}),
      },
      { updateSummary: options?.updateSummary }
    )
  }, [postFocusEvent, shouldSuppressForDocInteraction])

  const logWindowUnmaximizeAttempt = useCallback((
    source: string,
    metadata?: Record<string, unknown>,
    options?: {
      dedupe?: boolean
      dedupeWindowMs?: number
      suppressDuringFind?: boolean
      updateSummary?: boolean
    }
  ) => {
    if (shouldSuppressForDocInteraction()) {
      return
    }
    const now = Date.now()
    if (options?.suppressDuringFind && shouldSuppressForBrowserFind()) {
      return
    }
    const dedupeWindowMs = options?.dedupeWindowMs ?? 1200
    if (
      options?.dedupe &&
      lastWindowSignalRef.current &&
      lastWindowSignalRef.current.source === source &&
      now - lastWindowSignalRef.current.loggedAtMs < dedupeWindowMs
    ) {
      return
    }
    lastWindowSignalRef.current = { source, loggedAtMs: now }
    void postFocusEvent(
      'window_unmaximize_attempt',
      {
        source,
        ...(metadata || {}),
      },
      { updateSummary: options?.updateSummary }
    )
  }, [postFocusEvent, shouldSuppressForBrowserFind, shouldSuppressForDocInteraction])

  const applyWindowComplianceSnapshot = useCallback((snapshot: ExamWindowComplianceSnapshot) => {
    fullscreenActiveRef.current = snapshot.isFullscreen
    setIsFullscreen(snapshot.isFullscreen)
    setIsWindowCompliantNow(snapshot.isCompliant)
  }, [])

  const confirmNonCompliantWindow = useCallback((
    source: 'fullscreen_exit' | 'window_resize',
    snapshot: ExamWindowComplianceSnapshot
  ) => {
    setIsWindowCompliantStable(false)
    if (!isWindowCompliantStableRef.current) return

    const baseMetadata = {
      width_ratio: Number(snapshot.widthRatio.toFixed(3)),
      height_ratio: Number(snapshot.heightRatio.toFixed(3)),
      inner_width: snapshot.innerWidth,
      inner_height: snapshot.innerHeight,
      avail_width: snapshot.availWidth,
      avail_height: snapshot.availHeight,
    }

    if (source === 'window_resize') {
      logWindowUnmaximizeAttempt(
        'window_resize',
        baseMetadata,
        { dedupe: true, dedupeWindowMs: 3000, suppressDuringFind: true, updateSummary: true }
      )
      return
    }

    logWindowUnmaximizeAttempt(
      'fullscreen_exit',
      {
        trigger: 'fullscreenchange',
        ...baseMetadata,
      },
      { dedupe: true, suppressDuringFind: true, updateSummary: true }
    )
  }, [logWindowUnmaximizeAttempt])

  const updateWindowCompliance = useCallback((
    source: 'fullscreen_exit' | 'window_resize'
  ) => {
    const snapshot = getExamWindowComplianceSnapshot()
    applyWindowComplianceSnapshot(snapshot)

    if (snapshot.isCompliant) {
      clearPendingNonCompliantTimeout()
      setIsWindowCompliantStable(true)
      return snapshot
    }

    const now = Date.now()
    const resizeFollowedExamInteraction =
      source === 'window_resize' &&
      isWindowCompliantStableRef.current &&
      now - lastExamFormInteractionAtRef.current <= EXAM_FORM_INTERACTION_RESIZE_SUPPRESSION_MS

    if (resizeFollowedExamInteraction) {
      clearPendingNonCompliantTimeout()
      setIsWindowCompliantStable(true)
      pendingNonCompliantSourceRef.current = source
      pendingNonCompliantTimeoutRef.current = window.setTimeout(() => {
        pendingNonCompliantTimeoutRef.current = null
        const confirmedSource = pendingNonCompliantSourceRef.current
        pendingNonCompliantSourceRef.current = null
        const confirmedSnapshot = getExamWindowComplianceSnapshot()
        applyWindowComplianceSnapshot(confirmedSnapshot)

        if (confirmedSnapshot.isCompliant) {
          setIsWindowCompliantStable(true)
          return
        }

        if (confirmedSource) {
          confirmNonCompliantWindow(confirmedSource, confirmedSnapshot)
        }
      }, EXAM_FORM_INTERACTION_RESIZE_SUPPRESSION_MS)
      return snapshot
    }

    clearPendingNonCompliantTimeout()
    pendingNonCompliantSourceRef.current = source
    pendingNonCompliantTimeoutRef.current = window.setTimeout(() => {
      pendingNonCompliantTimeoutRef.current = null
      const confirmedSource = pendingNonCompliantSourceRef.current
      pendingNonCompliantSourceRef.current = null
      const confirmedSnapshot = getExamWindowComplianceSnapshot()
      applyWindowComplianceSnapshot(confirmedSnapshot)

      if (confirmedSnapshot.isCompliant) {
        setIsWindowCompliantStable(true)
        return
      }

      if (confirmedSource) {
        confirmNonCompliantWindow(confirmedSource, confirmedSnapshot)
      }
    }, EXAM_WINDOW_COMPLIANCE_GRACE_MS)

    return snapshot
  }, [
    applyWindowComplianceSnapshot,
    clearPendingNonCompliantTimeout,
    confirmNonCompliantWindow,
  ])

  const requestExamFullscreen = useCallback(async (
    source: string,
    options?: { logFailures?: boolean }
  ) => {
    if (!isTestsView) return
    const fullscreenElement = document.documentElement as FullscreenCapableElement
    if (!fullscreenElement?.requestFullscreen) {
      const snapshot = getExamWindowComplianceSnapshot()
      applyWindowComplianceSnapshot(snapshot)
      if (snapshot.isCompliant) {
        clearPendingNonCompliantTimeout()
        setIsWindowCompliantStable(true)
      }
      if (options?.logFailures) {
        logWindowUnmaximizeAttempt(
          'fullscreen_not_supported',
          { request_source: source },
          { updateSummary: false }
        )
      }
      return
    }

    if (isFullscreenActive()) {
      const snapshot = getExamWindowComplianceSnapshot()
      applyWindowComplianceSnapshot(snapshot)
      clearPendingNonCompliantTimeout()
      setIsWindowCompliantStable(true)
      return
    }

    try {
      await fullscreenElement.requestFullscreen()
      const snapshot = getExamWindowComplianceSnapshot()
      applyWindowComplianceSnapshot(snapshot)
      clearPendingNonCompliantTimeout()
      setIsWindowCompliantStable(snapshot.isCompliant)
    } catch (error) {
      const snapshot = getExamWindowComplianceSnapshot()
      applyWindowComplianceSnapshot(snapshot)
      if (snapshot.isCompliant) {
        clearPendingNonCompliantTimeout()
        setIsWindowCompliantStable(true)
      }
      if (options?.logFailures) {
        logWindowUnmaximizeAttempt(
          'fullscreen_request_failed',
          {
            request_source: source,
            error_name: error instanceof Error ? error.name : 'unknown_error',
          },
          { updateSummary: true }
        )
      }
    }
  }, [
    applyWindowComplianceSnapshot,
    clearPendingNonCompliantTimeout,
    isTestsView,
    logWindowUnmaximizeAttempt,
  ])

  const performBackToAssessmentList = useCallback(() => {
    detailRequestIdRef.current += 1
    clearPendingNonCompliantTimeout()
    selectedTestIdRef.current = null
    setSelectedTestId(null)
    setSelectedTest(null)
    setStartedTestId(null)
    setFocusSummary(null)
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
    setActiveDoc(null)
    setRemoteClosureNotice(null)
    const snapshot = getExamWindowComplianceSnapshot()
    applyWindowComplianceSnapshot(snapshot)
    setIsWindowCompliantStable(snapshot.isCompliant)
    focusSessionIdRef.current = null
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
    findIntentUntilRef.current = 0
    findSuppressionUntilRef.current = 0
    docsInteractionSuppressionUntilRef.current = 0
    loadTests({ forceRefresh: true }) // Refresh list to get updated status
  }, [applyWindowComplianceSnapshot, clearPendingNonCompliantTimeout, loadTests])

  function handleBack() {
    performBackToAssessmentList()
  }

  function handleTestSubmitted() {
    setRemoteClosureNotice(null)
    if (isTestsView) {
      notifications?.decrementActiveTestsCount()
    }
    void loadTests({ forceRefresh: true })

    // Reload selected assessment details to get updated status/feedback.
    if (selectedTestIdRef.current) {
      void handleSelectTest(selectedTestIdRef.current)
    }
  }

  function handleRequestStartTest(testId: string) {
    setPendingStartTestId(testId)
    setShowStartTestConfirm(true)
  }

  function handleCancelStartTest() {
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
  }

  function handleConfirmStartTest() {
    const testId = pendingStartTestId
    if (!testId) return
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
    setStartedTestId(testId)
    focusSessionIdRef.current = createFocusSessionId()
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
    findIntentUntilRef.current = 0
    findSuppressionUntilRef.current = 0
    docsInteractionSuppressionUntilRef.current = 0
    void requestExamFullscreen('start_test_confirm')
    if (selectedTestIdRef.current !== testId || !selectedTest) {
      void handleSelectTest(testId)
    }
  }

  useEffect(() => {
    if (!isTestsView) return
    const exitsCount = getTestExitCount(focusSummary)
    const awayTotalSeconds = Math.max(0, focusSummary?.away_total_seconds ?? 0)

    window.dispatchEvent(
      new CustomEvent(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, {
        detail: {
          classroomId: classroom.id,
          active: focusEnabled,
          testId: focusEnabled ? selectedTestIdRef.current : null,
          testTitle: focusEnabled ? selectedTest?.test.title || null : null,
          exitsCount: focusEnabled ? exitsCount : 0,
          awayTotalSeconds: focusEnabled ? awayTotalSeconds : 0,
        },
      })
    )

    return () => {
      window.dispatchEvent(
        new CustomEvent(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, {
          detail: {
            classroomId: classroom.id,
            active: false,
            testId: null,
            testTitle: null,
            exitsCount: 0,
            awayTotalSeconds: 0,
          },
        })
      )
    }
  }, [classroom.id, focusEnabled, focusSummary, isTestsView, selectedTest?.test.title])

  useEffect(() => {
    if (!isTestsView) return

    const handleRouteExitAttemptEvent = (event: Event) => {
      if (!focusEnabledRef.current) return
      const detail = (event as CustomEvent<RouteExitAttemptDetail>).detail
      if (detail?.classroomId && detail.classroomId !== classroom.id) return
      logRouteExitAttempt(
        detail?.source || 'in_app_navigation',
        detail?.metadata || undefined,
        { dedupe: detail?.dedupe === true }
      )
    }

    window.addEventListener(STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT, handleRouteExitAttemptEvent)
    return () => {
      window.removeEventListener(STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT, handleRouteExitAttemptEvent)
    }
  }, [classroom.id, isTestsView, logRouteExitAttempt])

  useEffect(() => {
    if (!focusEnabled) return

    const intervalId = window.setInterval(() => {
      void revalidateActiveTestSession()
    }, 30_000)

    const handleSessionVisibility = () => {
      if (document.visibilityState === 'visible') {
        void revalidateActiveTestSession()
      }
    }

    const handleSessionFocus = () => {
      void revalidateActiveTestSession()
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      logRouteExitAttempt(
        'beforeunload',
        { blocked: true },
        { dedupe: true, updateSummary: false }
      )
      event.preventDefault()
      event.returnValue = ''
    }

    const handlePageHide = () => {
      logRouteExitAttempt(
        'pagehide',
        undefined,
        { dedupe: true, updateSummary: false }
      )
    }

    document.addEventListener('visibilitychange', handleSessionVisibility)
    window.addEventListener('focus', handleSessionFocus)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleSessionVisibility)
      window.removeEventListener('focus', handleSessionFocus)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [focusEnabled, logRouteExitAttempt, revalidateActiveTestSession])

  useEffect(() => {
    if (!focusEnabled) {
      clearPendingNonCompliantTimeout()
      const snapshot = getExamWindowComplianceSnapshot()
      applyWindowComplianceSnapshot(snapshot)
      setIsWindowCompliantStable(snapshot.isCompliant)
      return
    }

    const initialSnapshot = getExamWindowComplianceSnapshot()
    applyWindowComplianceSnapshot(initialSnapshot)
    setIsWindowCompliantStable(true)
    if (!initialSnapshot.isFullscreen) {
      void requestExamFullscreen('exam_mode_start')
    }
    if (!initialSnapshot.isCompliant) {
      updateWindowCompliance('window_resize')
    }

    const handleFullscreenChange = () => {
      void updateWindowCompliance('fullscreen_exit')
    }

    const handleResize = () => {
      void updateWindowCompliance('window_resize')
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    window.addEventListener('resize', handleResize)
    return () => {
      clearPendingNonCompliantTimeout()
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      window.removeEventListener('resize', handleResize)
    }
  }, [
    applyWindowComplianceSnapshot,
    clearPendingNonCompliantTimeout,
    focusEnabled,
    requestExamFullscreen,
    updateWindowCompliance,
  ])

  useEffect(() => {
    if (!focusEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        findIntentUntilRef.current = Date.now() + TEST_EXIT_BURST_WINDOW_MS
        findSuppressionUntilRef.current = 0
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [focusEnabled])

  useEffect(() => {
    if (!focusEnabled) return

    const startAway = (source: 'visibility' | 'blur') => {
      if (awayStartedAtRef.current !== null) return
      if (shouldSuppressForBrowserFind()) return
      if (shouldSuppressForDocInteraction()) return
      awayStartedAtRef.current = Date.now()
      void postFocusEvent('away_start', { source })
    }

    const endAway = (source: 'visibility' | 'focus') => {
      if (awayStartedAtRef.current === null) return
      const durationSeconds = Math.max(
        0,
        Math.round((Date.now() - awayStartedAtRef.current) / 1000)
      )
      awayStartedAtRef.current = null
      void postFocusEvent('away_end', { source, duration_seconds: durationSeconds })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        startAway('visibility')
      } else if (document.visibilityState === 'visible') {
        endAway('visibility')
      }
    }

    const handleBlur = () => startAway('blur')
    const handleFocus = () => endAway('focus')

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      if (awayStartedAtRef.current !== null) {
        awayStartedAtRef.current = null
        void postFocusEvent('away_end', { source: 'cleanup' })
      }
    }
  }, [focusEnabled, postFocusEvent, shouldSuppressForBrowserFind, shouldSuppressForDocInteraction])

  useEffect(() => {
    return () => {
      if (!focusEnabledRef.current) return
      logRouteExitAttempt(
        'component_unmount',
        undefined,
        { dedupe: true, updateSummary: false }
      )
    }
  }, [logRouteExitAttempt])

  const renderAssessmentList = (showSelectionState: boolean) => {
    if (visibleTests.length === 0) {
      return (
        <p className="text-text-muted text-center py-8">
          No tests available.
        </p>
      )
    }

    return (
      <PageStack>
        {visibleTests.map((test) => {
          const isSelected = selectedTestId === test.id

          return (
            <button
              key={test.id}
              type="button"
              onClick={() => {
                void handleSelectTest(test.id)
              }}
              className={`block w-full rounded-card border px-5 py-4 text-left transition-[background-color,border-color,box-shadow,transform] ${
                showSelectionState && isSelected
                  ? 'border-primary bg-surface-accent ring-1 ring-primary/25 shadow-panel'
                  : 'border-border bg-surface-panel hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-text-default">{test.title}</h3>
                  {test.status === 'closed' && (
                    <p className="mt-1 text-sm text-text-muted">
                      This test is closed
                    </p>
                  )}
                </div>
                {isTestsView ? (
                  <>
                    {test.student_status === 'can_view_results' ? (
                      <span className="rounded-badge bg-info-bg px-2.5 py-1 text-xs font-semibold text-info">
                        Returned
                      </span>
                    ) : test.status === 'closed' ? (
                      <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getTestStatusBadgeClass('closed')}`}>
                        Closed
                      </span>
                    ) : test.student_status === 'responded' ? (
                      <span className="rounded-badge bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">
                        Submitted
                      </span>
                    ) : (
                      <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getTestStatusBadgeClass('active')}`}>
                        New
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {test.student_status === 'not_started' && (
                      <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getTestStatusBadgeClass('active')}`}>
                        New
                      </span>
                    )}
                    {test.student_status === 'responded' && (
                      <span className="rounded-badge bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">
                        Submitted
                      </span>
                    )}
                    {test.student_status === 'can_view_results' && (
                      <span className="rounded-badge bg-info-bg px-2.5 py-1 text-xs font-semibold text-info">
                        View Results
                      </span>
                    )}
                  </>
                )}
              </div>
            </button>
          )
        })}
      </PageStack>
    )
  }

  const hasSelectedTest = selectedTestId !== null && selectedTest !== null
  const hasResponded = hasSelectedTest && selectedTest.test.student_status !== 'not_started'
  const requiresStart =
    hasSelectedTest &&
    selectedTest.test.student_status === 'not_started' &&
    startedTestId !== selectedTest.test.id
  const isViewingResults =
    hasSelectedTest &&
    hasResponded &&
    selectedTest.test.student_status === 'can_view_results'
  const showCurrentTestInfoPanel = hasSelectedTest && focusEnabled
  const showDocPanel = showCurrentTestInfoPanel && activeDoc !== null
  const awayDurationLabel = formatDuration(focusSummary?.away_total_seconds ?? 0)
  const exitsCount = getTestExitCount(focusSummary)
  const awayCount = focusSummary?.away_count ?? 0
  const routeExitAttempts = focusSummary?.route_exit_attempts ?? 0
  const windowUnmaximizeAttempts = focusSummary?.window_unmaximize_attempts ?? 0
  const showNotMaximizedWarning =
    EXAM_LOCK_OVERLAY_ENABLED && showCurrentTestInfoPanel && !isWindowCompliantStable
    const iframeDocs = allowedDocs.filter((doc) => doc.source !== 'text' && Boolean(doc.url))
    const selectedTestTitle = hasSelectedTest ? selectedTest.test.title : ''
    const selectedTestPanelTitle = isViewingResults
      ? `${selectedTestTitle} Results`
      : selectedTestTitle
    const selectedTestOverviewLabel = hasSelectedTest
      ? formatTestOverviewLabel(selectedTest.questions)
      : null
    const showSplitExamShell =
      hasSelectedTest &&
      !requiresStart &&
      !hasResponded &&
      showCurrentTestInfoPanel

    return (
      <PageLayout className="relative h-full flex flex-col">
        {showNotMaximizedWarning && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[60] border-[10px] border-warning bg-warning-bg"
          />
        )}
        {showNotMaximizedWarning && (
          <div
            aria-hidden="true"
            data-testid="exam-content-obscurer"
            className="pointer-events-none fixed inset-0 z-[62] bg-warning-bg"
          />
        )}
        {showNotMaximizedWarning && (
          <div
            aria-hidden="true"
            data-testid="exam-interaction-blocker"
            className="fixed inset-0 z-[64] cursor-not-allowed"
          />
        )}
        {showNotMaximizedWarning && (
          <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center px-4">
            <div className="pointer-events-auto rounded-xl border border-warning bg-surface p-4 shadow-xl">
              <p className="mb-3 text-center text-sm font-medium text-warning">
                Window must be maximized in exam mode.
              </p>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2"
                onClick={() => {
                  void requestExamFullscreen('center_overlay_maximize', { logFailures: true })
                }}
              >
                <Maximize className="h-5 w-5" />
                <span>Maximize Window</span>
              </Button>
            </div>
          </div>
        )}

        <PageContent className={showSplitExamShell ? 'flex-1 min-h-0 px-0 pt-1' : 'flex-1 min-h-0'}>
          {hasCurrentTestsSnapshot && loading ? (
            <span role="status" className="sr-only">Refreshing tests</span>
          ) : null}
          <div
            ref={testsRegionRef}
            role="region"
            aria-label="Tests"
            tabIndex={-1}
            aria-hidden={showNotMaximizedWarning}
            className={`mx-auto h-full w-full focus:outline-none ${
              showSplitExamShell || !hasSelectedTest ? 'max-w-none' : 'max-w-3xl'
            }`}
            style={showNotMaximizedWarning ? { visibility: 'hidden' } : undefined}
          >
            {showSplitExamShell ? (
                <div
                  data-testid="student-test-split-container"
                  className={`grid grid-cols-1 gap-2 ${
                    showDocPanel ? 'lg:grid-cols-[50%_50%]' : 'lg:grid-cols-[30%_70%]'
                  } lg:min-h-0 lg:h-[calc(100dvh-3rem)] lg:transition-[grid-template-columns] lg:duration-500 lg:ease-[cubic-bezier(0.22,1,0.36,1)] lg:[will-change:grid-template-columns] motion-reduce:transition-none`}
                >
                  <section
                    data-testid="student-test-documents-pane"
                    className={`rounded-xl border border-border bg-surface ${
                      showCurrentTestInfoPanel
                        ? 'relative min-h-0 overflow-x-hidden overflow-y-auto scrollbar-hover p-0'
                        : 'lg:h-full lg:min-h-0 p-3 sm:p-4'
                    }`}
                  >
                    {showCurrentTestInfoPanel ? (
                      <>
                        <div
                          aria-hidden={showDocPanel}
                          className={`p-3 sm:p-4 transition-all duration-200 ease-out motion-reduce:transition-none ${
                            showDocPanel
                              ? 'pointer-events-none translate-x-2 opacity-0'
                              : 'translate-x-0 opacity-100'
                          }`}
                        >
                          <div className="space-y-4">
                            <h2 className="mb-3 text-lg font-semibold text-text-default">Documents</h2>

                            {allowedDocs.length > 0 ? (
                              <div className="space-y-2">
                                {allowedDocs.map((doc) => (
                                  <Button
                                    key={doc.id}
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="w-full justify-between gap-2 text-left"
                                    onClick={() => {
                                      markAllowedDocInteraction()
                                      setActiveDoc(doc)
                                    }}
                                    tabIndex={showDocPanel ? -1 : 0}
                                  >
                                    <span className="min-w-0 truncate">{doc.title}</span>
                                    <ChevronRight
                                      aria-hidden="true"
                                      data-testid="student-test-document-open-icon"
                                      className="h-4 w-4 flex-shrink-0 text-text-muted"
                                    />
                                  </Button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-text-muted">No documents provided for this test.</p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                              <span
                                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 tabular-nums"
                                aria-label={`Exits ${exitsCount}. Away/focus ${awayCount}, in-app exits ${routeExitAttempts}, window/full-screen exits ${windowUnmaximizeAttempts}.`}
                              >
                                <LogOut className="h-4 w-4" />
                                <span>{exitsCount}</span>
                              </span>
                              <span
                                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 tabular-nums"
                                aria-label={`Away time ${awayDurationLabel}.`}
                              >
                                <ClockAlert className="h-4 w-4" />
                                <span>{awayDurationLabel}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        <div
                          aria-hidden={!showDocPanel}
                          onPointerDown={markAllowedDocInteraction}
                          onPointerMove={markAllowedDocInteraction}
                          onWheel={markAllowedDocInteraction}
                          className={`absolute inset-0 transition-all duration-300 ease-out motion-reduce:transition-none ${
                            showDocPanel
                              ? 'pointer-events-auto translate-x-0 opacity-100'
                              : 'pointer-events-none -translate-x-2 opacity-0'
                          }`}
                        >
                          <div className="flex h-full flex-col bg-surface">
                            <div className="grid h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-border bg-surface-2 px-3">
                              <button
                                type="button"
                                onClick={() => {
                                  markAllowedDocInteraction()
                                  setActiveDoc(null)
                                }}
                                aria-label="Back to documents list"
                                className="inline-flex items-center gap-1 justify-self-start whitespace-nowrap rounded-md bg-info-bg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-info-bg-hover"
                                tabIndex={showDocPanel ? 0 : -1}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                <span>Back</span>
                              </button>
                              <span className="min-w-0 truncate text-center text-sm text-text-muted">
                                {activeDoc?.title || 'Documentation'}
                              </span>
                              <span
                                aria-hidden="true"
                                className="invisible inline-flex items-center gap-1 justify-self-end whitespace-nowrap rounded-md border border-primary/40 px-2 py-1 text-xs font-semibold"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                <span>Back</span>
                              </span>
                            </div>

                            {activeDoc?.source === 'text' ? (
                              <TestTextDocumentViewer
                                content={activeDoc.content || ''}
                                onKeyUp={handleTextDocPointerUp}
                                onMouseUp={handleTextDocPointerUp}
                              />
                            ) : iframeDocs.length > 0 ? (
                              <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
                                {iframeDocs.map((doc) => {
                                  const isVisible = activeDoc?.id === doc.id
                                  return (
                                    <iframe
                                      key={doc.id}
                                      src={doc.url}
                                      title={doc.title || 'Documentation'}
                                      onFocus={markAllowedDocInteraction}
                                      onPointerEnter={markAllowedDocInteraction}
                                      className={`absolute inset-y-0 left-0 h-full w-[calc(100%+10px)] transition-opacity duration-150 motion-reduce:transition-none ${
                                        isVisible
                                          ? 'opacity-100'
                                          : 'pointer-events-none opacity-0'
                                      }`}
                                      sandbox="allow-same-origin allow-scripts allow-forms"
                                      loading="eager"
                                    />
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                                <p className="text-sm text-text-muted">This document is unavailable.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <h2 className="mb-3 text-lg font-semibold text-text-default">Tests</h2>
                        {renderAssessmentList(true)}
                      </>
                    )}
                  </section>

                  <section
                    data-testid="student-test-detail-pane"
                    className={`rounded-xl border border-border bg-surface p-3 sm:p-4 ${
                      showCurrentTestInfoPanel
                        ? 'min-h-0 overflow-y-auto scrollbar-hover'
                        : 'lg:h-full'
                    } ${
                      showNotMaximizedWarning ? 'border-warning bg-warning-bg/20' : ''
                    }`}
                    onPointerDownCapture={markExamFormInteraction}
                    onKeyDownCapture={markExamFormInteraction}
                  >
                    {selectedTestId && loadingTest ? (
                      <div className="flex justify-center py-12">
                        <Spinner size="lg" />
                      </div>
                    ) : hasSelectedTest ? (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h2 className="text-xl font-bold text-text-default">{selectedTestPanelTitle}</h2>
                          {selectedTestOverviewLabel ? (
                            <p className="text-sm text-text-muted">{selectedTestOverviewLabel}</p>
                          ) : null}
                        </div>

                        {remoteClosureNotice ? (
                          <div className="rounded-xl border border-warning bg-warning-bg/20 p-4">
                            <div className="space-y-3">
                              <p className="text-base font-semibold text-text-default">
                                {remoteClosureNotice.title}
                              </p>
                              <p className="text-sm text-text-muted">
                                {remoteClosureNotice.description}
                              </p>
                              <Button
                                type="button"
                                className="w-full sm:w-auto"
                                onClick={performBackToAssessmentList}
                              >
                                Return to tests
                              </Button>
                            </div>
                          </div>
                        ) : requiresStart ? (
                          <Button
                            type="button"
                            className="w-full sm:w-auto"
                            onClick={() => handleRequestStartTest(selectedTest.test.id)}
                          >
                            Start the Test
                          </Button>
                        ) : hasResponded && selectedTest.test.student_status === 'can_view_results' ? (
                          <StudentTestResults
                            testId={selectedTestId!}
                            myResponses={selectedTest.studentResponses}
                            assessmentType={assessmentType}
                            apiBasePath={apiBasePath}
                            showSubmissionBanner={!(isTestsView && selectedTest.test.student_status === 'can_view_results')}
                          />
                        ) : hasResponded ? (
                          <div className="p-4 bg-success-bg rounded-lg text-center">
                            <p className="text-success font-medium">Response Submitted</p>
                            {selectedTest.test.status !== 'closed' ? (
                              <p className="text-sm text-text-muted mt-1">
                                Results will be available after this test is closed and returned by your teacher.
                              </p>
                            ) : (
                              <p className="text-sm text-text-muted mt-1">
                                Results will be available after your teacher returns this test.
                              </p>
                            )}
                          </div>
                        ) : (
                          <StudentTestForm
                            testId={selectedTestId!}
                            questions={selectedTest.questions}
                            initialResponses={selectedTest.studentResponses}
                            enableDraftAutosave
                            isInteractionLocked={showNotMaximizedWarning}
                            assessmentType={assessmentType}
                            apiBasePath={apiBasePath}
                            onAvailabilityLoss={() => {
                              void revalidateActiveTestSession()
                            }}
                            onSubmitted={handleTestSubmitted}
                          />
                        )}

                        {!showCurrentTestInfoPanel && (
                          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm text-text-muted">
                            <span
                              className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 tabular-nums"
                              aria-label={`Exits ${exitsCount}. Away/focus ${awayCount}, in-app exits ${routeExitAttempts}, window/full-screen exits ${windowUnmaximizeAttempts}.`}
                            >
                              <LogOut className="h-4 w-4" />
                              <span>{exitsCount}</span>
                            </span>
                            <span
                              className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 tabular-nums"
                              aria-label={`Away time ${awayDurationLabel}.`}
                            >
                              <ClockAlert className="h-4 w-4" />
                              <span>{awayDurationLabel}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 px-4 text-center">
                        <p className="text-sm text-text-muted">
                          Select a test from the list to view and complete it.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
            ) : !hasSelectedTest ? (
                !hasCurrentTestsSnapshot ? (
                  listError ? (
                    <PageState
                      kind="error"
                      title="Tests unavailable"
                      description="Pika couldn't load this classroom's tests. Nothing was changed."
                      action={<Button type="button" onClick={retryTests}>Retry</Button>}
                    />
                  ) : (
                    <PageState kind="loading" title="Loading tests" />
                  )
                ) : (
                  <div className="space-y-3">
                    {listError ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
                      >
                        <span>Tests could not be refreshed. Showing the last loaded list.</span>
                        <Button type="button" variant="secondary" size="sm" onClick={retryTests}>
                          Retry
                        </Button>
                      </div>
                    ) : null}
                    {visibleTests.length === 0 ? (
                      <EmptyState
                        title="No tests available."
                        description="When your teacher publishes a test, it will show up here."
                      />
                    ) : (
                      <div className="min-w-0 h-full flex flex-col max-w-none">
                        {renderAssessmentList(false)}
                      </div>
                    )}
                  </div>
                )
            ) : selectedTestId && loadingTest ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
            ) : (
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="mb-4 flex items-center gap-1 text-sm text-text-muted hover:text-text-default"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back to tests
                  </button>

                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-bold text-text-default">
                        {selectedTestPanelTitle}
                      </h2>
                      {selectedTestOverviewLabel ? (
                        <p className="mt-1 text-sm text-text-muted">{selectedTestOverviewLabel}</p>
                      ) : null}
                      {allowedDocs.length > 0 && requiresStart ? (
                        <p className="mt-1 text-sm text-text-muted">
                          {allowedDocs.length} reference document{allowedDocs.length === 1 ? '' : 's'} will be available during the test.
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={[
                        'rounded-badge px-2.5 py-1 text-xs font-semibold',
                        selectedTest?.test.student_status === 'can_view_results'
                          ? 'bg-info-bg text-info'
                          : selectedTest?.test.student_status === 'responded'
                            ? 'bg-surface-2 text-text-muted'
                            : selectedTest?.test.status === 'closed'
                              ? getTestStatusBadgeClass('closed')
                              : getTestStatusBadgeClass('active'),
                      ].join(' ')}
                    >
                      {selectedTest?.test.student_status === 'can_view_results'
                        ? 'Returned'
                        : selectedTest?.test.student_status === 'responded'
                          ? 'Submitted'
                          : selectedTest?.test.status === 'closed'
                            ? 'Closed'
                            : 'New'}
                    </span>
                  </div>

                  {remoteClosureNotice ? (
                    <div className="rounded-xl border border-warning bg-warning-bg/20 p-4">
                      <div className="space-y-3">
                        <p className="text-base font-semibold text-text-default">
                          {remoteClosureNotice.title}
                        </p>
                        <p className="text-sm text-text-muted">
                          {remoteClosureNotice.description}
                        </p>
                        <Button
                          type="button"
                          className="w-full sm:w-auto"
                          onClick={performBackToAssessmentList}
                        >
                          Return to tests
                        </Button>
                      </div>
                    </div>
                  ) : requiresStart ? (
                    <div className="rounded-card border border-border bg-surface-panel p-5 shadow-elevated">
                      <p className="text-sm text-text-muted">
                        Review the test details, then start when you are ready.
                      </p>
                      <div className="mt-4">
                        <Button
                          type="button"
                          className="w-full sm:w-auto"
                          onClick={() => handleRequestStartTest(selectedTest.test.id)}
                        >
                          Start the Test
                        </Button>
                      </div>
                    </div>
                  ) : hasResponded && selectedTest.test.student_status === 'can_view_results' ? (
                    <StudentTestResults
                      testId={selectedTestId!}
                      myResponses={selectedTest.studentResponses}
                      assessmentType={assessmentType}
                      apiBasePath={apiBasePath}
                      showSubmissionBanner={false}
                    />
                  ) : hasResponded ? (
                    <div className="rounded-card border border-success bg-success-bg p-5 text-center shadow-elevated">
                      <p className="font-medium text-success">Response Submitted</p>
                      {selectedTest.test.status !== 'closed' ? (
                        <p className="mt-1 text-sm text-text-muted">
                          Results will be available after this test is closed and returned by your teacher.
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-text-muted">
                          Results will be available after your teacher returns this test.
                        </p>
                      )}
                    </div>
                  ) : (
                    <StudentTestForm
                      testId={selectedTestId!}
                      questions={selectedTest.questions}
                      initialResponses={selectedTest.studentResponses}
                      enableDraftAutosave
                      isInteractionLocked={showNotMaximizedWarning}
                      assessmentType={assessmentType}
                      apiBasePath={apiBasePath}
                      onSubmitted={handleTestSubmitted}
                    />
                  )}
                </div>
            )}
          </div>
        </PageContent>

        <ConfirmDialog
          isOpen={showStartTestConfirm}
          title="Start this test?"
          description="Exam mode will start and test window must remain maximized."
          confirmLabel="Start test"
          cancelLabel="Cancel"
          onCancel={handleCancelStartTest}
          onConfirm={handleConfirmStartTest}
        />
      </PageLayout>
    )
}
