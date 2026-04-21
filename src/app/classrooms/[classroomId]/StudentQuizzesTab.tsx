'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ClockAlert, LogOut, Maximize } from 'lucide-react'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { Spinner } from '@/components/Spinner'
import { PageContent, PageLayout, PageStack } from '@/components/PageLayout'
import {
  getQuizExitCount,
  getQuizStatusBadgeClass,
  QUIZ_EXIT_BURST_WINDOW_MS,
} from '@/lib/quizzes'
import { StudentQuizForm } from '@/components/StudentQuizForm'
import { StudentQuizResults } from '@/components/StudentQuizResults'
import { Button, ConfirmDialog, EmptyState } from '@/ui'
import {
  STUDENT_TEST_EXAM_MODE_CHANGE_EVENT,
  STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT,
} from '@/lib/events'
import { normalizeTestDocuments } from '@/lib/test-documents'
import type {
  Classroom,
  QuizAssessmentType,
  QuizFocusSummary,
  QuizQuestion,
  StudentQuizStatus,
  StudentQuizView,
  TestResponseDraftValue,
} from '@/types'

interface Props {
  classroom: Classroom
  assessmentType: QuizAssessmentType
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

interface StudentTestSessionStatusResponse {
  quiz: {
    id: string
    status: 'draft' | 'active' | 'closed'
    assessment_type: 'test'
    student_status: StudentQuizStatus
    returned_at: string | null
  }
  student_status: StudentQuizStatus
  returned_at: string | null
  can_continue: boolean
  message: string | null
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

function isFullscreenActive(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement)
}

const DOCS_EXIT_SUPPRESSION_WINDOW_MS = 1200
const UNSUPPRESSED_ROUTE_EXIT_SOURCES = new Set([
  'tab_navigation',
  'home_navigation',
  'classroom_switch',
])

function extractAllowedDocLinks(questions: QuizQuestion[]): AllowedDocItem[] {
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
  studentStatus: StudentQuizStatus | 'unavailable',
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

export function StudentQuizzesTab({ classroom, assessmentType, isActive = true }: Props) {
  const notifications = useStudentNotifications()
  const [quizzes, setQuizzes] = useState<StudentQuizView[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [focusSummary, setFocusSummary] = useState<QuizFocusSummary | null>(null)
  const [selectedQuiz, setSelectedQuiz] = useState<{
    quiz: StudentQuizView
    questions: QuizQuestion[]
    studentResponses: Record<string, number | TestResponseDraftValue>
  } | null>(null)
  const [startedTestId, setStartedTestId] = useState<string | null>(null)
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [showStartTestConfirm, setShowStartTestConfirm] = useState(false)
  const [pendingStartTestId, setPendingStartTestId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeDoc, setActiveDoc] = useState<AllowedDocItem | null>(null)
  const [remoteClosureNotice, setRemoteClosureNotice] = useState<RemoteClosureNotice | null>(null)
  const selectedQuizIdRef = useRef<string | null>(null)
  const focusSessionIdRef = useRef<string | null>(null)
  const awayStartedAtRef = useRef<number | null>(null)
  const focusEnabledRef = useRef(false)
  const fullscreenActiveRef = useRef(false)
  const lastRouteExitRef = useRef<{ source: string; loggedAtMs: number } | null>(null)
  const lastWindowSignalRef = useRef<{ source: string; loggedAtMs: number } | null>(null)
  const findIntentUntilRef = useRef(0)
  const findSuppressionUntilRef = useRef(0)
  const docsInteractionSuppressionUntilRef = useRef(0)
  const sessionStatusInFlightRef = useRef(false)
  const isTestsView = assessmentType === 'test'
  const apiBasePath = isTestsView ? '/api/student/tests' : '/api/student/quizzes'
  const focusEnabled = useMemo(() => {
    if (!selectedQuiz) return false
    const hasSubmitted = selectedQuiz.quiz.student_status !== 'not_started'
    const hasStarted = startedTestId === selectedQuiz.quiz.id
    return isTestsView && isActive && !hasSubmitted && hasStarted
  }, [isActive, isTestsView, selectedQuiz, startedTestId])
  const allowedDocs = useMemo(() => {
    const teacherManagedDocs = normalizeTestDocuments(selectedQuiz?.quiz?.documents).map((doc) => {
      const snapshotUrl =
        doc.source === 'link' && selectedQuiz?.quiz?.id && doc.snapshot_path
          ? `/api/student/tests/${selectedQuiz.quiz.id}/documents/${doc.id}/snapshot`
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
    return extractAllowedDocLinks(selectedQuiz?.questions || [])
  }, [selectedQuiz?.questions, selectedQuiz?.quiz?.documents, selectedQuiz?.quiz?.id])

  useEffect(() => {
    if (!isTestsView) return
    setActiveDoc((previous) => {
      if (!previous) return null
      return allowedDocs.some((doc) => doc.id === previous.id) ? previous : null
    })
  }, [allowedDocs, isTestsView])

  useEffect(() => {
    selectedQuizIdRef.current = selectedQuizId
  }, [selectedQuizId])

  useEffect(() => {
    focusEnabledRef.current = focusEnabled
    if (!focusEnabled) {
      lastRouteExitRef.current = null
      lastWindowSignalRef.current = null
      findIntentUntilRef.current = 0
      findSuppressionUntilRef.current = 0
      docsInteractionSuppressionUntilRef.current = 0
    }
  }, [focusEnabled])

  useEffect(() => {
    const fullscreenNow = isFullscreenActive()
    fullscreenActiveRef.current = fullscreenNow
    setIsFullscreen(fullscreenNow)
  }, [])

  const loadQuizzes = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ classroom_id: classroom.id })
      const res = await fetch(`${apiBasePath}?${query.toString()}`)
      const data = await res.json()
      setQuizzes(data.quizzes || [])
    } catch (err) {
      console.error('Error loading quizzes:', err)
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, classroom.id])

  useEffect(() => {
    loadQuizzes()
  }, [loadQuizzes])

  const handleRemoteTestClosure = useCallback((options?: {
    studentStatus?: StudentQuizStatus
    message?: string | null
  }) => {
    const nextStudentStatus = options?.studentStatus ?? 'responded'
    setSelectedQuiz((current) => {
      if (!current) return current
      return {
        ...current,
        quiz: {
          ...current.quiz,
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
      title: 'This test is now closed.',
      description: getRemoteClosureDescription(nextStudentStatus, options?.message),
    })
    focusSessionIdRef.current = null
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
  }, [])

  async function handleSelectQuiz(quizId: string) {
    setSelectedQuizId(quizId)
    setLoadingQuiz(true)
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
      const res = await fetch(`${apiBasePath}/${quizId}`)
      const data = await res.json()
      const listQuiz = quizzes.find((quiz) => quiz.id === quizId)
      const studentStatus = data.student_status ?? data.quiz?.student_status ?? listQuiz?.student_status ?? 'not_started'
      setSelectedQuiz({
        quiz: { ...data.quiz, student_status: studentStatus },
        questions: data.questions || [],
        studentResponses: data.student_responses || {},
      })
      setFocusSummary((data.focus_summary as QuizFocusSummary | null) || null)
    } catch (err) {
      console.error('Error loading quiz:', err)
    } finally {
      setLoadingQuiz(false)
    }
  }

  const revalidateActiveTestSession = useCallback(async () => {
    if (!isTestsView || !focusEnabledRef.current) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

    const quizId = selectedQuizIdRef.current
    if (!quizId || sessionStatusInFlightRef.current) return

    sessionStatusInFlightRef.current = true
    try {
      const res = await fetch(`${apiBasePath}/${quizId}/session-status`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))

      if (selectedQuizIdRef.current !== quizId) return

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
      quizId?: string | null
      sessionId?: string | null
      updateSummary?: boolean
    }
  ) => {
    const quizId = options?.quizId ?? selectedQuizIdRef.current
    const sessionId = options?.sessionId ?? focusSessionIdRef.current

    if (!quizId || !sessionId) return

    try {
      const res = await fetch(`${apiBasePath}/${quizId}/focus-events`, {
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
        setFocusSummary(data.focus_summary as QuizFocusSummary)
      }
    } catch (err) {
      console.error('Error posting quiz focus event:', err)
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

  const requestExamFullscreen = useCallback(async (
    source: string,
    options?: { logFailures?: boolean }
  ) => {
    if (!isTestsView) return
    const fullscreenElement = document.documentElement as FullscreenCapableElement
    if (!fullscreenElement?.requestFullscreen) {
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
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
      fullscreenActiveRef.current = true
      setIsFullscreen(true)
      return
    }

    try {
      await fullscreenElement.requestFullscreen()
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
    } catch (error) {
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
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
  }, [isTestsView, logWindowUnmaximizeAttempt])

  const performBackToAssessmentList = useCallback(() => {
    setSelectedQuizId(null)
    setSelectedQuiz(null)
    setStartedTestId(null)
    setFocusSummary(null)
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
    setActiveDoc(null)
    setRemoteClosureNotice(null)
    const fullscreenNow = isFullscreenActive()
    fullscreenActiveRef.current = fullscreenNow
    setIsFullscreen(fullscreenNow)
    focusSessionIdRef.current = null
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
    findIntentUntilRef.current = 0
    findSuppressionUntilRef.current = 0
    docsInteractionSuppressionUntilRef.current = 0
    loadQuizzes() // Refresh list to get updated status
  }, [loadQuizzes])

  function handleBack() {
    performBackToAssessmentList()
  }

  function handleQuizSubmitted() {
    setRemoteClosureNotice(null)
    if (isTestsView) {
      notifications?.clearActiveTestsCount()
    } else {
      notifications?.clearActiveQuizzesCount()
    }
    void loadQuizzes()

    // Reload selected assessment details to get updated status/feedback.
    if (selectedQuizIdRef.current) {
      void handleSelectQuiz(selectedQuizIdRef.current)
    }
  }

  function handleRequestStartTest(quizId: string) {
    setPendingStartTestId(quizId)
    setShowStartTestConfirm(true)
  }

  function handleCancelStartTest() {
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
  }

  function handleConfirmStartTest() {
    const quizId = pendingStartTestId
    if (!quizId) return
    setShowStartTestConfirm(false)
    setPendingStartTestId(null)
    setStartedTestId(quizId)
    focusSessionIdRef.current = createFocusSessionId()
    awayStartedAtRef.current = null
    lastRouteExitRef.current = null
    lastWindowSignalRef.current = null
    findIntentUntilRef.current = 0
    findSuppressionUntilRef.current = 0
    docsInteractionSuppressionUntilRef.current = 0
    void requestExamFullscreen('start_test_confirm')
    if (selectedQuizIdRef.current !== quizId || !selectedQuiz) {
      void handleSelectQuiz(quizId)
    }
  }

  useEffect(() => {
    if (!isTestsView) return
    const exitsCount = getQuizExitCount(focusSummary)
    const awayTotalSeconds = Math.max(0, focusSummary?.away_total_seconds ?? 0)

    window.dispatchEvent(
      new CustomEvent(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, {
        detail: {
          classroomId: classroom.id,
          active: focusEnabled,
          testId: focusEnabled ? selectedQuizIdRef.current : null,
          testTitle: focusEnabled ? selectedQuiz?.quiz.title || null : null,
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
  }, [classroom.id, focusEnabled, focusSummary, isTestsView, selectedQuiz?.quiz.title])

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
      const fullscreenNow = isFullscreenActive()
      fullscreenActiveRef.current = fullscreenNow
      setIsFullscreen(fullscreenNow)
      return
    }

    const fullscreenNow = isFullscreenActive()
    fullscreenActiveRef.current = fullscreenNow
    setIsFullscreen(fullscreenNow)
    if (!fullscreenNow) {
      void requestExamFullscreen('exam_mode_start')
    }

    const handleFullscreenChange = () => {
      const currentlyFullscreen = isFullscreenActive()
      const wasFullscreen = fullscreenActiveRef.current
      fullscreenActiveRef.current = currentlyFullscreen
      setIsFullscreen(currentlyFullscreen)
      if (wasFullscreen && !currentlyFullscreen) {
        logWindowUnmaximizeAttempt(
          'fullscreen_exit',
          { trigger: 'fullscreenchange' },
          { dedupe: true, suppressDuringFind: true, updateSummary: true }
        )
      }
    }

    const handleResize = () => {
      if (isFullscreenActive()) return
      const availWidth = window.screen?.availWidth || window.innerWidth
      const availHeight = window.screen?.availHeight || window.innerHeight
      const widthRatio = availWidth > 0 ? window.innerWidth / availWidth : 1
      const heightRatio = availHeight > 0 ? window.innerHeight / availHeight : 1
      const looksUnmaximized = widthRatio < 0.92 || heightRatio < 0.88
      if (!looksUnmaximized) return

      logWindowUnmaximizeAttempt(
        'window_resize',
        {
          width_ratio: Number(widthRatio.toFixed(3)),
          height_ratio: Number(heightRatio.toFixed(3)),
          inner_width: window.innerWidth,
          inner_height: window.innerHeight,
          avail_width: availWidth,
          avail_height: availHeight,
        },
        { dedupe: true, dedupeWindowMs: 3000, suppressDuringFind: true, updateSummary: true }
      )
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      window.removeEventListener('resize', handleResize)
    }
  }, [focusEnabled, logWindowUnmaximizeAttempt, requestExamFullscreen])

  useEffect(() => {
    if (!focusEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        findIntentUntilRef.current = Date.now() + QUIZ_EXIT_BURST_WINDOW_MS
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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const renderAssessmentList = (showSelectionState: boolean) => {
    if (quizzes.length === 0) {
      return (
        <p className="text-text-muted text-center py-8">
          No {assessmentType === 'test' ? 'tests' : 'quizzes'} available.
        </p>
      )
    }

    return (
      <PageStack>
        {quizzes.map((quiz) => {
          const isSelected = selectedQuizId === quiz.id

          return (
            <button
              key={quiz.id}
              type="button"
              onClick={() => {
                void handleSelectQuiz(quiz.id)
              }}
              className={`block w-full rounded-card border px-5 py-4 text-left transition-[background-color,border-color,box-shadow,transform] ${
                showSelectionState && isSelected
                  ? 'border-primary bg-surface-accent ring-1 ring-primary/25 shadow-panel'
                  : 'border-border bg-surface-panel hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-text-default">{quiz.title}</h3>
                  {quiz.status === 'closed' && (
                    <p className="mt-1 text-sm text-text-muted">
                      This {isTestsView ? 'test' : 'quiz'} is closed
                    </p>
                  )}
                </div>
                {isTestsView ? (
                  <>
                    {quiz.student_status === 'can_view_results' ? (
                      <span className="rounded-badge bg-info-bg px-2.5 py-1 text-xs font-semibold text-info">
                        Returned
                      </span>
                    ) : quiz.status === 'closed' ? (
                      <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getQuizStatusBadgeClass('closed')}`}>
                        Closed
                      </span>
                    ) : quiz.student_status === 'responded' ? (
                      <span className="rounded-badge bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">
                        Submitted
                      </span>
                    ) : (
                      <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getQuizStatusBadgeClass('active')}`}>
                        New
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {quiz.student_status === 'not_started' && (
                      <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getQuizStatusBadgeClass('active')}`}>
                        New
                      </span>
                    )}
                    {quiz.student_status === 'responded' && (
                      <span className="rounded-badge bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">
                        Submitted
                      </span>
                    )}
                    {quiz.student_status === 'can_view_results' && (
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

  if (isTestsView) {
    const hasSelectedQuiz = selectedQuizId !== null && selectedQuiz !== null
    const hasResponded = hasSelectedQuiz && selectedQuiz.quiz.student_status !== 'not_started'
    const requiresStart =
      hasSelectedQuiz &&
      selectedQuiz.quiz.student_status === 'not_started' &&
      startedTestId !== selectedQuiz.quiz.id
    const isViewingResults =
      hasSelectedQuiz &&
      hasResponded &&
      selectedQuiz.quiz.student_status === 'can_view_results'
    const showCurrentTestInfoPanel = hasSelectedQuiz && focusEnabled
    const showDocPanel = showCurrentTestInfoPanel && activeDoc !== null
    const awayDurationLabel = formatDuration(focusSummary?.away_total_seconds ?? 0)
    const exitsCount = getQuizExitCount(focusSummary)
    const awayCount = focusSummary?.away_count ?? 0
    const routeExitAttempts = focusSummary?.route_exit_attempts ?? 0
    const windowUnmaximizeAttempts = focusSummary?.window_unmaximize_attempts ?? 0
    const showNotMaximizedWarning = showCurrentTestInfoPanel && !isFullscreen
    const iframeDocs = allowedDocs.filter((doc) => doc.source !== 'text' && Boolean(doc.url))
    const selectedTestTitle = hasSelectedQuiz ? selectedQuiz.quiz.title : ''
    const selectedTestPanelTitle = isViewingResults
      ? `${selectedTestTitle} Results`
      : selectedTestTitle
    const showSplitExamShell =
      hasSelectedQuiz &&
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

        {showNotMaximizedWarning ? (
          <PageContent className={showSplitExamShell ? 'flex-1 min-h-0 px-0 pt-1' : 'flex-1 min-h-0'}>
            <div aria-hidden="true" className="h-full" />
          </PageContent>
        ) : (
          <PageContent className={showSplitExamShell ? 'flex-1 min-h-0 px-0 pt-1' : 'flex-1 min-h-0'}>
            <div
              className={`mx-auto h-full w-full ${
                showSplitExamShell || !hasSelectedQuiz ? 'max-w-none' : 'max-w-3xl'
              }`}
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
                                    className="w-full justify-start"
                                    onClick={() => {
                                      markAllowedDocInteraction()
                                      setActiveDoc(doc)
                                    }}
                                    tabIndex={showDocPanel ? -1 : 0}
                                  >
                                    {doc.title}
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
                              <div
                                className="scrollbar-hover min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-2 p-3"
                                onMouseUp={handleTextDocPointerUp}
                                onKeyUp={handleTextDocPointerUp}
                              >
                                <pre className="whitespace-pre-wrap break-words text-sm text-text-default">
                                  {activeDoc.content || ''}
                                </pre>
                              </div>
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
                  >
                    {selectedQuizId && loadingQuiz ? (
                      <div className="flex justify-center py-12">
                        <Spinner size="lg" />
                      </div>
                    ) : hasSelectedQuiz ? (
                      <div className="space-y-4">
                        <h2 className="text-xl font-bold text-text-default">{selectedTestPanelTitle}</h2>

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
                            onClick={() => handleRequestStartTest(selectedQuiz.quiz.id)}
                          >
                            Start the Test
                          </Button>
                        ) : hasResponded && selectedQuiz.quiz.student_status === 'can_view_results' ? (
                          <StudentQuizResults
                            quizId={selectedQuizId!}
                            myResponses={selectedQuiz.studentResponses}
                            assessmentType={assessmentType}
                            apiBasePath={apiBasePath}
                            showSubmissionBanner={!(isTestsView && selectedQuiz.quiz.student_status === 'can_view_results')}
                          />
                        ) : hasResponded ? (
                          <div className="p-4 bg-success-bg rounded-lg text-center">
                            <p className="text-success font-medium">Response Submitted</p>
                            {selectedQuiz.quiz.status !== 'closed' ? (
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
                          <StudentQuizForm
                            quizId={selectedQuizId!}
                            questions={selectedQuiz.questions}
                            initialResponses={selectedQuiz.studentResponses}
                            enableDraftAutosave
                            isInteractionLocked={showNotMaximizedWarning}
                            assessmentType={assessmentType}
                            apiBasePath={apiBasePath}
                            onAvailabilityLoss={() => {
                              void revalidateActiveTestSession()
                            }}
                            onSubmitted={handleQuizSubmitted}
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
              ) : !hasSelectedQuiz ? (
                quizzes.length === 0 ? (
                  <EmptyState
                    title="No tests available."
                    description="When your teacher publishes a test, it will show up here."
                  />
                ) : (
                  <div className="min-w-0 h-full flex flex-col max-w-none">
                    {renderAssessmentList(false)}
                  </div>
                )
              ) : selectedQuizId && loadingQuiz ? (
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
                      {allowedDocs.length > 0 && requiresStart ? (
                        <p className="mt-1 text-sm text-text-muted">
                          {allowedDocs.length} reference document{allowedDocs.length === 1 ? '' : 's'} will be available during the test.
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={[
                        'rounded-badge px-2.5 py-1 text-xs font-semibold',
                        selectedQuiz?.quiz.student_status === 'can_view_results'
                          ? 'bg-info-bg text-info'
                          : selectedQuiz?.quiz.student_status === 'responded'
                            ? 'bg-surface-2 text-text-muted'
                            : selectedQuiz?.quiz.status === 'closed'
                              ? getQuizStatusBadgeClass('closed')
                              : getQuizStatusBadgeClass('active'),
                      ].join(' ')}
                    >
                      {selectedQuiz?.quiz.student_status === 'can_view_results'
                        ? 'Returned'
                        : selectedQuiz?.quiz.student_status === 'responded'
                          ? 'Submitted'
                          : selectedQuiz?.quiz.status === 'closed'
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
                          onClick={() => handleRequestStartTest(selectedQuiz.quiz.id)}
                        >
                          Start the Test
                        </Button>
                      </div>
                    </div>
                  ) : hasResponded && selectedQuiz.quiz.student_status === 'can_view_results' ? (
                    <StudentQuizResults
                      quizId={selectedQuizId!}
                      myResponses={selectedQuiz.studentResponses}
                      assessmentType={assessmentType}
                      apiBasePath={apiBasePath}
                      showSubmissionBanner={false}
                    />
                  ) : hasResponded ? (
                    <div className="rounded-card border border-success bg-success-bg p-5 text-center shadow-elevated">
                      <p className="font-medium text-success">Response Submitted</p>
                      {selectedQuiz.quiz.status !== 'closed' ? (
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
                    <StudentQuizForm
                      quizId={selectedQuizId!}
                      questions={selectedQuiz.questions}
                      initialResponses={selectedQuiz.studentResponses}
                      enableDraftAutosave
                      isInteractionLocked={showNotMaximizedWarning}
                      assessmentType={assessmentType}
                      apiBasePath={apiBasePath}
                      onSubmitted={handleQuizSubmitted}
                    />
                  )}
                </div>
              )}
            </div>
          </PageContent>
        )}

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

  // Loading quiz details
  if (selectedQuizId && loadingQuiz) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  // Quiz detail view (non-test assessments)
  if (selectedQuizId && selectedQuiz) {
    const hasResponded = selectedQuiz.quiz.student_status !== 'not_started'
    const assessmentLabel = 'quiz'
    const assessmentLabelPlural = 'quizzes'

    return (
      <PageLayout>
        <PageContent>
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-text-muted hover:text-text-default mb-4"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to {assessmentLabelPlural}
            </button>

            <h2 className="text-xl font-bold text-text-default mb-1">{selectedQuiz.quiz.title}</h2>

            {hasResponded && selectedQuiz.quiz.show_results && selectedQuiz.quiz.status === 'closed' ? (
              <StudentQuizResults
                quizId={selectedQuizId}
                myResponses={selectedQuiz.studentResponses}
                assessmentType={assessmentType}
                apiBasePath={apiBasePath}
              />
            ) : hasResponded ? (
              <div className="mt-6 p-4 bg-success-bg rounded-lg text-center">
                <p className="text-success font-medium">Response Submitted</p>
                {selectedQuiz.quiz.status !== 'closed' && selectedQuiz.quiz.show_results ? (
                  <p className="text-sm text-text-muted mt-1">
                    Results will be available after the {assessmentLabel} closes.
                  </p>
                ) : selectedQuiz.quiz.status === 'closed' && !selectedQuiz.quiz.show_results ? (
                  <p className="text-sm text-text-muted mt-1">
                    Results are not available for this {assessmentLabel}.
                  </p>
                ) : (
                  <p className="text-sm text-text-muted mt-1">
                    Your response has been recorded.
                  </p>
                )}
              </div>
            ) : (
              <StudentQuizForm
                quizId={selectedQuizId}
                questions={selectedQuiz.questions}
                initialResponses={selectedQuiz.studentResponses}
                enableDraftAutosave={isTestsView}
                assessmentType={assessmentType}
                apiBasePath={apiBasePath}
                onSubmitted={handleQuizSubmitted}
              />
            )}
          </div>
        </PageContent>
      </PageLayout>
    )
  }

  // Quiz list view (non-test assessments)
  return (
    <PageLayout>
      <PageContent>
        <div className="max-w-2xl mx-auto">
          {renderAssessmentList(false)}
        </div>
      </PageContent>
    </PageLayout>
  )
}
