'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Circle, ClockAlert, LogOut, Play, Plus, Send, Square, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { QuizModal } from '@/components/QuizModal'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import { TeacherTestCard } from '@/components/TeacherTestCard'
import { PageActionBar, PageContent, PageLayout, PageStack } from '@/components/PageLayout'
import { useRightSidebar } from '@/components/layout'
import {
  TEACHER_QUIZZES_UPDATED_EVENT,
  TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
  type TeacherTestGradingRowUpdatedEventDetail,
} from '@/lib/events'
import { getQuizExitCount } from '@/lib/quizzes'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { compareByNameFields } from '@/lib/table-sort'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { Button, ConfirmDialog, DialogPanel, EmptyState, FormField, Select, Tooltip } from '@/ui'
import type { Classroom, Quiz, QuizFocusSummary, QuizWithStats } from '@/types'

interface Props {
  classroom: Classroom
  testsTabClickToken?: number
  onSelectTest?: (test: QuizWithStats | null) => void
  onTestGradingDataRefresh?: () => void
  onTestGradingContextChange?: (context: {
    mode: 'authoring' | 'grading'
    testId: string | null
    studentId: string | null
    studentName: string | null
  }) => void
  onRequestDelete?: () => void
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

type WorkspaceState = 'list' | 'selected'
type WorkspaceTab = 'authoring' | 'grading'
type TestGradingSortColumn = 'first_name' | 'last_name'
type TestAiGradingStrategy = 'balanced' | 'aggressive_batch'

const GRADING_POLL_INTERVAL_MS = 15_000

const TEST_AI_GRADING_STRATEGY_OPTIONS = [
  { value: 'balanced', label: 'Balanced (Recommended)' },
  { value: 'aggressive_batch', label: 'Aggressive Batch (Experimental)' },
]

const STATUS_META: Record<
  TestGradingStudentRow['status'],
  { label: string; className: string; icon: typeof Circle }
> = {
  not_started: { label: 'Not started', className: 'text-gray-400', icon: Circle },
  in_progress: { label: 'In progress', className: 'text-yellow-500', icon: Circle },
  submitted: { label: 'Submitted', className: 'text-green-500', icon: Check },
  returned: { label: 'Returned', className: 'text-blue-500', icon: Send },
}

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

export function TeacherTestsTab({
  classroom,
  testsTabClickToken = 0,
  onSelectTest,
  onTestGradingDataRefresh,
  onTestGradingContextChange,
  onRequestDelete,
}: Props) {
  const apiBasePath = '/api/teacher/tests'
  const isReadOnly = !!classroom.archived_at
  const { setOpen: setRightSidebarOpen } = useRightSidebar()
  const previousTestsTabClickTokenRef = useRef(testsTabClickToken)

  const [tests, setTests] = useState<QuizWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>('list')
  const [selectedWorkspaceTab, setSelectedWorkspaceTab] = useState<WorkspaceTab>('authoring')
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [pendingCreatedTestId, setPendingCreatedTestId] = useState<string | null>(null)
  const [testPreviewRequestToken, setTestPreviewRequestToken] = useState(0)

  const [gradingStudents, setGradingStudents] = useState<TestGradingStudentRow[]>([])
  const [gradingQuestions, setGradingQuestions] = useState<TestGradingQuestionSummary[]>([])
  const [gradingServerTestStatus, setGradingServerTestStatus] = useState<Quiz['status'] | null>(null)
  const [gradingServerTestId, setGradingServerTestId] = useState<string | null>(null)
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

  const [statusActionError, setStatusActionError] = useState('')
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [checkingActivation, setCheckingActivation] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const selectedTest = useMemo(
    () => tests.find((test) => test.id === selectedTestId) ?? null,
    [selectedTestId, tests]
  )

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

  const loadTests = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ classroom_id: classroom.id })
      const response = await fetch(`${apiBasePath}?${query.toString()}`)
      const data = await response.json()
      setTests(data.tests || data.quizzes || [])
    } catch (error) {
      console.error('Error loading tests:', error)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  const loadGradingRows = useCallback(async () => {
    if (!selectedTestId) {
      setGradingStudents([])
      setGradingQuestions([])
      setGradingServerTestStatus(null)
      setGradingServerTestId(null)
      return
    }

    setGradingLoading(true)
    setGradingError('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/results`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load test results')

      const nextStatus =
        data?.quiz?.status === 'draft' || data?.quiz?.status === 'active' || data?.quiz?.status === 'closed'
          ? (data.quiz.status as Quiz['status'])
          : null

      setGradingServerTestStatus(nextStatus)
      setGradingServerTestId(selectedTestId)
      if (nextStatus) {
        setTests((prev) =>
          prev.map((test) =>
            test.id === selectedTestId && test.status !== nextStatus ? { ...test, status: nextStatus } : test
          )
        )
      }
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
    } catch (error: any) {
      setGradingError(error.message || 'Failed to load test results')
      setGradingStudents([])
      setGradingQuestions([])
    } finally {
      setGradingLoading(false)
    }
  }, [selectedTestId])

  useEffect(() => {
    void loadTests()
  }, [loadTests])

  useEffect(() => {
    function handleTestsUpdated(event: Event) {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (!detail || detail.classroomId !== classroom.id) return
      void loadTests()
    }

    window.addEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleTestsUpdated)
    return () => window.removeEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleTestsUpdated)
  }, [classroom.id, loadTests])

  useEffect(() => {
    onSelectTest?.(workspaceState === 'selected' ? selectedTest : null)
  }, [onSelectTest, selectedTest, workspaceState])

  useEffect(() => {
    if (!selectedTestId) return
    if (tests.some((test) => test.id === selectedTestId)) return

    setWorkspaceState('list')
    setSelectedWorkspaceTab('authoring')
    setSelectedTestId(null)
    setSelectedStudentId(null)
    clearBatchSelection()
  }, [clearBatchSelection, selectedTestId, tests])

  useEffect(() => {
    if (!pendingCreatedTestId) return
    if (!tests.some((test) => test.id === pendingCreatedTestId)) return

    setSelectedTestId(pendingCreatedTestId)
    setWorkspaceState('selected')
    setSelectedWorkspaceTab('authoring')
    setSelectedStudentId(null)
    setPendingCreatedTestId(null)
    setRightSidebarOpen(false)
  }, [pendingCreatedTestId, setRightSidebarOpen, tests])

  useEffect(() => {
    if (previousTestsTabClickTokenRef.current === testsTabClickToken) return
    previousTestsTabClickTokenRef.current = testsTabClickToken

    if (workspaceState !== 'selected') return

    setWorkspaceState('list')
    setSelectedWorkspaceTab('authoring')
    setSelectedTestId(null)
    setSelectedStudentId(null)
    setGradingError('')
    setGradingWarning('')
    setGradingInfo('')
    clearBatchSelection()
    setRightSidebarOpen(false)
  }, [clearBatchSelection, setRightSidebarOpen, testsTabClickToken, workspaceState])

  useEffect(() => {
    if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading') {
      setSelectedStudentId(null)
      setGradingStudents([])
      setGradingQuestions([])
      setGradingServerTestStatus(null)
      setGradingServerTestId(null)
      clearBatchSelection()
      return
    }

    void loadGradingRows()
  }, [clearBatchSelection, loadGradingRows, selectedWorkspaceTab, workspaceState])

  useEffect(() => {
    if (
      workspaceState !== 'selected' ||
      selectedWorkspaceTab !== 'grading' ||
      !selectedTestId ||
      gradingServerTestId !== selectedTestId ||
      gradingServerTestStatus !== 'active'
    ) {
      return
    }

    let intervalId: number | null = null
    let disposed = false
    let pollingInFlight = false

    const canPollNow = () => document.visibilityState === 'visible' && document.hasFocus()

    const stopPolling = () => {
      if (intervalId === null) return
      window.clearInterval(intervalId)
      intervalId = null
    }

    const pollNow = async () => {
      if (disposed || pollingInFlight || !canPollNow()) return
      pollingInFlight = true
      try {
        await loadGradingRows()
      } finally {
        pollingInFlight = false
      }
    }

    const startPolling = () => {
      if (intervalId !== null || !canPollNow()) return
      intervalId = window.setInterval(() => {
        void pollNow()
      }, GRADING_POLL_INTERVAL_MS)
    }

    const handlePollingStateChange = () => {
      if (!canPollNow()) {
        stopPolling()
        return
      }

      startPolling()
      void pollNow()
    }

    startPolling()
    document.addEventListener('visibilitychange', handlePollingStateChange)
    window.addEventListener('focus', handlePollingStateChange)
    window.addEventListener('blur', handlePollingStateChange)

    return () => {
      disposed = true
      stopPolling()
      document.removeEventListener('visibilitychange', handlePollingStateChange)
      window.removeEventListener('focus', handlePollingStateChange)
      window.removeEventListener('blur', handlePollingStateChange)
    }
  }, [gradingServerTestId, gradingServerTestStatus, loadGradingRows, selectedTestId, selectedWorkspaceTab, workspaceState])

  useEffect(() => {
    function handleGradingRowUpdate(event: Event) {
      if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading' || !selectedTestId) return

      const detail = (event as CustomEvent<TeacherTestGradingRowUpdatedEventDetail>).detail
      if (!detail || detail.testId !== selectedTestId) return

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
  }, [selectedTestId, selectedWorkspaceTab, workspaceState])

  useEffect(() => {
    if (!onTestGradingContextChange) return

    if (workspaceState !== 'selected' || !selectedTestId || selectedWorkspaceTab === 'authoring') {
      onTestGradingContextChange({
        mode: 'authoring',
        testId: workspaceState === 'selected' ? selectedTestId : null,
        studentId: null,
        studentName: null,
      })
      return
    }

    const selectedStudent =
      gradingStudents.find((student) => student.student_id === selectedStudentId) || null
    onTestGradingContextChange({
      mode: 'grading',
      testId: selectedTestId,
      studentId: selectedStudent?.student_id || null,
      studentName: selectedStudent?.name || selectedStudent?.email || null,
    })
  }, [
    gradingStudents,
    onTestGradingContextChange,
    selectedStudentId,
    selectedTestId,
    selectedWorkspaceTab,
    workspaceState,
  ])

  useEffect(() => {
    if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading' || !selectedStudentId) {
      setRightSidebarOpen(false)
      return
    }

    setRightSidebarOpen(true)
  }, [selectedStudentId, selectedWorkspaceTab, setRightSidebarOpen, workspaceState])

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

  function handleOpenTest(test: QuizWithStats) {
    setSelectedTestId(test.id)
    setWorkspaceState('selected')
    setSelectedWorkspaceTab('authoring')
    setSelectedStudentId(null)
    setGradingError('')
    setGradingWarning('')
    setGradingInfo('')
    clearBatchSelection()
  }

  function handleNewTest() {
    setShowModal(true)
  }

  function handleTestCreated(test: Quiz) {
    setShowModal(false)
    setPendingCreatedTestId(test.id)
    window.dispatchEvent(
      new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
    )
  }

  function openBatchPromptGuidelineModal() {
    setBatchPromptGuidelineDraft(batchPromptGuideline)
    setBatchGradingStrategyDraft(batchGradingStrategy)
    setShowPromptGuidelineModal(true)
  }

  async function handleBatchAutoGrade(options?: {
    studentIds?: string[]
    preserveSelection?: boolean
    infoPrefix?: string
  }) {
    const targetStudentIds = options?.studentIds || batchSelectedStudentIds
    if (!selectedTestId || targetStudentIds.length === 0) return

    setIsBatchAutoGrading(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/auto-grade`, {
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
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Auto-grade failed')

      const gradedStudents = Number(data.graded_students ?? 0)
      const skippedStudents = Number(data.skipped_students ?? 0)
      const errorSummary = summarizeBatchAutoGradeErrors(data.errors)
      const summaryPrefix = options?.infoPrefix || 'AI graded'
      setGradingInfo(
        `${summaryPrefix} ${gradedStudents} student${gradedStudents === 1 ? '' : 's'}${skippedStudents > 0 ? ` • ${skippedStudents} skipped` : ''}`
      )

      if (!options?.preserveSelection) {
        clearBatchSelection()
      }
      await loadGradingRows()
      onTestGradingDataRefresh?.()
      if (errorSummary) {
        setGradingError(errorSummary)
      }
    } catch (error: any) {
      setGradingError(error.message || 'Auto-grade failed')
    } finally {
      setIsBatchAutoGrading(false)
    }
  }

  async function handleBatchReturn(options?: { closeTest?: boolean }) {
    if (!selectedTestId || batchSelectedCount === 0) return

    setIsBatchReturning(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_ids: Array.from(batchSelectedIds),
          close_test: options?.closeTest === true,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Return failed')

      const returnedCount = Number(data.returned_count ?? 0)
      const skippedCount = Number(data.skipped_count ?? 0)
      setGradingInfo(
        `Returned ${returnedCount} student${returnedCount === 1 ? '' : 's'}${skippedCount > 0 ? ` • ${skippedCount} skipped` : ''}`
      )

      clearBatchSelection()
      setShowReturnConfirm(false)
      if (data.test_closed) {
        await loadTests()
      }
      await loadGradingRows()
    } catch (error: any) {
      setGradingError(error.message || 'Return failed')
    } finally {
      setIsBatchReturning(false)
    }
  }

  async function handleBatchClearOpenGrades() {
    if (!selectedTestId || batchSelectedCount === 0) return

    setIsBatchClearingOpenGrades(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/clear-open-grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Clear open grades failed')

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
    } catch (error: any) {
      setGradingError(error.message || 'Clear open grades failed')
    } finally {
      setIsBatchClearingOpenGrades(false)
    }
  }

  async function patchSelectedTest(payload: Record<string, unknown>) {
    if (!selectedTestId) return

    setStatusUpdating(true)
    setStatusActionError('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update test')
      }

      await loadTests()
    } catch (error: any) {
      setStatusActionError(error?.message || 'Failed to update test')
    } finally {
      setStatusUpdating(false)
      setShowActivateConfirm(false)
      setShowCloseConfirm(false)
    }
  }

  async function handleSelectedTestStatusChange(newStatus: 'active' | 'closed') {
    await patchSelectedTest({ status: newStatus })
  }

  async function handleRequestSelectedTestActivate() {
    if (!selectedTest || isReadOnly || statusUpdating || checkingActivation) return

    const activation = validateSelectedTestActivation(selectedTest)
    if (!activation.valid) {
      setStatusActionError(activation.error || 'Test cannot be activated yet')
      return
    }

    setCheckingActivation(true)
    setStatusActionError('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTest.id}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to validate test')
      }

      const questions = Array.isArray(data.questions) ? data.questions : []
      if (questions.length < 1) {
        setStatusActionError('Test must have at least 1 question')
        return
      }

      for (let index = 0; index < questions.length; index += 1) {
        const validation = validateTestQuestionCreate(questions[index] as Record<string, unknown>)
        if (!validation.valid) {
          setStatusActionError(`Q${index + 1}: ${validation.error}`)
          return
        }
      }

      setShowActivateConfirm(true)
    } catch (error: any) {
      setStatusActionError(error?.message || 'Failed to validate test')
    } finally {
      setCheckingActivation(false)
    }
  }

  function validateSelectedTestActivation(test: QuizWithStats): { valid: boolean; error?: string } {
    if ((test.stats.questions_count || 0) < 1) {
      return { valid: false, error: 'Test must have at least 1 question' }
    }
    return { valid: true }
  }

  const returnWillCloseActiveTest =
    selectedWorkspaceTab === 'grading' && selectedTest?.status === 'active'
  const selectedTestTitle = selectedTest?.title || 'Test'
  const selectedActivation = selectedTest ? validateSelectedTestActivation(selectedTest) : { valid: false }
  const isSelectedWorkspace = workspaceState === 'selected'

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

    batchGradeDescriptionParts.push(
      questionBreakdown.length > 0
        ? `This will grade ${batchAutoGradePreflight.selectedCount} selected student${batchAutoGradePreflight.selectedCount === 1 ? '' : 's'} across ${questionBreakdown.join(' and ')}.`
        : `This will grade ${batchAutoGradePreflight.selectedCount} selected student${batchAutoGradePreflight.selectedCount === 1 ? '' : 's'}.`
    )
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

  const gradingTable = (
    <div className="space-y-3">
      {gradingLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : gradingStudents.length === 0 ? (
        <EmptyState
          title="No student rows yet"
          description="Student attempts will appear here once learners begin the test."
          tone="muted"
        />
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
                const windowUnmaximizeAttempts = student.focus_summary?.window_unmaximize_attempts ?? 0
                const exitsCount = getQuizExitCount(student.focus_summary)
                const formattedLastActivity = formatTorontoTime(student.last_activity_at)

                return (
                  <tr
                    key={student.student_id}
                    className={[
                      'cursor-pointer border-t border-border transition-colors hover:bg-surface-hover',
                      isSelected ? 'bg-surface-selected' : '',
                    ].join(' ')}
                    onClick={() => setSelectedStudentId(student.student_id)}
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
                      <Tooltip content={`Away from test route for ${awayLabel} total.`}>
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
  )

  const selectedHeader = workspaceState === 'selected' ? (
    <div className="flex w-full flex-wrap items-center gap-2 sm:min-h-[2.75rem]">
      <div className="mb-[-1px] flex items-end gap-1 self-end">
        <button
          type="button"
          className={[
            selectedWorkspaceTab === 'authoring'
              ? 'relative z-10 rounded-t-lg border border-border border-b-surface bg-surface text-text-default'
              : 'rounded-t-lg border border-transparent bg-surface-2 text-text-muted hover:bg-surface-hover hover:text-text-default',
            'min-h-10 px-3 py-2 text-sm font-medium transition-colors',
          ].join(' ')}
          onClick={() => setSelectedWorkspaceTab('authoring')}
          aria-pressed={selectedWorkspaceTab === 'authoring'}
        >
          Authoring
        </button>
        <button
          type="button"
          className={[
            selectedWorkspaceTab === 'grading'
              ? 'relative z-10 rounded-t-lg border border-border border-b-surface bg-surface text-text-default'
              : 'rounded-t-lg border border-transparent bg-surface-2 text-text-muted hover:bg-surface-hover hover:text-text-default',
            'min-h-10 px-3 py-2 text-sm font-medium transition-colors',
          ].join(' ')}
          onClick={() => setSelectedWorkspaceTab('grading')}
          aria-pressed={selectedWorkspaceTab === 'grading'}
        >
          Grading
        </button>
      </div>

      <div className="flex min-w-0 basis-full justify-center sm:basis-auto sm:flex-1">
        <div className="min-w-0 max-w-[24rem] truncate text-center text-sm font-medium text-text-default">
          {selectedTestTitle}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {selectedWorkspaceTab === 'authoring' ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setTestPreviewRequestToken((value) => value + 1)}
            >
              Preview
            </Button>
            {selectedTest?.status === 'draft' ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void handleRequestSelectedTestActivate()
                }}
                disabled={!selectedActivation.valid || isReadOnly || statusUpdating || checkingActivation}
              >
                <Play className="h-4 w-4" />
                Open
              </Button>
            ) : null}
            {selectedTest?.status === 'active' ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowCloseConfirm(true)}
                disabled={isReadOnly || statusUpdating}
              >
                <Square className="h-4 w-4" />
                Close
              </Button>
            ) : null}
            {selectedTest?.status === 'closed' ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void handleSelectedTestStatusChange('active')
                }}
                disabled={isReadOnly || statusUpdating}
              >
                <Play className="h-4 w-4" />
                Reopen
              </Button>
            ) : null}
            {onRequestDelete ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={onRequestDelete}
                disabled={isReadOnly}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={openBatchPromptGuidelineModal}
              disabled={isBatchAutoGrading || isBatchReturning || isBatchClearingOpenGrades}
            >
              AI Prompt
            </Button>
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
              disabled={
                batchSelectedCount === 0 ||
                isBatchAutoGrading ||
                isBatchReturning ||
                isBatchClearingOpenGrades
              }
            >
              <Check className="h-4 w-4" />
              AI Grade
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (batchSelectedCount === 0) {
                  setGradingWarning('Select students to return')
                  return
                }
                setShowReturnConfirm(true)
              }}
              disabled={
                batchSelectedCount === 0 ||
                isBatchAutoGrading ||
                isBatchReturning ||
                isBatchClearingOpenGrades
              }
            >
              <Send className="h-4 w-4" />
              Return
            </Button>
          </>
        )}
      </div>
    </div>
  ) : (
    <Button onClick={handleNewTest} variant="primary" className="gap-1.5 shadow-sm" disabled={isReadOnly}>
      <Plus className="h-4 w-4" />
      New Test
    </Button>
  )

  return (
    <PageLayout className="flex h-full min-h-0 flex-col">
      <PageActionBar primary={selectedHeader} />

      <PageContent
        className={[
          'flex min-h-0 flex-1 flex-col',
          isSelectedWorkspace ? 'gap-0 px-0 pt-0' : 'gap-3',
        ].join(' ')}
      >
        {statusActionError && workspaceState === 'selected' && selectedWorkspaceTab === 'authoring' ? (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {statusActionError}
          </div>
        ) : null}
        {gradingError && workspaceState === 'selected' && selectedWorkspaceTab === 'grading' ? (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {gradingError}
          </div>
        ) : null}
        {gradingWarning && workspaceState === 'selected' && selectedWorkspaceTab === 'grading' ? (
          <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            {gradingWarning}
          </div>
        ) : null}
        {gradingInfo && workspaceState === 'selected' && selectedWorkspaceTab === 'grading' ? (
          <div className="rounded-md border border-primary bg-info-bg px-3 py-2 text-sm text-info">
            {gradingInfo}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : tests.length === 0 ? (
          <EmptyState
            title="No tests yet"
            description="Create a test to get started."
            tone="muted"
            className="mx-auto w-full max-w-3xl"
          />
        ) : workspaceState === 'list' ? (
          <PageStack className="mx-auto w-full max-w-6xl">
            {tests.map((test) => (
              <TeacherTestCard
                key={test.id}
                test={test}
                isReadOnly={isReadOnly}
                onSelect={() => handleOpenTest(test)}
                onUpdate={() => {
                  void loadTests()
                }}
              />
            ))}
          </PageStack>
        ) : !selectedTest ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : selectedWorkspaceTab === 'authoring' && selectedTest ? (
          <div className="flex min-h-0 w-full flex-1 overflow-hidden rounded-b-lg border border-border bg-surface">
            <QuizDetailPanel
              quiz={selectedTest}
              classroomId={classroom.id}
              apiBasePath={apiBasePath}
              onQuizUpdate={() => {
                void loadTests()
              }}
              showInlineDeleteAction={false}
              testQuestionLayout="summary-detail"
              showPreviewButton={false}
              showResultsTab={false}
              previewRequestToken={testPreviewRequestToken}
            />
          </div>
        ) : (
          gradingTable
        )}
      </PageContent>

      <QuizModal
        isOpen={showModal}
        classroomId={classroom.id}
        assessmentType="test"
        apiBasePath={apiBasePath}
        quiz={null}
        onClose={() => setShowModal(false)}
        onSuccess={handleTestCreated}
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
        isOpen={showActivateConfirm}
        title="Activate test?"
        description="Once activated, students will be able to respond."
        confirmLabel={statusUpdating ? 'Activating...' : 'Activate'}
        cancelLabel="Cancel"
        isConfirmDisabled={statusUpdating}
        isCancelDisabled={statusUpdating}
        onCancel={() => setShowActivateConfirm(false)}
        onConfirm={() => handleSelectedTestStatusChange('active')}
      />

      <ConfirmDialog
        isOpen={showCloseConfirm}
        title="Close test?"
        description="Students will no longer be able to respond."
        confirmLabel={statusUpdating ? 'Closing...' : 'Close'}
        cancelLabel="Cancel"
        isConfirmDisabled={statusUpdating}
        isCancelDisabled={statusUpdating}
        onCancel={() => setShowCloseConfirm(false)}
        onConfirm={() => handleSelectedTestStatusChange('closed')}
      />

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
              : 'Return'
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
