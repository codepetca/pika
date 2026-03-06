'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ClockAlert, LogOut, Plus, Send } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Button, ConfirmDialog, Tooltip } from '@/ui'
import { useRightSidebar } from '@/components/layout'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { getQuizExitCount } from '@/lib/quizzes'
import { QuizModal } from '@/components/QuizModal'
import { QuizCard } from '@/components/QuizCard'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import type { Classroom, Quiz, QuizAssessmentType, QuizFocusSummary, QuizWithStats } from '@/types'

interface Props {
  classroom: Classroom
  assessmentType: QuizAssessmentType
  onSelectQuiz?: (quiz: QuizWithStats | null) => void
  testsSidebarClickToken?: number
  onTestGradingContextChange?: (context: {
    mode: 'authoring' | 'grading'
    testId: string | null
    studentId: string | null
    studentName: string | null
  }) => void
}

interface TestGradingStudentRow {
  student_id: string
  name: string | null
  email: string
  status: 'not_started' | 'in_progress' | 'submitted' | 'returned'
  submitted_at: string | null
  last_activity_at: string | null
  points_earned: number
  points_possible: number
  percent: number | null
  graded_open_responses: number
  ungraded_open_responses: number
  focus_summary: QuizFocusSummary | null
}

function formatTorontoTime(iso: string | null): { value: string; isPm: boolean } {
  if (!iso) return { value: '—', isPm: false }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const parts = formatter.formatToParts(new Date(iso))
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''
  const dayPeriod = (parts.find((part) => part.type === 'dayPeriod')?.value ?? '').toLowerCase()
  return {
    value: `${hour}:${minute}`,
    isPm: dayPeriod === 'pm',
  }
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

const STATUS_META: Record<
  TestGradingStudentRow['status'],
  { label: string; symbol: string; className: string }
> = {
  not_started: { label: 'Not started', symbol: '○', className: 'text-text-muted' },
  in_progress: { label: 'In progress', symbol: '◔', className: 'text-warning' },
  submitted: { label: 'Submitted', symbol: '●', className: 'text-success' },
  returned: { label: 'Returned', symbol: '✓', className: 'text-primary' },
}

export function TeacherQuizzesTab({
  classroom,
  assessmentType,
  onSelectQuiz,
  testsSidebarClickToken = 0,
  onTestGradingContextChange,
}: Props) {
  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleteQuiz, setDeleteQuiz] = useState<{ quiz: QuizWithStats; responsesCount: number } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingCreatedQuizId, setPendingCreatedQuizId] = useState<string | null>(null)

  const [testsMode, setTestsMode] = useState<'authoring' | 'grading'>('authoring')
  const [gradingStudents, setGradingStudents] = useState<TestGradingStudentRow[]>([])
  const [gradingLoading, setGradingLoading] = useState(false)
  const [gradingError, setGradingError] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [gradingInfo, setGradingInfo] = useState('')
  const [gradingWarning, setGradingWarning] = useState('')
  const [isBatchAutoGrading, setIsBatchAutoGrading] = useState(false)
  const [isBatchReturning, setIsBatchReturning] = useState(false)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)

  const { setOpen: setRightSidebarOpen } = useRightSidebar()

  const isReadOnly = !!classroom.archived_at
  const isTestsView = assessmentType === 'test'
  const apiBasePath = isTestsView ? '/api/teacher/tests' : '/api/teacher/quizzes'

  const sortedQuizzes = useMemo(() => [...quizzes].sort((a, b) => a.position - b.position), [quizzes])
  const gradingRowIds = useMemo(
    () => gradingStudents.map((student) => student.student_id),
    [gradingStudents]
  )
  const {
    selectedIds: batchSelectedIds,
    toggleSelect: toggleBatchSelect,
    toggleSelectAll: toggleBatchSelectAll,
    allSelected: batchAllSelected,
    clearSelection: clearBatchSelection,
    selectedCount: batchSelectedCount,
  } = useStudentSelection(gradingRowIds)

  const loadGradingRows = useCallback(async () => {
    if (!selectedQuizId) {
      setGradingStudents([])
      return
    }

    setGradingLoading(true)
    setGradingError('')
    try {
      const res = await fetch(`${apiBasePath}/${selectedQuizId}/results`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load test results')
      setGradingStudents((data.students || []) as TestGradingStudentRow[])
    } catch (err: any) {
      setGradingError(err.message || 'Failed to load test results')
      setGradingStudents([])
    } finally {
      setGradingLoading(false)
    }
  }, [apiBasePath, selectedQuizId])

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

  useEffect(() => {
    function handleQuizzesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (!detail || detail.classroomId !== classroom.id) return
      loadQuizzes()
    }
    window.addEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleQuizzesUpdated)
    return () => window.removeEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleQuizzesUpdated)
  }, [classroom.id, loadQuizzes])

  useEffect(() => {
    const selected = quizzes.find((q) => q.id === selectedQuizId) ?? null
    onSelectQuiz?.(selected)
  }, [selectedQuizId, quizzes, onSelectQuiz])

  useEffect(() => {
    if (!selectedQuizId) return
    if (quizzes.some((quiz) => quiz.id === selectedQuizId)) return
    setSelectedQuizId(null)
  }, [quizzes, selectedQuizId])

  useEffect(() => {
    if (!pendingCreatedQuizId) return
    if (!quizzes.some((quiz) => quiz.id === pendingCreatedQuizId)) return
    setSelectedQuizId(pendingCreatedQuizId)
    setPendingCreatedQuizId(null)
    setRightSidebarOpen(true)
  }, [pendingCreatedQuizId, quizzes, setRightSidebarOpen])

  useEffect(() => {
    if (!isTestsView || testsMode !== 'grading' || selectedQuizId || sortedQuizzes.length === 0) return
    setSelectedQuizId(sortedQuizzes[0].id)
  }, [isTestsView, testsMode, selectedQuizId, sortedQuizzes])

  useEffect(() => {
    if (!isTestsView) return
    setTestsMode('authoring')
    setSelectedStudentId(null)
    setGradingError('')
    setGradingWarning('')
    setGradingInfo('')
    clearBatchSelection()
  }, [clearBatchSelection, isTestsView, testsSidebarClickToken])

  useEffect(() => {
    if (!isTestsView || testsMode !== 'grading' || !selectedQuizId) {
      setGradingStudents([])
      setSelectedStudentId(null)
      setGradingError('')
      setGradingWarning('')
      setGradingInfo('')
      clearBatchSelection()
      return
    }

    void loadGradingRows()
  }, [clearBatchSelection, isTestsView, loadGradingRows, selectedQuizId, testsMode])

  useEffect(() => {
    if (!isTestsView || testsMode !== 'grading') {
      setSelectedStudentId(null)
      return
    }
    if (gradingStudents.length === 0) {
      setSelectedStudentId(null)
      return
    }
    if (!selectedStudentId || !gradingStudents.some((student) => student.student_id === selectedStudentId)) {
      setSelectedStudentId(gradingStudents[0].student_id)
    }
  }, [gradingStudents, isTestsView, selectedStudentId, testsMode])

  useEffect(() => {
    if (!isTestsView || !onTestGradingContextChange) return

    if (testsMode === 'authoring') {
      onTestGradingContextChange({
        mode: 'authoring',
        testId: selectedQuizId,
        studentId: null,
        studentName: null,
      })
      return
    }

    const selectedStudent = gradingStudents.find((student) => student.student_id === selectedStudentId) || null
    onTestGradingContextChange({
      mode: 'grading',
      testId: selectedQuizId,
      studentId: selectedStudent?.student_id || null,
      studentName: selectedStudent?.name || selectedStudent?.email || null,
    })
  }, [
    gradingStudents,
    isTestsView,
    onTestGradingContextChange,
    selectedQuizId,
    selectedStudentId,
    testsMode,
  ])

  useEffect(() => {
    if (!gradingWarning) return
    if (batchSelectedCount > 0) {
      setGradingWarning('')
      return
    }
    const timer = window.setTimeout(() => setGradingWarning(''), 3000)
    return () => window.clearTimeout(timer)
  }, [batchSelectedCount, gradingWarning])

  useEffect(() => {
    if (!gradingInfo) return
    const timer = window.setTimeout(() => setGradingInfo(''), 4000)
    return () => window.clearTimeout(timer)
  }, [gradingInfo])

  async function handleBatchAutoGrade() {
    if (!selectedQuizId || batchSelectedCount === 0) return

    setIsBatchAutoGrading(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const res = await fetch(`${apiBasePath}/${selectedQuizId}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Auto-grade failed')

      const gradedStudents = Number(data.graded_students ?? 0)
      const skippedStudents = Number(data.skipped_students ?? 0)
      const summary = `AI graded ${gradedStudents} student${gradedStudents === 1 ? '' : 's'}${skippedStudents > 0 ? ` • ${skippedStudents} skipped` : ''}`
      setGradingInfo(summary)

      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setGradingError(data.errors.slice(0, 3).join(' · '))
      }

      clearBatchSelection()
      await loadGradingRows()
    } catch (err: any) {
      setGradingError(err.message || 'Auto-grade failed')
    } finally {
      setIsBatchAutoGrading(false)
    }
  }

  async function handleBatchReturn(options?: { closeTest?: boolean }) {
    if (!selectedQuizId || batchSelectedCount === 0) return

    setIsBatchReturning(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const res = await fetch(`${apiBasePath}/${selectedQuizId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_ids: Array.from(batchSelectedIds),
          close_test: options?.closeTest === true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Return failed')

      const returnedCount = Number(data.returned_count ?? 0)
      const skippedCount = Number(data.skipped_count ?? 0)
      setGradingInfo(
        `Returned ${returnedCount} student${returnedCount === 1 ? '' : 's'}${skippedCount > 0 ? ` • ${skippedCount} skipped` : ''}`
      )

      clearBatchSelection()
      setShowReturnConfirm(false)
      if (data.test_closed) {
        await loadQuizzes()
      }
      await loadGradingRows()
    } catch (err: any) {
      setGradingError(err.message || 'Return failed')
    } finally {
      setIsBatchReturning(false)
    }
  }

  function handleCardSelect(quiz: QuizWithStats) {
    const newSelectedId = selectedQuizId === quiz.id ? null : quiz.id
    setSelectedQuizId(newSelectedId)
    if (newSelectedId) {
      setRightSidebarOpen(true)
    }
  }

  function handleNewQuiz() {
    setShowModal(true)
  }

  function handleQuizCreated(quiz: Quiz) {
    setShowModal(false)
    if (isTestsView) {
      setTestsMode('authoring')
      setPendingCreatedQuizId(quiz.id)
    }
    window.dispatchEvent(
      new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
    )
  }

  async function handleDeleteConfirm() {
    if (!deleteQuiz) return
    setDeleting(true)
    try {
      const res = await fetch(`${apiBasePath}/${deleteQuiz.quiz.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete quiz')
      }
      if (selectedQuizId === deleteQuiz.quiz.id) {
        setSelectedQuizId(null)
      }
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
      )
    } catch (err) {
      console.error('Error deleting quiz:', err)
    } finally {
      setDeleting(false)
      setDeleteQuiz(null)
    }
  }

  async function handleRequestDelete(quiz: QuizWithStats) {
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}/results`)
      const data = await res.json()
      setDeleteQuiz({ quiz, responsesCount: data.stats?.responded || 0 })
    } catch {
      setDeleteQuiz({ quiz, responsesCount: quiz.stats.responded })
    }
  }

  const assessmentLabel = isTestsView ? 'test' : 'quiz'
  const assessmentLabelPlural = isTestsView ? 'Tests' : 'Quizzes'
  const selectedTest = sortedQuizzes.find((quiz) => quiz.id === selectedQuizId) || null
  const selectedTestTitle = selectedTest?.title || 'No test selected'
  const returnWillCloseActiveTest = isTestsView && testsMode === 'grading' && selectedTest?.status === 'active'

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!isReadOnly && (!isTestsView || testsMode === 'authoring') && (
                <Button onClick={handleNewQuiz} variant="primary" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  {isTestsView ? 'New Test' : 'New Quiz'}
                </Button>
              )}
              {isTestsView && testsMode === 'grading' ? (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  <span className="font-medium text-text-default">{selectedTestTitle}</span>
                </div>
              ) : null}
              {isTestsView && testsMode === 'grading' && !isReadOnly ? (
                <>
                  <Tooltip
                    content={
                      batchSelectedCount > 0
                        ? `AI grade (${batchSelectedCount})`
                        : 'Select students to grade'
                    }
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={batchSelectedCount === 0 ? 'h-8 w-8 p-0 opacity-60' : 'h-8 w-8 p-0'}
                      aria-label={batchSelectedCount > 0 ? `AI grade ${batchSelectedCount} selected` : 'AI grade selected students'}
                      disabled={isBatchAutoGrading || isBatchReturning}
                      onClick={() => {
                        if (batchSelectedCount === 0) {
                          setGradingWarning('Select students to grade')
                          return
                        }
                        void handleBatchAutoGrade()
                      }}
                    >
                      <Check className="h-4 w-4 text-primary" />
                    </Button>
                  </Tooltip>
                  <Tooltip
                    content={
                      batchSelectedCount > 0
                        ? `Return (${batchSelectedCount})`
                        : 'Select students to return'
                    }
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={batchSelectedCount === 0 ? 'h-8 w-8 p-0 opacity-60' : 'h-8 w-8 p-0'}
                      aria-label={batchSelectedCount > 0 ? `Return ${batchSelectedCount} selected tests` : 'Return selected tests'}
                      disabled={isBatchAutoGrading || isBatchReturning}
                      onClick={() => {
                        if (batchSelectedCount === 0) {
                          setGradingWarning('Select students to return')
                          return
                        }
                        setShowReturnConfirm(true)
                      }}
                    >
                      <Send className="h-4 w-4 text-primary" />
                    </Button>
                  </Tooltip>
                </>
              ) : null}
            </div>

            {isTestsView ? (
              <div className="inline-flex rounded-md border border-border bg-surface p-0.5 ml-auto">
                <button
                  type="button"
                  onClick={() => setTestsMode('authoring')}
                  className={[
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    testsMode === 'authoring'
                      ? 'bg-primary text-text-inverse'
                      : 'text-text-muted hover:text-text-default',
                  ].join(' ')}
                >
                  Authoring
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTestsMode('grading')
                    setRightSidebarOpen(true)
                  }}
                  className={[
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    testsMode === 'grading'
                      ? 'bg-primary text-text-inverse'
                      : 'text-text-muted hover:text-text-default',
                  ].join(' ')}
                >
                  Grading
                </button>
              </div>
            ) : null}
          </div>
        }
      />

      <PageContent>
        {gradingError && isTestsView && testsMode === 'grading' && (
          <div className="mb-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {gradingError}
          </div>
        )}
        {gradingWarning && isTestsView && testsMode === 'grading' && (
          <div className="mb-3 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            {gradingWarning}
          </div>
        )}
        {gradingInfo && isTestsView && testsMode === 'grading' && (
          <div className="mb-3 rounded-md border border-primary bg-info-bg px-3 py-2 text-sm text-info">
            {gradingInfo}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : sortedQuizzes.length === 0 ? (
          <p className="text-text-muted text-center py-8">
            No {assessmentLabelPlural.toLowerCase()} yet. Create one to get started.
          </p>
        ) : isTestsView && testsMode === 'grading' ? (
          <div className="space-y-3">
            {gradingLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : gradingStudents.length === 0 ? (
              <p className="text-sm text-text-muted">No student rows available for this test.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-hover text-left text-text-muted">
                      <th className="w-10 px-3 py-2 font-medium">
                        <input
                          type="checkbox"
                          checked={batchAllSelected}
                          onChange={toggleBatchSelectAll}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                          aria-label="Select all students"
                        />
                      </th>
                      <th className="px-3 py-2 font-medium">Student</th>
                      <th className="w-8 px-2 py-2 font-medium" aria-label="Status" />
                      <th className="px-3 py-2 font-medium">Score</th>
                      <th className="px-3 py-2 font-medium">
                        <Tooltip content="Most recent recorded in-test activity time (Toronto).">
                          <span className="cursor-help">Last</span>
                        </Tooltip>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Tooltip
                          content={
                            <div className="space-y-0.5">
                              <p className="font-medium">Exits = combined count</p>
                              <p>Away/focus events</p>
                              <p>In-app exits</p>
                              <p>Window/full-screen exits</p>
                            </div>
                          }
                        >
                          <span className="inline-flex cursor-help items-center" aria-label="Exits column">
                            <LogOut className="h-4 w-4" />
                          </span>
                        </Tooltip>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Tooltip content="Total time this student was away from the test route.">
                          <span className="inline-flex cursor-help items-center" aria-label="Away column">
                            <ClockAlert className="h-4 w-4" />
                          </span>
                        </Tooltip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradingStudents.map((student) => {
                      const isSelected = student.student_id === selectedStudentId
                      const scoreLabel =
                        student.status === 'not_started'
                          ? '—'
                          : `${formatPoints(student.points_earned)}/${formatPoints(student.points_possible)}`
                      const statusMeta = STATUS_META[student.status]
                      const awayCount = student.focus_summary?.away_count ?? 0
                      const awaySeconds = student.focus_summary?.away_total_seconds ?? 0
                      const awayMinutes = Math.floor(awaySeconds / 60)
                      const awayRemainder = awaySeconds % 60
                      const awayLabel = `${awayMinutes}:${String(awayRemainder).padStart(2, '0')}`
                      const routeExitAttempts = student.focus_summary?.route_exit_attempts ?? 0
                      const windowUnmaximizeAttempts =
                        student.focus_summary?.window_unmaximize_attempts ?? 0
                      const exitsCount = getQuizExitCount(student.focus_summary)
                      const formattedLastActivity = formatTorontoTime(student.last_activity_at)

                      return (
                        <tr
                          key={student.student_id}
                          className={[
                            'cursor-pointer border-t border-border transition-colors hover:bg-surface-hover',
                            isSelected ? 'bg-primary/10' : '',
                          ].join(' ')}
                          onClick={() => {
                            setSelectedStudentId(student.student_id)
                            setRightSidebarOpen(true)
                          }}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={batchSelectedIds.has(student.student_id)}
                              onChange={() => toggleBatchSelect(student.student_id)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              aria-label={`Select ${student.name || 'student'}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-text-default">{student.name || 'Student'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Tooltip content={statusMeta.label}>
                              <span
                                className={`inline-flex min-w-5 cursor-help items-center justify-center text-sm font-semibold ${statusMeta.className}`}
                                aria-label={statusMeta.label}
                              >
                                {statusMeta.symbol}
                              </span>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-2 text-text-default">{scoreLabel}</td>
                          <td
                            className={[
                              'px-3 py-2 tabular-nums',
                              formattedLastActivity.isPm ? 'font-semibold text-text-default' : 'text-text-muted',
                            ].join(' ')}
                          >
                            <Tooltip content="Most recent recorded in-test activity time (Toronto).">
                              <span
                                className={[
                                  'cursor-help',
                                  formattedLastActivity.isPm ? 'font-semibold text-text-default' : 'text-text-muted',
                                ].join(' ')}
                              >
                                {formattedLastActivity.value}
                              </span>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted tabular-nums">
                            <Tooltip
                              content={
                                <div className="space-y-0.5">
                                  <p className="font-medium">Exits: {exitsCount}</p>
                                  <p>Away/focus: {awayCount}</p>
                                  <p>In-app exits: {routeExitAttempts}</p>
                                  <p>Window exits: {windowUnmaximizeAttempts}</p>
                                </div>
                              }
                            >
                              <span
                                className="cursor-help"
                                aria-label={`Exits ${exitsCount}. Away/focus ${awayCount}, in-app exits ${routeExitAttempts}, window/full-screen exits ${windowUnmaximizeAttempts}.`}
                              >
                                {exitsCount}
                              </span>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted tabular-nums">
                            <Tooltip
                              content={`Away from test route for ${awayLabel} total.`}
                            >
                              <span
                                className="cursor-help"
                                aria-label={`Away time ${awayLabel}. Away from test route for ${awayLabel} total.`}
                              >
                                {awayLabel}
                              </span>
                            </Tooltip>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedQuizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                apiBasePath={apiBasePath}
                isSelected={selectedQuizId === quiz.id}
                isReadOnly={isReadOnly}
                onSelect={() => handleCardSelect(quiz)}
                onDelete={() => handleRequestDelete(quiz)}
                onQuizUpdate={loadQuizzes}
              />
            ))}
          </div>
        )}
      </PageContent>

      <QuizModal
        isOpen={showModal}
        classroomId={classroom.id}
        assessmentType={assessmentType}
        apiBasePath={apiBasePath}
        quiz={null}
        onClose={() => setShowModal(false)}
        onSuccess={handleQuizCreated}
      />

      <ConfirmDialog
        isOpen={!!deleteQuiz}
        title={`Delete ${assessmentLabel}?`}
        description={
          deleteQuiz && deleteQuiz.responsesCount > 0
            ? `This ${assessmentLabel} has ${deleteQuiz.responsesCount} response${deleteQuiz.responsesCount === 1 ? '' : 's'}. Deleting it will permanently remove all student responses.`
            : 'This action cannot be undone.'
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={deleting}
        isCancelDisabled={deleting}
        onCancel={() => setDeleteQuiz(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ConfirmDialog
        isOpen={showReturnConfirm}
        title={
          returnWillCloseActiveTest
            ? `Close test and return work to ${batchSelectedCount} selected student(s)?`
            : `Return test work to ${batchSelectedCount} selected student(s)?`
        }
        description={
          returnWillCloseActiveTest
            ? 'This test is still open. Confirming will close it for all students before returning selected work.'
            : 'Only students with fully graded open-response questions will be returned.'
        }
        confirmLabel={
          isBatchReturning
            ? returnWillCloseActiveTest
              ? 'Closing and Returning...'
              : 'Returning...'
            : returnWillCloseActiveTest
              ? 'Close and Return'
              : 'Return Test'
        }
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchReturning}
        isCancelDisabled={isBatchReturning}
        onCancel={() => setShowReturnConfirm(false)}
        onConfirm={() => {
          void handleBatchReturn({ closeTest: returnWillCloseActiveTest })
        }}
      />
    </PageLayout>
  )
}
