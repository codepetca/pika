'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Circle, ClockAlert, LogOut, Plus, Send } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { Button, ConfirmDialog, DialogPanel, FormField, Select, Tooltip } from '@/ui'
import { useRightSidebar } from '@/components/layout'
import {
  TEACHER_QUIZZES_UPDATED_EVENT,
  TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
  type TeacherTestGradingRowUpdatedEventDetail,
} from '@/lib/events'
import { getQuizExitCount } from '@/lib/quizzes'
import { compareByNameFields } from '@/lib/table-sort'
import { QuizModal } from '@/components/QuizModal'
import { QuizCard } from '@/components/QuizCard'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import type { Classroom, Quiz, QuizAssessmentType, QuizFocusSummary, QuizWithStats } from '@/types'

interface Props {
  classroom: Classroom
  assessmentType: QuizAssessmentType
  onSelectQuiz?: (quiz: QuizWithStats | null) => void
  testsSidebarClickToken?: number
  onTestGradingDataRefresh?: () => void
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
  first_name: string | null
  last_name: string | null
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

interface TestGradingQuestionSummary {
  id: string
  questionType: 'multiple_choice' | 'open_response'
  responseMonospace: boolean
}

type TestGradingSortColumn = 'first_name' | 'last_name'
type TestAiGradingStrategy = 'balanced' | 'aggressive_batch'

const TEST_AI_GRADING_STRATEGY_OPTIONS = [
  { value: 'balanced', label: 'Balanced (Recommended)' },
  { value: 'aggressive_batch', label: 'Aggressive Batch (Experimental)' },
]

function splitDisplayName(name: string | null): { firstName: string | null; lastName: string | null } {
  const trimmed = (name || '').trim()
  if (!trimmed) return { firstName: null, lastName: null }

  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: null }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function getSortableNameParts(student: TestGradingStudentRow): { firstName: string | null; lastName: string | null } {
  const firstName = (student.first_name || '').trim()
  const lastName = (student.last_name || '').trim()
  if (firstName || lastName) {
    return {
      firstName: firstName || null,
      lastName: lastName || null,
    }
  }

  return splitDisplayName(student.name)
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

function summarizeBatchAutoGradeErrors(rawErrors: unknown): string {
  if (!Array.isArray(rawErrors)) return ''

  const counts = new Map<string, number>()
  for (const rawError of rawErrors) {
    if (typeof rawError !== 'string') continue
    const trimmed = rawError.trim()
    if (!trimmed) continue

    const separatorIndex = trimmed.indexOf(': ')
    const message = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 2).trim() : trimmed
    if (!message) continue

    counts.set(message, (counts.get(message) || 0) + 1)
  }

  if (counts.size === 0) return ''

  return Array.from(counts.entries())
    .slice(0, 3)
    .map(([message, count]) => (count > 1 ? `${count} students: ${message}` : message))
    .join(' · ')
}

const STATUS_META: Record<
  TestGradingStudentRow['status'],
  { label: string; icon: typeof Circle; className: string }
> = {
  not_started: { label: 'Not started', icon: Circle, className: 'text-gray-400' },
  in_progress: { label: 'In progress', icon: Circle, className: 'text-yellow-500' },
  submitted: { label: 'Submitted', icon: Check, className: 'text-green-500' },
  returned: { label: 'Returned', icon: Send, className: 'text-blue-500' },
}

export function TeacherQuizzesTab({
  classroom,
  assessmentType,
  onSelectQuiz,
  testsSidebarClickToken = 0,
  onTestGradingDataRefresh,
  onTestGradingContextChange,
}: Props) {
  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [pendingCreatedQuizId, setPendingCreatedQuizId] = useState<string | null>(null)

  const [testsMode, setTestsMode] = useState<'authoring' | 'grading'>('authoring')
  const [gradingStudents, setGradingStudents] = useState<TestGradingStudentRow[]>([])
  const [gradingQuestions, setGradingQuestions] = useState<TestGradingQuestionSummary[]>([])
  const [gradingLoading, setGradingLoading] = useState(false)
  const [gradingError, setGradingError] = useState('')
  const [gradingSortColumn, setGradingSortColumn] = useState<TestGradingSortColumn>('last_name')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [gradingInfo, setGradingInfo] = useState('')
  const [gradingWarning, setGradingWarning] = useState('')
  const [isBatchAutoGrading, setIsBatchAutoGrading] = useState(false)
  const [isBatchReturning, setIsBatchReturning] = useState(false)
  const [isBatchClearingOpenGrades, setIsBatchClearingOpenGrades] = useState(false)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)
  const [showClearOpenGradesConfirm, setShowClearOpenGradesConfirm] = useState(false)
  const [showBatchGradeModal, setShowBatchGradeModal] = useState(false)
  const [showPromptGuidelineModal, setShowPromptGuidelineModal] = useState(false)
  const [batchPromptGuideline, setBatchPromptGuideline] = useState('')
  const [batchPromptGuidelineDraft, setBatchPromptGuidelineDraft] = useState('')
  const [batchGradingStrategy, setBatchGradingStrategy] = useState<TestAiGradingStrategy>('balanced')
  const [batchGradingStrategyDraft, setBatchGradingStrategyDraft] =
    useState<TestAiGradingStrategy>('balanced')

  const { setOpen: setRightSidebarOpen } = useRightSidebar()

  const isReadOnly = !!classroom.archived_at
  const isTestsView = assessmentType === 'test'
  const apiBasePath = isTestsView ? '/api/teacher/tests' : '/api/teacher/quizzes'

  const sortedGradingStudents = useMemo(
    () =>
      [...gradingStudents].sort((a, b) => {
        const aNameParts = getSortableNameParts(a)
        const bNameParts = getSortableNameParts(b)
        return compareByNameFields(
          {
            firstName: aNameParts.firstName,
            lastName: aNameParts.lastName,
            id: a.email || a.student_id,
          },
          {
            firstName: bNameParts.firstName,
            lastName: bNameParts.lastName,
            id: b.email || b.student_id,
          },
          gradingSortColumn,
          'asc'
        )
      }),
    [gradingSortColumn, gradingStudents]
  )
  const gradingRowIds = useMemo(
    () => sortedGradingStudents.map((student) => student.student_id),
    [sortedGradingStudents]
  )
  const {
    selectedIds: batchSelectedIds,
    toggleSelect: toggleBatchSelect,
    toggleSelectAll: toggleBatchSelectAll,
    allSelected: batchAllSelected,
    clearSelection: clearBatchSelection,
    selectedCount: batchSelectedCount,
  } = useStudentSelection(gradingRowIds)
  const batchSelectedStudents = useMemo(
    () => sortedGradingStudents.filter((student) => batchSelectedIds.has(student.student_id)),
    [batchSelectedIds, sortedGradingStudents]
  )
  const batchSelectedStudentIds = useMemo(
    () => batchSelectedStudents.map((student) => student.student_id),
    [batchSelectedStudents]
  )
  const batchAutoGradePreflight = useMemo(() => {
    const selectedCount = batchSelectedStudents.length
    const ungradedResponses = batchSelectedStudents.reduce(
      (sum, student) => sum + student.ungraded_open_responses,
      0
    )
    const gradedResponses = batchSelectedStudents.reduce(
      (sum, student) => sum + student.graded_open_responses,
      0
    )
    const codeQuestions = gradingQuestions.filter(
      (question) => question.questionType === 'open_response' && question.responseMonospace
    ).length
    const regularQuestions = gradingQuestions.filter(
      (question) => question.questionType === 'open_response' && !question.responseMonospace
    ).length

    return {
      selectedCount,
      ungradedResponses,
      gradedResponses,
      codeQuestions,
      regularQuestions,
      potentialAiSends: ungradedResponses,
    }
  }, [batchSelectedStudents, gradingQuestions])

  const loadGradingRows = useCallback(async () => {
    if (!selectedQuizId) {
      setGradingStudents([])
      setGradingQuestions([])
      return
    }

    setGradingLoading(true)
    setGradingError('')
    try {
      const res = await fetch(`${apiBasePath}/${selectedQuizId}/results`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load test results')
      setGradingStudents((data.students || []) as TestGradingStudentRow[])
      setGradingQuestions(
        Array.isArray(data.questions)
          ? data.questions.map((question: any) => ({
              id: String(question.id),
              questionType:
                question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
              responseMonospace: question.response_monospace === true,
            }))
          : []
      )
    } catch (err: any) {
      setGradingError(err.message || 'Failed to load test results')
      setGradingStudents([])
      setGradingQuestions([])
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
    if (!isTestsView || testsMode !== 'grading' || selectedQuizId || quizzes.length === 0) return
    setSelectedQuizId(quizzes[0].id)
  }, [isTestsView, quizzes, testsMode, selectedQuizId])

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
      setGradingQuestions([])
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
    function handleGradingRowUpdate(event: Event) {
      if (!isTestsView || testsMode !== 'grading' || !selectedQuizId) return

      const detail = (event as CustomEvent<TeacherTestGradingRowUpdatedEventDetail>).detail
      if (!detail || detail.testId !== selectedQuizId) return

      setGradingStudents((prev) =>
        prev.map((student) => {
          if (student.student_id !== detail.studentId) return student
          return {
            ...student,
            points_earned: detail.pointsEarned,
            points_possible: detail.pointsPossible,
            percent: detail.percent,
            graded_open_responses: detail.gradedOpenResponses,
            ungraded_open_responses: detail.ungradedOpenResponses,
          }
        })
      )
    }

    window.addEventListener(TEACHER_TEST_GRADING_ROW_UPDATED_EVENT, handleGradingRowUpdate)
    return () => window.removeEventListener(TEACHER_TEST_GRADING_ROW_UPDATED_EVENT, handleGradingRowUpdate)
  }, [isTestsView, selectedQuizId, testsMode])

  useEffect(() => {
    if (!isTestsView || testsMode !== 'grading') {
      setSelectedStudentId(null)
      return
    }
    if (sortedGradingStudents.length === 0) {
      setSelectedStudentId(null)
      return
    }
    if (
      !selectedStudentId ||
      !sortedGradingStudents.some((student) => student.student_id === selectedStudentId)
    ) {
      setSelectedStudentId(sortedGradingStudents[0].student_id)
    }
  }, [isTestsView, selectedStudentId, sortedGradingStudents, testsMode])

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

  async function handleBatchAutoGrade(options?: {
    studentIds?: string[]
    preserveSelection?: boolean
    infoPrefix?: string
  }) {
    const targetStudentIds = options?.studentIds || batchSelectedStudentIds
    if (!selectedQuizId || targetStudentIds.length === 0) return

    setIsBatchAutoGrading(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const res = await fetch(`${apiBasePath}/${selectedQuizId}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_ids: targetStudentIds,
          grading_strategy: batchGradingStrategy,
          ...(batchPromptGuideline.trim()
            ? { prompt_guideline: batchPromptGuideline.trim() }
            : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Auto-grade failed')

      const gradedStudents = Number(data.graded_students ?? 0)
      const skippedStudents = Number(data.skipped_students ?? 0)
      const errorSummary = summarizeBatchAutoGradeErrors(data.errors)
      const summaryPrefix = options?.infoPrefix || 'AI graded'
      const summary = `${summaryPrefix} ${gradedStudents} student${gradedStudents === 1 ? '' : 's'}${skippedStudents > 0 ? ` • ${skippedStudents} skipped` : ''}`
      setGradingInfo(summary)

      if (!options?.preserveSelection) {
        clearBatchSelection()
      }
      await loadGradingRows()
      onTestGradingDataRefresh?.()
      if (errorSummary) {
        setGradingError(errorSummary)
      }
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

  async function handleBatchClearOpenGrades() {
    if (!selectedQuizId || batchSelectedCount === 0) return

    setIsBatchClearingOpenGrades(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const res = await fetch(`${apiBasePath}/${selectedQuizId}/clear-open-grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Clear open grades failed')

      const clearedStudents = Number(data.cleared_students ?? 0)
      const skippedStudents = Number(data.skipped_students ?? 0)
      const clearedResponses = Number(data.cleared_responses ?? 0)
      setGradingInfo(
        `Cleared ${clearedResponses} open response${clearedResponses === 1 ? '' : 's'} across ${clearedStudents} student${clearedStudents === 1 ? '' : 's'}${skippedStudents > 0 ? ` • ${skippedStudents} skipped` : ''}`
      )

      clearBatchSelection()
      setShowClearOpenGradesConfirm(false)
      await loadGradingRows()
      onTestGradingDataRefresh?.()
    } catch (err: any) {
      setGradingError(err.message || 'Clear open grades failed')
    } finally {
      setIsBatchClearingOpenGrades(false)
    }
  }

  function openBatchPromptGuidelineModal() {
    setBatchPromptGuidelineDraft(batchPromptGuideline)
    setBatchGradingStrategyDraft(batchGradingStrategy)
    setShowPromptGuidelineModal(true)
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

  const assessmentLabelPlural = isTestsView ? 'Tests' : 'Quizzes'
  const selectedTest = quizzes.find((quiz) => quiz.id === selectedQuizId) || null
  const selectedTestTitle = selectedTest?.title || 'No test selected'
  const returnWillCloseActiveTest = isTestsView && testsMode === 'grading' && selectedTest?.status === 'active'
  const batchGradeDescriptionParts: string[] = []
  if (batchAutoGradePreflight.selectedCount > 0) {
    const questionBreakdown: string[] = []
    if (batchAutoGradePreflight.codeQuestions > 0) {
      questionBreakdown.push(
        `${batchAutoGradePreflight.codeQuestions} code question${batchAutoGradePreflight.codeQuestions === 1 ? '' : 's'}`
      )
    }
    if (batchAutoGradePreflight.regularQuestions > 0) {
      questionBreakdown.push(
        `${batchAutoGradePreflight.regularQuestions} regular question${batchAutoGradePreflight.regularQuestions === 1 ? '' : 's'}`
      )
    }

    if (questionBreakdown.length > 0) {
      batchGradeDescriptionParts.push(
        `This will grade ${batchAutoGradePreflight.selectedCount} selected student${batchAutoGradePreflight.selectedCount === 1 ? '' : 's'} across ${questionBreakdown.join(' and ')}.`
      )
    } else {
      batchGradeDescriptionParts.push(
        `This will grade ${batchAutoGradePreflight.selectedCount} selected student${batchAutoGradePreflight.selectedCount === 1 ? '' : 's'}.`
      )
    }

    batchGradeDescriptionParts.push(
      `Up to ${batchAutoGradePreflight.potentialAiSends} ungraded open response${batchAutoGradePreflight.potentialAiSends === 1 ? '' : 's'} may be sent to AI.`
    )

    if (batchAutoGradePreflight.gradedResponses > 0) {
      batchGradeDescriptionParts.push(
        `${batchAutoGradePreflight.gradedResponses} response${batchAutoGradePreflight.gradedResponses === 1 ? '' : 's'} already have grades and may be skipped.`
      )
    }
  }
  const batchGradeDescription = batchGradeDescriptionParts.join(' ')

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
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (batchSelectedCount === 0) {
                        setGradingWarning('Select students to grade')
                        return
                      }
                      setShowBatchGradeModal(true)
                    }}
                    className={batchSelectedCount === 0 ? 'h-8 w-8 p-0 opacity-60' : 'h-8 w-8 p-0'}
                    aria-label={batchSelectedCount > 0 ? `Grade ${batchSelectedCount} selected` : 'Grade selected students'}
                    disabled={isBatchAutoGrading || isBatchReturning || isBatchClearingOpenGrades}
                  >
                    <Check className="h-4 w-4 text-primary" />
                  </Button>
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
                      disabled={isBatchAutoGrading || isBatchReturning || isBatchClearingOpenGrades}
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
        ) : quizzes.length === 0 ? (
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
                      <th className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => {
                            setGradingSortColumn((prev) => (prev === 'last_name' ? 'first_name' : 'last_name'))
                          }}
                          className="inline-flex items-center gap-2 text-left text-text-muted hover:text-text-default"
                          aria-label={
                            gradingSortColumn === 'last_name'
                              ? 'Sort students by first name'
                              : 'Sort students by last name'
                          }
                        >
                          <span>Student</span>
                          <span className="text-xs font-medium text-text-muted">
                            {gradingSortColumn === 'last_name' ? 'Last' : 'First'}
                          </span>
                        </button>
                      </th>
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
                    {sortedGradingStudents.map((student) => {
                      const isSelected = student.student_id === selectedStudentId
                      const scoreLabel =
                        student.status === 'not_started'
                          ? '—'
                          : `${formatPoints(student.points_earned)}/${formatPoints(student.points_possible)}`
                      const statusMeta = STATUS_META[student.status]
                      const StatusIcon = statusMeta.icon
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
                                <StatusIcon className="h-4 w-4" />
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
            {quizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                apiBasePath={apiBasePath}
                isSelected={selectedQuizId === quiz.id}
                isReadOnly={isReadOnly}
                onSelect={() => handleCardSelect(quiz)}
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

      <DialogPanel
        isOpen={showBatchGradeModal}
        onClose={() => setShowBatchGradeModal(false)}
        ariaLabelledBy="test-ai-grade-title"
        maxWidth="max-w-lg"
        className="p-6"
      >
        <h2 id="test-ai-grade-title" className="text-lg font-semibold text-text-default">
          AI Grading
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Review the current selection before starting AI grading.
        </p>
        <div className="mt-4 rounded-md border border-border bg-surface px-3 py-3 text-sm text-text-default">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{batchAutoGradePreflight.selectedCount} selected</span>
            <span>{batchAutoGradePreflight.codeQuestions} code</span>
            <span>{batchAutoGradePreflight.regularQuestions} regular</span>
          </div>
          <p className="mt-2 text-sm text-text-muted">
            {batchGradeDescription || 'This will grade the currently selected students.'}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setShowBatchGradeModal(false)
              openBatchPromptGuidelineModal()
            }}
          >
            AI Prompt
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setShowBatchGradeModal(false)
              setShowClearOpenGradesConfirm(true)
            }}
          >
            Clear Open Scores/Feedback
          </Button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowBatchGradeModal(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isBatchAutoGrading}
            onClick={() => {
              setShowBatchGradeModal(false)
              void handleBatchAutoGrade()
            }}
          >
            {isBatchAutoGrading ? 'Grading...' : 'Grade with AI'}
          </Button>
        </div>
      </DialogPanel>

      <DialogPanel
        isOpen={showPromptGuidelineModal}
        onClose={() => {
          setShowPromptGuidelineModal(false)
          setBatchPromptGuidelineDraft(batchPromptGuideline)
          setBatchGradingStrategyDraft(batchGradingStrategy)
        }}
        ariaLabelledBy="test-ai-prompt-guideline-title"
        maxWidth="max-w-xl"
        className="p-6"
      >
        <h2 id="test-ai-prompt-guideline-title" className="text-lg font-semibold text-text-default">
          AI Prompt
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Pika automatically uses the coding rubric for code-style questions and the regular rubric
          for other open responses.
        </p>
        <div className="mt-4">
          <FormField label="Grading strategy">
            <Select
              aria-label="Grading strategy"
              options={TEST_AI_GRADING_STRATEGY_OPTIONS}
              value={batchGradingStrategyDraft}
              onChange={(event) =>
                setBatchGradingStrategyDraft(event.target.value as TestAiGradingStrategy)
              }
            />
          </FormField>
          <p className="mt-2 text-xs text-text-muted">
            Balanced reuses one question-level grading context per question. Aggressive Batch is
            experimental and grades same-question responses together in one AI call.
          </p>
        </div>
        <div className="mt-4">
          <FormField label="Additional instructions (optional)">
            <textarea
              value={batchPromptGuidelineDraft}
              onChange={(event) => setBatchPromptGuidelineDraft(event.target.value)}
              rows={8}
              placeholder="Optional teacher note to add on top of the built-in rubric for this run."
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setShowPromptGuidelineModal(false)
              setBatchPromptGuidelineDraft(batchPromptGuideline)
              setBatchGradingStrategyDraft(batchGradingStrategy)
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              setBatchPromptGuideline(batchPromptGuidelineDraft)
              setBatchGradingStrategy(batchGradingStrategyDraft)
              setShowPromptGuidelineModal(false)
            }}
          >
            Save
          </Button>
        </div>
      </DialogPanel>

      <ConfirmDialog
        isOpen={showClearOpenGradesConfirm}
        title={`Clear open scores and feedback for ${batchSelectedCount} selected student(s)?`}
        description="This removes all open-response scores and feedback (including AI grading metadata) for the selected students."
        confirmLabel={isBatchClearingOpenGrades ? 'Clearing...' : 'Clear Open Grades'}
        confirmVariant="danger"
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchClearingOpenGrades}
        isCancelDisabled={isBatchClearingOpenGrades}
        onCancel={() => setShowClearOpenGradesConfirm(false)}
        onConfirm={() => {
          void handleBatchClearOpenGrades()
        }}
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
