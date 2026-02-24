'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { Spinner } from '@/components/Spinner'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { getQuizStatusBadgeClass } from '@/lib/quizzes'
import { StudentQuizForm } from '@/components/StudentQuizForm'
import { StudentQuizResults } from '@/components/StudentQuizResults'
import type {
  Classroom,
  QuizAssessmentType,
  QuizFocusSummary,
  QuizQuestion,
  StudentQuizView,
  TestResponseDraftValue,
} from '@/types'

interface Props {
  classroom: Classroom
  assessmentType: QuizAssessmentType
}

type RouteExitSource = 'back_button' | 'pagehide' | 'component_unmount'

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function createFocusSessionId(): string {
  return `focus_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function StudentQuizzesTab({ classroom, assessmentType }: Props) {
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
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const selectedQuizIdRef = useRef<string | null>(null)
  const focusSessionIdRef = useRef<string | null>(null)
  const awayStartedAtRef = useRef<number | null>(null)
  const focusEnabledRef = useRef(false)
  const routeExitLoggedRef = useRef(false)
  const isTestsView = assessmentType === 'test'
  const apiBasePath = isTestsView ? '/api/student/tests' : '/api/student/quizzes'
  const focusEnabled = useMemo(() => {
    if (!selectedQuiz) return false
    const hasSubmitted = selectedQuiz.quiz.student_status !== 'not_started'
    return isTestsView && !hasSubmitted
  }, [isTestsView, selectedQuiz])

  useEffect(() => {
    selectedQuizIdRef.current = selectedQuizId
  }, [selectedQuizId])

  useEffect(() => {
    focusEnabledRef.current = focusEnabled
  }, [focusEnabled])

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

  async function handleSelectQuiz(quizId: string) {
    setSelectedQuizId(quizId)
    setLoadingQuiz(true)
    focusSessionIdRef.current = createFocusSessionId()
    awayStartedAtRef.current = null
    routeExitLoggedRef.current = false

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

  const postFocusEvent = useCallback(async (
    eventType: 'away_start' | 'away_end' | 'route_exit_attempt',
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

  const logRouteExitAttempt = useCallback((source: RouteExitSource) => {
    if (routeExitLoggedRef.current) return
    routeExitLoggedRef.current = true
    void postFocusEvent(
      'route_exit_attempt',
      { source },
      { updateSummary: false }
    )
  }, [postFocusEvent])

  function handleBack() {
    if (focusEnabled) {
      logRouteExitAttempt('back_button')
    }
    setSelectedQuizId(null)
    setSelectedQuiz(null)
    setFocusSummary(null)
    focusSessionIdRef.current = null
    awayStartedAtRef.current = null
    loadQuizzes() // Refresh list to get updated status
  }

  function handleQuizSubmitted() {
    if (isTestsView) {
      notifications?.clearActiveTestsCount()
    } else {
      notifications?.clearActiveQuizzesCount()
    }
    // Reload the quiz to get updated status
    if (selectedQuizId) {
      handleSelectQuiz(selectedQuizId)
    }
  }

  useEffect(() => {
    if (!focusEnabled) return

    const handlePageHide = () => {
      logRouteExitAttempt('pagehide')
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [focusEnabled, logRouteExitAttempt])

  useEffect(() => {
    if (!focusEnabled) return

    const startAway = (source: 'visibility' | 'blur') => {
      if (awayStartedAtRef.current !== null) return
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
  }, [focusEnabled, postFocusEvent])

  useEffect(() => {
    return () => {
      if (!focusEnabledRef.current) return
      logRouteExitAttempt('component_unmount')
    }
  }, [logRouteExitAttempt])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
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

  // Quiz Detail View
  if (selectedQuizId && selectedQuiz) {
    const hasResponded = selectedQuiz.quiz.student_status !== 'not_started'
    const isTest = isTestsView
    const assessmentLabel = isTest ? 'test' : 'quiz'
    const assessmentLabelPlural = isTest ? 'tests' : 'quizzes'

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
            {isTest && (
              <p className="mb-4 text-sm text-text-muted">
                Focus events: {focusSummary?.away_count ?? 0} · Away time:{' '}
                {formatDuration(focusSummary?.away_total_seconds ?? 0)}
                {(focusSummary?.route_exit_attempts ?? 0) > 0
                  ? ` · Exit attempts: ${focusSummary?.route_exit_attempts ?? 0}`
                  : ''}
              </p>
            )}

            {hasResponded && selectedQuiz.quiz.show_results && selectedQuiz.quiz.status === 'closed' ? (
              <StudentQuizResults
                quizId={selectedQuizId}
                myResponses={selectedQuiz.studentResponses}
                assessmentType={assessmentType}
                apiBasePath={apiBasePath}
              />
            ) : hasResponded ? (
              <div className="mt-6 p-4 bg-success-bg rounded-lg text-center">
                <p className="text-success font-medium">You have submitted your response.</p>
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

  // Quiz List View
  return (
    <PageLayout>
      <PageContent>
        <div className="max-w-2xl mx-auto">
          {quizzes.length === 0 ? (
            <p className="text-text-muted text-center py-8">
              No {assessmentType === 'test' ? 'tests' : 'quizzes'} available.
            </p>
          ) : (
            <div className="space-y-3">
              {quizzes.map((quiz) => (
                <button
                  key={quiz.id}
                  type="button"
                  onClick={() => handleSelectQuiz(quiz.id)}
                  className="w-full text-left p-4 rounded-lg border border-border bg-surface hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-text-default">{quiz.title}</h3>
                    {quiz.student_status === 'not_started' && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getQuizStatusBadgeClass('active')}`}>
                        New
                      </span>
                    )}
                    {quiz.student_status === 'responded' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-text-muted">
                        Submitted
                      </span>
                    )}
                    {quiz.student_status === 'can_view_results' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-info-bg text-info">
                        View Results
                      </span>
                    )}
                  </div>
                  {quiz.status === 'closed' && (
                    <p className="text-xs text-text-muted mt-1">
                      This {isTestsView ? 'test' : 'quiz'} is closed
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </PageLayout>
  )
}
