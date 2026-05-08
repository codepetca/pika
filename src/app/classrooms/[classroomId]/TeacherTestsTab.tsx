'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Check, ClockAlert, Code, ExternalLink, Lock, LogOut, Pencil, Plus, RotateCcw, Send, Trash2, Unlock } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { QuizModal } from '@/components/QuizModal'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import { TeacherTestCard } from '@/components/TeacherTestCard'
import {
  AssessmentStatusIndicator,
  getTestGradingWorkStatusDisplay,
} from '@/components/AssessmentStatusIndicator'
import { TestStudentGradingPanel } from '@/components/TestStudentGradingPanel'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { TeacherWorkItemList } from '@/components/teacher-work-surface/TeacherWorkItemList'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  TEACHER_QUIZZES_UPDATED_EVENT,
  TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
  type TeacherTestGradingRowUpdatedEventDetail,
} from '@/lib/events'
import { getQuizExitCount } from '@/lib/quizzes'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { compareByNameFields } from '@/lib/table-sort'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { Button, ConfirmDialog, DialogPanel, EmptyState, RefreshingIndicator, Select, SplitButton, Tooltip, useAppMessage, useOverlayMessage } from '@/ui'
import type {
  AssessmentEditorSummaryUpdate,
  AssessmentWorkspaceSummaryPatch,
  Classroom,
  Quiz,
  QuizFocusSummary,
  QuizWithStats,
  TestAiGradingRunSummary,
} from '@/types'

interface Props {
  classroom: Classroom
  testsTabClickToken?: number
  selectedTestId?: string | null
  selectedTestMode?: WorkspaceTab | null
  selectedTestStudentId?: string | null
  updateSearchParams?: UpdateSearchParamsFn
  onSelectTest?: (test: QuizWithStats | null) => void
  onTestGradingDataRefresh?: () => void
  onTestGradingContextChange?: (context: {
    mode: 'authoring' | 'grading'
    testId: string | null
    studentId: string | null
    studentName: string | null
  }) => void
  onRequestTestPreview?: (preview: { testId: string; title: string }) => void
  onRequestDelete?: () => void
}

type UpdateSearchOptions = {
  replace?: boolean
}

type UpdateSearchParamsFn = (
  updater: (params: URLSearchParams) => void,
  options?: UpdateSearchOptions,
) => void

interface TestGradingStudentRow {
  student_id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  email: string
  status: 'not_started' | 'in_progress' | 'closed' | 'submitted' | 'returned'
  submitted_at: string | null
  closed_for_grading_at?: string | null
  last_activity_at: string | null
  points_earned: number
  points_possible: number
  percent: number | null
  graded_open_responses: number
  ungraded_open_responses: number
  access_state?: 'open' | 'closed' | null
  effective_access?: 'open' | 'closed'
  access_source?: 'test' | 'student'
  focus_summary: QuizFocusSummary | null
}

interface TestGradingQuestionSummary {
  id: string
  questionType: 'multiple_choice' | 'open_response'
  responseMonospace: boolean
}

type WorkspaceState = 'list' | 'selected'
type WorkspaceTab = 'authoring' | 'grading'
type TestEditModalView = 'edit' | 'markdown'
type TestEditSaveStatus = 'saved' | 'saving' | 'unsaved'
type TestGradingSortColumn = 'first_name' | 'last_name'

const GRADING_POLL_INTERVAL_MS = 15_000

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

function isTestAiGradingRunActive(run: TestAiGradingRunSummary | null): boolean {
  return !!run && (run.status === 'queued' || run.status === 'running')
}

function getTestAiRunPollDelayMs(run: TestAiGradingRunSummary | null): number {
  if (!run || !isTestAiGradingRunActive(run) || !run.next_retry_at) {
    return 2000
  }

  const retryAt = new Date(run.next_retry_at).getTime()
  if (!Number.isFinite(retryAt)) {
    return 2000
  }

  const delay = retryAt - Date.now() + 250
  return Math.min(Math.max(delay, 1000), 10_000)
}

function formatTestAiGradingRunMessage(run: TestAiGradingRunSummary): {
  info: string
  error: string
} {
  const summaryParts: string[] = []

  if (run.completed_count > 0) {
    summaryParts.push(`Graded ${run.completed_count}`)
  }
  if (run.skipped_unanswered_count > 0) {
    summaryParts.push(`${run.skipped_unanswered_count} unanswered`)
  }
  if (run.skipped_already_graded_count > 0) {
    summaryParts.push(`${run.skipped_already_graded_count} already graded`)
  }
  if (run.failed_count > 0) {
    summaryParts.push(`${run.failed_count} failed`)
  }

  const summary = summaryParts.length > 0
    ? summaryParts.join(' • ')
    : 'No grading changes were needed'
  const errorDetails = run.error_samples
    .slice(0, 3)
    .map((sample) => sample.message)
    .join('\n')

  if (run.status === 'completed_with_errors' || run.status === 'failed') {
    return {
      info: '',
      error: errorDetails ? `${summary}\n${errorDetails}` : summary,
    }
  }

  return {
    info: summary,
    error: '',
  }
}

export function TeacherTestsTab({
  classroom,
  testsTabClickToken = 0,
  selectedTestId: selectedTestIdProp,
  selectedTestMode,
  selectedTestStudentId,
  updateSearchParams,
  onSelectTest,
  onTestGradingDataRefresh,
  onTestGradingContextChange,
  onRequestTestPreview,
}: Props) {
  const apiBasePath = '/api/teacher/tests'
  const isReadOnly = !!classroom.archived_at
  const previousTestsTabClickTokenRef = useRef(testsTabClickToken)
  const gradingSelectionRef = useRef<{
    workspaceState: WorkspaceState
    selectedWorkspaceTab: WorkspaceTab
    selectedTestId: string | null
  }>({
    workspaceState: 'list',
    selectedWorkspaceTab: 'grading',
    selectedTestId: null,
  })
  const latestGradingRequestIdRef = useRef(0)
  const handledCompletedRunKeysRef = useRef<Set<string>>(new Set())

  const [tests, setTests] = useState<QuizWithStats[]>([])
  const { showMessage } = useAppMessage()
  const [loading, setLoading] = useState(true)
  const [internalSelectedWorkspaceTab, setInternalSelectedWorkspaceTab] = useState<WorkspaceTab>('grading')
  const [internalSelectedTestId, setInternalSelectedTestId] = useState<string | null>(null)
  const [testEditMode, setTestEditMode] = useState(false)
  const [isReorderingTests, setIsReorderingTests] = useState(false)
  const [selectedTestDraftSummary, setSelectedTestDraftSummary] = useState<AssessmentEditorSummaryUpdate | null>(null)
  const [hasPendingMarkdownImport, setHasPendingMarkdownImport] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [testEditModalView, setTestEditModalView] = useState<TestEditModalView>('edit')
  const [, setTestEditSaveStatus] = useState<TestEditSaveStatus>('saved')
  const [pendingDeleteTest, setPendingDeleteTest] = useState<QuizWithStats | null>(null)
  const [isDeletingTest, setIsDeletingTest] = useState(false)

  const [gradingStudents, setGradingStudents] = useState<TestGradingStudentRow[]>([])
  const [gradingQuestions, setGradingQuestions] = useState<TestGradingQuestionSummary[]>([])
  const [gradingServerTestStatus, setGradingServerTestStatus] = useState<Quiz['status'] | null>(null)
  const [gradingServerTestId, setGradingServerTestId] = useState<string | null>(null)
  const [testAiGradingRun, setTestAiGradingRun] = useState<TestAiGradingRunSummary | null>(null)
  const [gradingLoading, setGradingLoading] = useState(false)
  const [gradingRefreshing, setGradingRefreshing] = useState(false)
  const [gradingError, setGradingError] = useState('')
  const [gradingSortColumn, setGradingSortColumn] = useState<TestGradingSortColumn>('last_name')
  const [internalSelectedStudentId, setInternalSelectedStudentId] = useState<string | null>(null)
  const [gradingInspectorWidth, setGradingInspectorWidth] = useState(50)
  const [testGradingPanelRefreshToken, setTestGradingPanelRefreshToken] = useState(0)
  const [testGradingSaveState, setTestGradingSaveState] = useState<{
    canSave: boolean
    isSaving: boolean
    status: 'idle' | 'unsaved' | 'saving' | 'saved'
  }>({
    canSave: false,
    isSaving: false,
    status: 'idle',
  })

  const selectedTestId =
    selectedTestIdProp !== undefined ? selectedTestIdProp : internalSelectedTestId
  const selectedWorkspaceTab =
    selectedTestMode === 'grading'
      ? selectedTestMode
      : internalSelectedWorkspaceTab
  const selectedStudentId =
    selectedTestStudentId !== undefined ? selectedTestStudentId : internalSelectedStudentId
  const workspaceState: WorkspaceState = selectedTestId ? 'selected' : 'list'
  const [gradingInfo, setGradingInfo] = useState('')
  const [gradingWarning, setGradingWarning] = useState('')
  const [isBatchAutoGrading, setIsBatchAutoGrading] = useState(false)
  const [isBatchReturning, setIsBatchReturning] = useState(false)
  const [isBatchUnsubmitting, setIsBatchUnsubmitting] = useState(false)
  const [isBatchUpdatingAccess, setIsBatchUpdatingAccess] = useState(false)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)
  const [showUnsubmitConfirm, setShowUnsubmitConfirm] = useState(false)
  const [pendingUnsubmitStudent, setPendingUnsubmitStudent] = useState<TestGradingStudentRow | null>(null)
  const [pendingOpenAccessStudent, setPendingOpenAccessStudent] = useState<TestGradingStudentRow | null>(null)
  const [pendingCloseAccessStudent, setPendingCloseAccessStudent] = useState<TestGradingStudentRow | null>(null)
  const [showCloseAccessConfirm, setShowCloseAccessConfirm] = useState(false)
  const [pendingCloseAccessStudentIds, setPendingCloseAccessStudentIds] = useState<string[] | null>(null)
  const [showBatchGradeModal, setShowBatchGradeModal] = useState(false)
  const [studentAttemptEditMode, setStudentAttemptEditMode] = useState(false)
  const [pendingDeleteStudentAttempt, setPendingDeleteStudentAttempt] = useState<TestGradingStudentRow | null>(null)
  const [pendingDeleteStudentAttemptIds, setPendingDeleteStudentAttemptIds] = useState<string[] | null>(null)
  const [isDeletingStudentAttempt, setIsDeletingStudentAttempt] = useState(false)

  const [statusActionError, setStatusActionError] = useState('')
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [checkingActivation, setCheckingActivation] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const testSortSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const selectedTest = useMemo(
    () => tests.find((test) => test.id === selectedTestId) ?? null,
    [selectedTestId, tests]
  )
  const activeTestAiRun = useMemo(() => {
    if (!selectedTestId || !testAiGradingRun) return null
    return testAiGradingRun.test_id === selectedTestId ? testAiGradingRun : null
  }, [selectedTestId, testAiGradingRun])
  const activeTestAiRunId = activeTestAiRun?.id ?? null
  const hasActiveTestAiRun = isTestAiGradingRunActive(activeTestAiRun)
  const selectedTestWorkspace = useMemo(() => {
    if (!selectedTest) return null
    if (!selectedTestDraftSummary) return selectedTest

    return {
      ...selectedTest,
      title: selectedTestDraftSummary.title,
      show_results: selectedTestDraftSummary.show_results,
      stats: {
        ...selectedTest.stats,
        questions_count: selectedTestDraftSummary.questions_count,
      },
    }
  }, [selectedTest, selectedTestDraftSummary])

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

  const setSelectedStudentId = useCallback((nextStudentId: string | null) => {
    setInternalSelectedStudentId(nextStudentId)
  }, [])

  const navigateTestWorkspace = useCallback((
    next: {
      testId: string | null
      mode?: WorkspaceTab | null
      studentId?: string | null
    },
    options?: UpdateSearchOptions,
  ) => {
    setInternalSelectedTestId(next.testId)
    setInternalSelectedWorkspaceTab('grading')
    setInternalSelectedStudentId(next.studentId ?? null)

    updateSearchParams?.((params) => {
      params.set('tab', 'tests')
      if (next.testId) {
        params.set('testId', next.testId)
        params.set('testMode', 'grading')
        if (next.studentId) {
          params.set('testStudentId', next.studentId)
        } else {
          params.delete('testStudentId')
        }
      } else {
        params.delete('testId')
        params.delete('testMode')
        params.delete('testStudentId')
      }
    }, options)
  }, [updateSearchParams])

  const clearTestWorkspace = useCallback((options?: UpdateSearchOptions) => {
    navigateTestWorkspace({ testId: null, mode: null, studentId: null }, options)
  }, [navigateTestWorkspace])

  const selectGradingStudent = useCallback((studentId: string | null) => {
    setInternalSelectedStudentId(studentId)
    if (!selectedTestId || selectedWorkspaceTab !== 'grading') return
    navigateTestWorkspace({
      testId: selectedTestId,
      mode: 'grading',
      studentId,
    })
  }, [navigateTestWorkspace, selectedTestId, selectedWorkspaceTab])

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

  const applyTestSummaryPatch = useCallback((testId: string, update: AssessmentWorkspaceSummaryPatch) => {
    setTests((prev) =>
      prev.map((test) => {
        if (test.id !== testId) return test

        return {
          ...test,
          title: typeof update.title === 'string' ? update.title : test.title,
          show_results: typeof update.show_results === 'boolean' ? update.show_results : test.show_results,
          status: update.status ?? test.status,
          stats: {
            ...test.stats,
            questions_count:
              typeof update.questions_count === 'number' ? update.questions_count : test.stats.questions_count,
          },
        }
      })
    )
  }, [])

  const applySelectedTestDraftSummary = useCallback(
    (update: AssessmentEditorSummaryUpdate) => {
      if (!selectedTestId) return

      setSelectedTestDraftSummary(update)
      applyTestSummaryPatch(selectedTestId, update)
    },
    [applyTestSummaryPatch, selectedTestId]
  )
  const handleSelectedTestDraftSummaryChange = useCallback((update: AssessmentEditorSummaryUpdate) => {
    setSelectedTestDraftSummary(update)
  }, [])

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

  const loadGradingRows = useCallback(async (options?: { preserveRows?: boolean }) => {
    if (!selectedTestId) {
      setGradingStudents([])
      setGradingQuestions([])
      setGradingServerTestStatus(null)
      setGradingServerTestId(null)
      setTestAiGradingRun(null)
      setGradingRefreshing(false)
      return
    }

    const preserveRows = options?.preserveRows ?? false
    const requestedTestId = selectedTestId
    const requestId = ++latestGradingRequestIdRef.current
    const isStaleRequest = () => {
      const currentSelection = gradingSelectionRef.current
      return (
        latestGradingRequestIdRef.current !== requestId ||
        currentSelection.workspaceState !== 'selected' ||
        currentSelection.selectedWorkspaceTab !== 'grading' ||
        currentSelection.selectedTestId !== requestedTestId
      )
    }

    if (preserveRows) {
      setGradingRefreshing(true)
    } else {
      setGradingLoading(true)
    }
    setGradingError('')
    try {
      const response = await fetch(`${apiBasePath}/${requestedTestId}/results`, { cache: 'no-store' })
      const data = await response.json()
      if (isStaleRequest()) return
      if (!response.ok) throw new Error(data.error || 'Failed to load test results')

      const nextStatus =
        data?.quiz?.status === 'draft' || data?.quiz?.status === 'active' || data?.quiz?.status === 'closed'
          ? (data.quiz.status as Quiz['status'])
          : null

      setGradingServerTestStatus(nextStatus)
      setGradingServerTestId(requestedTestId)
      setTestAiGradingRun((data.active_ai_grading_run as TestAiGradingRunSummary | null) ?? null)
      if (nextStatus) {
        setTests((prev) =>
          prev.map((test) =>
            test.id === requestedTestId && test.status !== nextStatus ? { ...test, status: nextStatus } : test
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
      if (isStaleRequest()) return
      setGradingError(error.message || 'Failed to load test results')
      if (!preserveRows) {
        setGradingStudents([])
        setGradingQuestions([])
        setTestAiGradingRun(null)
      }
    } finally {
      if (isStaleRequest()) return
      setGradingLoading(false)
      setGradingRefreshing(false)
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
    onSelectTest?.(workspaceState === 'selected' ? selectedTestWorkspace : null)
  }, [onSelectTest, selectedTestWorkspace, workspaceState])

  useEffect(() => {
    gradingSelectionRef.current = {
      workspaceState,
      selectedWorkspaceTab,
      selectedTestId,
    }
  }, [selectedTestId, selectedWorkspaceTab, workspaceState])

  useEffect(() => {
    if (!selectedTestId || loading) return
    if (tests.some((test) => test.id === selectedTestId)) return

    clearTestWorkspace({ replace: true })
    clearBatchSelection()
  }, [clearBatchSelection, clearTestWorkspace, loading, selectedTestId, tests])

  useEffect(() => {
    setSelectedTestDraftSummary(null)
    setStudentAttemptEditMode(false)
    setPendingDeleteStudentAttempt(null)
    setPendingUnsubmitStudent(null)
    setPendingOpenAccessStudent(null)
    setPendingCloseAccessStudent(null)
    setShowUnsubmitConfirm(false)
    setShowCloseAccessConfirm(false)
    setPendingCloseAccessStudentIds(null)
    setPendingDeleteStudentAttemptIds(null)
  }, [selectedTestId])

  useEffect(() => {
    if (previousTestsTabClickTokenRef.current === testsTabClickToken) return
    previousTestsTabClickTokenRef.current = testsTabClickToken

    setTestEditMode(false)
    if (workspaceState !== 'selected') return

    clearTestWorkspace()
    setGradingError('')
    setGradingWarning('')
    setGradingInfo('')
    clearBatchSelection()
  }, [clearBatchSelection, clearTestWorkspace, testsTabClickToken, workspaceState])

  useEffect(() => {
    if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading') {
      setSelectedStudentId(null)
      setGradingStudents([])
      setGradingQuestions([])
      setGradingServerTestStatus(null)
      setGradingServerTestId(null)
      setGradingLoading(false)
      setGradingRefreshing(false)
      setTestAiGradingRun(null)
      clearBatchSelection()
      return
    }

    void loadGradingRows()
  }, [clearBatchSelection, loadGradingRows, selectedWorkspaceTab, setSelectedStudentId, workspaceState])

  useEffect(() => {
    if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading') return
    if (!studentAttemptEditMode && batchSelectedCount === 0 && !selectedStudentId) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"]')) return

      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase()
        if (
          target.isContentEditable ||
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select'
        ) {
          return
        }
      }

      event.preventDefault()
      setStudentAttemptEditMode(false)
      clearBatchSelection()
      if (selectedStudentId) {
        selectGradingStudent(null)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [
    batchSelectedCount,
    clearBatchSelection,
    selectGradingStudent,
    selectedStudentId,
    selectedWorkspaceTab,
    studentAttemptEditMode,
    workspaceState,
  ])

  useEffect(() => {
    if (workspaceState !== 'selected' || !selectedTestId) return
    if (selectedWorkspaceTab === 'grading' || !selectedStudentId) return

    navigateTestWorkspace(
      { testId: selectedTestId, mode: selectedWorkspaceTab, studentId: null },
      { replace: true },
    )
  }, [navigateTestWorkspace, selectedStudentId, selectedTestId, selectedWorkspaceTab, workspaceState])

  useEffect(() => {
    if (
      workspaceState !== 'selected' ||
      selectedWorkspaceTab !== 'grading' ||
      !selectedTestId ||
      !selectedStudentId ||
      gradingLoading ||
      gradingServerTestId !== selectedTestId
    ) {
      return
    }

    if (gradingStudents.some((student) => student.student_id === selectedStudentId)) return

    navigateTestWorkspace(
      { testId: selectedTestId, mode: 'grading', studentId: null },
      { replace: true },
    )
  }, [
    gradingLoading,
    gradingServerTestId,
    gradingStudents,
    navigateTestWorkspace,
    selectedStudentId,
    selectedTestId,
    selectedWorkspaceTab,
    workspaceState,
  ])

  useEffect(() => {
    if (workspaceState !== 'selected') {
      setHasPendingMarkdownImport(false)
    }
  }, [workspaceState])

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
        await loadGradingRows({ preserveRows: true })
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
    if (
      workspaceState !== 'selected' ||
      selectedWorkspaceTab !== 'grading' ||
      !selectedTestId ||
      !activeTestAiRunId ||
      !hasActiveTestAiRun
    ) {
      return
    }

    let isCancelled = false
    let timeoutId: number | undefined

    const syncRun = async () => {
      const testId = selectedTestId
      const runId = activeTestAiRunId
      let shouldContinue = true
      let nextDelayMs = 2000

      try {
        const statusResponse = await fetch(
          `${apiBasePath}/${testId}/auto-grade-runs/${runId}`,
        )
        const statusData = await statusResponse.json().catch(() => ({}))
        if (!isCancelled && statusResponse.ok && statusData.run) {
          const nextRun = statusData.run as TestAiGradingRunSummary
          setTestAiGradingRun(nextRun)
          if (!isTestAiGradingRunActive(nextRun)) {
            shouldContinue = false
            return
          }

          const statusDelayMs = getTestAiRunPollDelayMs(nextRun)
          nextDelayMs = statusDelayMs
          if (statusDelayMs > 2500) {
            return
          }
        }

        const tickResponse = await fetch(
          `${apiBasePath}/${testId}/auto-grade-runs/${runId}/tick`,
          {
            method: 'POST',
          },
        )
        const tickData = await tickResponse.json().catch(() => ({}))
        if (!isCancelled && tickResponse.ok && tickData.run) {
          const nextRun = tickData.run as TestAiGradingRunSummary
          setTestAiGradingRun(nextRun)
          if (!isTestAiGradingRunActive(nextRun)) {
            shouldContinue = false
          } else {
            nextDelayMs = getTestAiRunPollDelayMs(nextRun)
          }
        }
      } catch {
        // Keep the run visible; the next poll cycle can recover.
      } finally {
        if (!isCancelled && shouldContinue) {
          timeoutId = window.setTimeout(syncRun, nextDelayMs)
        }
      }
    }

    void syncRun()

    return () => {
      isCancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    activeTestAiRunId,
    apiBasePath,
    hasActiveTestAiRun,
    selectedTestId,
    selectedWorkspaceTab,
    workspaceState,
  ])

  useEffect(() => {
    if (!activeTestAiRun || hasActiveTestAiRun) return

    const handledKey = `${activeTestAiRun.id}:${activeTestAiRun.status}:${activeTestAiRun.processed_count}:${activeTestAiRun.failed_count}`
    if (handledCompletedRunKeysRef.current.has(handledKey)) return
    handledCompletedRunKeysRef.current.add(handledKey)

    const message = formatTestAiGradingRunMessage(activeTestAiRun)
    clearBatchSelection()
    void loadGradingRows()
    setTestGradingPanelRefreshToken((prev) => prev + 1)
    onTestGradingDataRefresh?.()

    if (message.error) {
      setGradingError(message.error)
      setGradingInfo('')
    } else {
      showMessage({ text: message.info, tone: 'info' })
      setGradingInfo('')
      setGradingError('')
    }
  }, [activeTestAiRun, clearBatchSelection, hasActiveTestAiRun, loadGradingRows, onTestGradingDataRefresh, showMessage])

  function handleOpenTest(test: QuizWithStats) {
    navigateTestWorkspace({ testId: test.id, mode: 'grading', studentId: null })
    setGradingError('')
    setGradingWarning('')
    setGradingInfo('')
    clearBatchSelection()
  }

  function handleEditTest(test: QuizWithStats) {
    handleOpenTest(test)
    setTestEditModalView('edit')
    setShowEditModal(true)
  }

  function handleOpenSavedTestPreview(preview: { testId: string; title: string }) {
    if (onRequestTestPreview) {
      onRequestTestPreview(preview)
      return
    }

    const previewWindow = window.open(
      `/classrooms/${classroom.id}/tests/${preview.testId}/preview`,
      '_blank',
    )
    previewWindow?.focus()
  }

  useEffect(() => {
    setTestEditSaveStatus('saved')
  }, [selectedTestId])

  function handleNewTest() {
    setShowModal(true)
  }

  function handleTestCreated(_test: Quiz) {
    setShowModal(false)
    setTestEditMode(false)
    clearTestWorkspace({ replace: true })
    window.dispatchEvent(
      new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
    )
  }

  async function handleDeleteTest() {
    if (!pendingDeleteTest) return

    setIsDeletingTest(true)
    try {
      const response = await fetch(`${apiBasePath}/${pendingDeleteTest.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete test')
      }

      setTests((prev) => prev.filter((test) => test.id !== pendingDeleteTest.id))
      if (selectedTestId === pendingDeleteTest.id) {
        clearTestWorkspace({ replace: true })
      }
      setPendingDeleteTest(null)
      setTestEditMode(false)
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
      )
      showMessage({ text: 'Deleted test', tone: 'info' })
    } catch (error: any) {
      setStatusActionError(error?.message || 'Failed to delete test')
    } finally {
      setIsDeletingTest(false)
    }
  }

  const handleTestDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || isReorderingTests || isReadOnly || !testEditMode) return

      const oldIndex = tests.findIndex((test) => test.id === active.id)
      const newIndex = tests.findIndex((test) => test.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(tests, oldIndex, newIndex)
      setTests(reordered)
      setIsReorderingTests(true)
      try {
        const response = await fetch(`${apiBasePath}/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            test_ids: reordered.map((test) => test.id),
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Failed to save test order')
        }

        window.dispatchEvent(
          new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
        )
      } catch (error) {
        console.error('Failed to reorder tests:', error)
        showMessage({ text: 'Failed to save test order', tone: 'warning' })
        void loadTests()
      } finally {
        setIsReorderingTests(false)
      }
    },
    [
      apiBasePath,
      classroom.id,
      isReadOnly,
      isReorderingTests,
      loadTests,
      showMessage,
      testEditMode,
      tests,
    ]
  )

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
        }),
      })
      const data = await response.json()
      if (response.status === 202 && data.run) {
        setTestAiGradingRun(data.run as TestAiGradingRunSummary)
        if (!options?.preserveSelection) {
          clearBatchSelection()
        }
        showMessage({ text: 'Grading started', tone: 'info' })
        return
      }
      if (response.status === 409 && data.run) {
        setTestAiGradingRun(data.run as TestAiGradingRunSummary)
        throw new Error(data.error || 'Another grading run is already active')
      }
      if (!response.ok) throw new Error(data.error || 'Auto-grade failed')

      const summary = (data.summary ?? {}) as {
        message?: string
        skipped_unanswered_count?: number
        skipped_already_graded_count?: number
      }
      const summaryParts: string[] = []
      if (summary.message) {
        summaryParts.push(summary.message)
      }
      if (Number(summary.skipped_unanswered_count ?? 0) > 0) {
        summaryParts.push(`${summary.skipped_unanswered_count} unanswered`)
      }
      if (Number(summary.skipped_already_graded_count ?? 0) > 0) {
        summaryParts.push(`${summary.skipped_already_graded_count} already graded`)
      }
      showMessage({ text: summaryParts.join(' • ') || 'No AI grading was needed', tone: 'info' })
      setGradingInfo('')
      if (!options?.preserveSelection) {
        clearBatchSelection()
      }
      await loadGradingRows()
      setTestGradingPanelRefreshToken((prev) => prev + 1)
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Auto-grade failed')
    } finally {
      setIsBatchAutoGrading(false)
    }
  }

  async function handleBatchReturn() {
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
      setTestGradingPanelRefreshToken((prev) => prev + 1)
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Return failed')
    } finally {
      setIsBatchReturning(false)
    }
  }

  async function handleBatchStudentAccess(state: 'open' | 'closed', options?: { studentIds?: string[] }) {
    const targetStudentIds = options?.studentIds || Array.from(batchSelectedIds)
    if (!selectedTestId || targetStudentIds.length === 0) return

    setIsBatchUpdatingAccess(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/student-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_ids: targetStudentIds,
          state,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Access update failed')

      const updatedCount = Number(data.updated_count ?? 0)
      const skippedCount = Number(data.skipped_count ?? 0)
      setGradingInfo(
        `${state === 'open' ? 'Opened' : 'Closed'} access for ${updatedCount} student${updatedCount === 1 ? '' : 's'}${skippedCount > 0 ? ` • ${skippedCount} skipped` : ''}`
      )

      clearBatchSelection()
      setShowCloseAccessConfirm(false)
      setPendingOpenAccessStudent(null)
      setPendingCloseAccessStudent(null)
      setPendingCloseAccessStudentIds(null)
      await loadGradingRows()
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Access update failed')
    } finally {
      setIsBatchUpdatingAccess(false)
    }
  }

  async function handleBatchUnsubmit() {
    const targetStudentIds = pendingUnsubmitStudent
      ? [pendingUnsubmitStudent.student_id]
      : batchSelectedStudentIds
    if (!selectedTestId || targetStudentIds.length === 0) return

    setIsBatchUnsubmitting(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`/api/teacher/tests/${selectedTestId}/unsubmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: targetStudentIds }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Unsubmit failed')
      }

      const unsubmittedCount = Number(data.unsubmitted_count || 0)
      const skippedCount = Number(data.skipped_count || 0)
      showMessage({
        text: `Marked ${unsubmittedCount} student${unsubmittedCount === 1 ? '' : 's'} unsubmitted${skippedCount > 0 ? ` • ${skippedCount} skipped` : ''}`,
        tone: 'info',
      })

      clearBatchSelection()
      setShowUnsubmitConfirm(false)
      setPendingUnsubmitStudent(null)
      await loadGradingRows()
      setTestGradingPanelRefreshToken((prev) => prev + 1)
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Unsubmit failed')
    } finally {
      setIsBatchUnsubmitting(false)
    }
  }

  async function handleDeleteStudentAttempt() {
    if (!selectedTestId || !pendingDeleteStudentAttempt) return

    const student = pendingDeleteStudentAttempt
    setIsDeletingStudentAttempt(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/students/${student.student_id}/attempt`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Delete failed')
      }

      const deletedAttempts = Number(data.deleted_attempts ?? 0)
      const deletedResponses = Number(data.deleted_responses ?? 0)
      const studentLabel = student.name || student.email || 'student'
      showMessage({
        text: deletedAttempts > 0 || deletedResponses > 0
          ? `Deleted ${studentLabel}'s test work`
          : `No test work found for ${studentLabel}`,
        tone: 'info',
      })

      if (selectedStudentId === student.student_id) {
        selectGradingStudent(null)
      }
      clearBatchSelection()
      setPendingDeleteStudentAttempt(null)
      await loadGradingRows()
      setTestGradingPanelRefreshToken((prev) => prev + 1)
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Delete failed')
    } finally {
      setIsDeletingStudentAttempt(false)
    }
  }

  async function handleDeleteSelectedStudentAttempts() {
    if (!selectedTestId || !pendingDeleteStudentAttemptIds || pendingDeleteStudentAttemptIds.length === 0) return

    setIsDeletingStudentAttempt(true)
    setGradingError('')
    setGradingInfo('')
    try {
      let deletedCount = 0
      for (const studentId of pendingDeleteStudentAttemptIds) {
        const response = await fetch(`${apiBasePath}/${selectedTestId}/students/${studentId}/attempt`, {
          method: 'DELETE',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Delete failed')
        }
        const deletedAttempts = Number(data.deleted_attempts ?? 0)
        const deletedResponses = Number(data.deleted_responses ?? 0)
        if (deletedAttempts > 0 || deletedResponses > 0) {
          deletedCount += 1
        }
      }

      showMessage({
        text: `Deleted test work for ${deletedCount} student${deletedCount === 1 ? '' : 's'}`,
        tone: 'info',
      })

      if (selectedStudentId && pendingDeleteStudentAttemptIds.includes(selectedStudentId)) {
        selectGradingStudent(null)
      }
      clearBatchSelection()
      setPendingDeleteStudentAttemptIds(null)
      await loadGradingRows()
      setTestGradingPanelRefreshToken((prev) => prev + 1)
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Delete failed')
    } finally {
      setIsDeletingStudentAttempt(false)
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

      const nextStatus =
        data?.test?.status === 'draft' || data?.test?.status === 'active' || data?.test?.status === 'closed'
          ? data.test.status
          : payload.status === 'draft' || payload.status === 'active' || payload.status === 'closed'
            ? payload.status
            : undefined

      applyTestSummaryPatch(selectedTestId, {
        status: nextStatus,
        title: typeof data?.test?.title === 'string' ? data.test.title : undefined,
        show_results: typeof data?.test?.show_results === 'boolean' ? data.test.show_results : undefined,
        questions_count:
          typeof data?.test?.stats?.questions_count === 'number' ? data.test.stats.questions_count : undefined,
      })

      if (nextStatus) {
        setGradingServerTestStatus(nextStatus)
        setGradingServerTestId(selectedTestId)
      }
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
    if (!selectedTest || !selectedTestWorkspace || isReadOnly || statusUpdating || checkingActivation) return

    const activation = validateSelectedTestActivation(selectedTestWorkspace.stats.questions_count || 0)
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

  function validateSelectedTestActivation(questionCount: number): { valid: boolean; error?: string } {
    if (questionCount < 1) {
      return { valid: false, error: 'Test must have at least 1 question' }
    }
    return { valid: true }
  }

  const selectedActivation = selectedTestWorkspace
    ? validateSelectedTestActivation(selectedTestWorkspace.stats.questions_count || 0)
    : { valid: false }
  const isSelectedWorkspace = workspaceState === 'selected'
  const getEffectiveStudentAccess = useCallback((student: TestGradingStudentRow): 'open' | 'closed' => {
    return student.effective_access || (selectedTestWorkspace?.status === 'active' ? 'open' : 'closed')
  }, [selectedTestWorkspace?.status])
  const selectedOpenAccessCount = batchSelectedStudents.filter((student) => {
    return getEffectiveStudentAccess(student) === 'open'
  }).length
  const allOpenAccessCount = sortedGradingStudents.filter((student) => {
    return getEffectiveStudentAccess(student) === 'open'
  }).length
  const allStudentIds = useMemo(
    () => sortedGradingStudents.map((student) => student.student_id),
    [sortedGradingStudents]
  )
  const selectedClosedAccessCount = batchSelectedCount - selectedOpenAccessCount
  const shouldOpenSelectedAccess = batchSelectedCount > 0 && selectedClosedAccessCount >= selectedOpenAccessCount
  const accessPrimaryState: 'open' | 'closed' =
    batchSelectedCount > 0
      ? shouldOpenSelectedAccess ? 'open' : 'closed'
      : allOpenAccessCount > 0 ? 'closed' : 'open'
  const accessPrimaryCount = batchSelectedCount > 0 ? batchSelectedCount : allStudentIds.length
  const accessPrimaryScope = batchSelectedCount > 0 ? 'Selected' : 'All'
  const accessAlternateState: 'open' | 'closed' = accessPrimaryState === 'open' ? 'closed' : 'open'
  const closeAccessConfirmCount = pendingCloseAccessStudentIds?.length ?? batchSelectedCount
  const pendingCloseAccessStudentLabel =
    pendingCloseAccessStudent?.name || pendingCloseAccessStudent?.email || null
  const unsubmitConfirmTitle = pendingUnsubmitStudent
    ? `Mark ${pendingUnsubmitStudent.name || pendingUnsubmitStudent.email || 'this student'} unsubmitted?`
    : `Mark ${batchSelectedCount} selected attempt${batchSelectedCount === 1 ? '' : 's'} unsubmitted?`
  const isAccessActionDisabled =
    !selectedTestWorkspace ||
    isReadOnly ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    (accessPrimaryState === 'open' &&
      selectedTestWorkspace.status === 'draft' &&
      (!selectedActivation.valid || checkingActivation || statusUpdating || hasPendingMarkdownImport)) ||
    (accessPrimaryState === 'closed' && allStudentIds.length === 0)

  function getAccessActionLabel(state: 'open' | 'closed', scope: 'All' | 'Selected', count: number): string {
    const verb = state === 'open' ? 'Open' : 'Close'
    return scope === 'Selected' ? `${verb} ${count} Selected` : `${verb} All`
  }

  function getAccessActionIcon(state: 'open' | 'closed') {
    return state === 'open'
      ? <Unlock className="h-4 w-4 text-success" aria-hidden="true" />
      : <Lock className="h-4 w-4 text-danger" aria-hidden="true" />
  }

  function handleAccessAction(state: 'open' | 'closed') {
    if (!selectedTestWorkspace) return
    const targetStudentIds = batchSelectedCount > 0 ? batchSelectedStudentIds : allStudentIds

    if (state === 'open') {
      if (selectedTestWorkspace.status === 'draft') {
        void handleRequestSelectedTestActivate()
        return
      }
      void handleBatchStudentAccess('open', { studentIds: targetStudentIds })
      return
    }

    if (targetStudentIds.length === 0) return
    setPendingCloseAccessStudent(null)
    setPendingCloseAccessStudentIds(targetStudentIds)
    setShowCloseAccessConfirm(true)
  }

  function handleStudentAccessIconClick(student: TestGradingStudentRow, effectiveAccess: 'open' | 'closed') {
    if (isReadOnly || isCombinedTestActionsBusy) return

    if (effectiveAccess === 'open') {
      setPendingCloseAccessStudent(student)
      setPendingCloseAccessStudentIds([student.student_id])
      setShowCloseAccessConfirm(true)
      return
    }

    setPendingOpenAccessStudent(student)
  }

  const accessAlternateLabel = getAccessActionLabel(accessAlternateState, accessPrimaryScope, accessPrimaryCount)
  const accessAlternateDisabled =
    isReadOnly ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    (accessAlternateState === 'open' &&
      selectedTestWorkspace?.status === 'draft' &&
      (!selectedActivation.valid || checkingActivation || statusUpdating || hasPendingMarkdownImport)) ||
    (accessAlternateState === 'closed' && accessPrimaryCount === 0)

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

  const isCombinedTestActionsBusy =
    hasActiveTestAiRun ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    isDeletingStudentAttempt

  const handleGradingTablePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!selectedStudentId) return

      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-test-grading-student-row]')) return

      selectGradingStudent(null)
    },
    [selectGradingStudent, selectedStudentId]
  )

  const gradingTable = (
    <div
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      onPointerDownCapture={handleGradingTablePointerDown}
    >
      {gradingRefreshing ? (
        <RefreshingIndicator label="Refreshing grades" className="px-3 py-2" />
      ) : null}
      {gradingLoading && gradingStudents.length === 0 ? (
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
        <div className="min-h-0 w-full overflow-auto rounded-md border border-border bg-surface">
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
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Access</th>
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
                {studentAttemptEditMode ? (
                  <th className="w-11 px-2 py-2 font-medium">
                    <span className="sr-only">Delete student test</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sortedGradingStudents.map((student) => {
                const isSelected = student.student_id === selectedStudentId
                const scoreLabel =
                  student.status === 'not_started'
                    ? '—'
                    : `${formatPoints(student.points_earned)}/${formatPoints(student.points_possible)}`
                const statusMeta = getTestGradingWorkStatusDisplay(student.status)
                const awayCount = student.focus_summary?.away_count ?? 0
                const awaySeconds = student.focus_summary?.away_total_seconds ?? 0
                const awayMinutes = Math.floor(awaySeconds / 60)
                const awayRemainder = awaySeconds % 60
                const awayLabel = `${awayMinutes}:${String(awayRemainder).padStart(2, '0')}`
                const routeExitAttempts = student.focus_summary?.route_exit_attempts ?? 0
                const windowUnmaximizeAttempts = student.focus_summary?.window_unmaximize_attempts ?? 0
                const exitsCount = getQuizExitCount(student.focus_summary)
                const formattedLastActivity = formatTorontoTime(student.last_activity_at)
                const effectiveAccess =
                  student.effective_access || (selectedTestWorkspace?.status === 'active' ? 'open' : 'closed')
                const accessSource = student.access_source || 'test'
                const accessLabel = effectiveAccess === 'open' ? 'Open' : 'Closed'
                const AccessIcon = effectiveAccess === 'open' ? Unlock : Lock
                const accessIconClass = effectiveAccess === 'open' ? 'text-success' : 'text-danger'
                const accessTooltip =
                  accessSource === 'student'
                    ? `Access ${accessLabel.toLowerCase()} for this student`
                    : `Access ${accessLabel.toLowerCase()}, inherited from test status`
                const accessAriaLabel =
                  accessSource === 'student'
                    ? `Access ${accessLabel.toLowerCase()} for this student`
                    : `Access ${accessLabel.toLowerCase()}, inherited from test status`
                const studentLabel = student.name || student.email || 'student'
                const canToggleAccess =
                  !isReadOnly &&
                  !isCombinedTestActionsBusy &&
                  !(effectiveAccess === 'closed' && selectedTestWorkspace?.status === 'draft')
                const accessActionLabel =
                  effectiveAccess === 'open'
                    ? `Close access for ${studentLabel}`
                    : `Open access for ${studentLabel}`
                const accessActionTooltip =
                  effectiveAccess === 'open'
                    ? `Click to close access for ${studentLabel}.`
                    : selectedTestWorkspace?.status === 'draft'
                      ? 'Draft tests cannot be opened for students.'
                      : `Click to open access for ${studentLabel}.`
                const canUnsubmitStudent =
                  student.status === 'submitted' && !isReadOnly && !isCombinedTestActionsBusy

                return (
                  <tr
                    key={student.student_id}
                    data-test-grading-student-row=""
                    className={[
                      'cursor-pointer border-t border-border transition-colors hover:bg-surface-hover',
                      isSelected ? 'bg-surface-selected' : '',
                    ].join(' ')}
                    onClick={() => selectGradingStudent(student.student_id)}
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
                      {student.status === 'submitted' ? (
                        <Tooltip content={canUnsubmitStudent ? `${statusMeta.label}. Click to mark ${studentLabel} unsubmitted.` : statusMeta.label}>
                          <button
                            type="button"
                            className="inline-flex min-w-5 cursor-pointer items-center justify-center rounded-control p-0.5 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Status ${statusMeta.label}. Mark ${studentLabel} unsubmitted`}
                            disabled={!canUnsubmitStudent}
                            onClick={(event) => {
                              event.stopPropagation()
                              setPendingUnsubmitStudent(student)
                              setShowUnsubmitConfirm(true)
                            }}
                          >
                            <AssessmentStatusIndicator display={statusMeta} showLabel={false} />
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip content={statusMeta.label}>
                          <span
                            className="inline-flex min-w-5 cursor-help items-center justify-center"
                            aria-label={`Status ${statusMeta.label}`}
                          >
                            <AssessmentStatusIndicator display={statusMeta} showLabel={false} />
                          </span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Tooltip content={`${accessTooltip}. ${accessActionTooltip}`}>
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center justify-center rounded-control p-0.5 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`${accessAriaLabel}. ${accessActionLabel}`}
                          disabled={!canToggleAccess}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleStudentAccessIconClick(student, effectiveAccess)
                          }}
                        >
                          <AccessIcon className={`h-4 w-4 ${accessIconClass}`} aria-hidden="true" />
                        </button>
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
                    {studentAttemptEditMode ? (
                      <td className="px-2 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 px-0 text-danger"
                          aria-label={`Delete ${student.name || student.email || 'student'} test`}
                          disabled={isReadOnly || isCombinedTestActionsBusy || isDeletingStudentAttempt}
                          onClick={(event) => {
                            event.stopPropagation()
                            setPendingDeleteStudentAttempt(student)
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const selectedTestActions = selectedTestWorkspace ? (
    <SplitButton
      label={
        <span className="inline-flex items-center gap-2">
          {getAccessActionIcon(accessPrimaryState)}
          <span>{getAccessActionLabel(accessPrimaryState, accessPrimaryScope, accessPrimaryCount)}</span>
        </span>
      }
      onPrimaryClick={() => handleAccessAction(accessPrimaryState)}
      options={[
        {
          id: `${accessAlternateState}-${accessPrimaryScope.toLowerCase()}`,
          label: (
            <span className="inline-flex items-center gap-2">
              {getAccessActionIcon(accessAlternateState)}
              <span>{accessAlternateLabel}</span>
            </span>
          ),
          onSelect: () => handleAccessAction(accessAlternateState),
          disabled: accessAlternateDisabled,
        },
        {
          id: 'ai-grade',
          label: (
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4" aria-hidden="true" />
              <span>AI Grade</span>
            </span>
          ),
          onSelect: () => {
            setShowBatchGradeModal(true)
          },
          disabled:
            batchSelectedCount === 0 ||
            isCombinedTestActionsBusy,
        },
        {
          id: 'unsubmit-selected',
          label: (
            <span className="inline-flex items-center gap-2">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Unsubmit Selected</span>
            </span>
          ),
          onSelect: () => {
            if (batchSelectedCount === 0) {
              setGradingWarning('Select students to unsubmit')
              return
            }
            setPendingUnsubmitStudent(null)
            setShowUnsubmitConfirm(true)
          },
          disabled:
            batchSelectedCount === 0 ||
            isCombinedTestActionsBusy,
        },
        {
          id: 'return',
          label: (
            <span className="inline-flex items-center gap-2">
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>Return</span>
            </span>
          ),
          onSelect: () => {
            if (batchSelectedCount === 0) {
              setGradingWarning('Select students to return')
              return
            }
            if (selectedOpenAccessCount > 0) {
              setGradingError('Close selected students before returning')
              return
            }
            setShowReturnConfirm(true)
          },
          disabled:
            batchSelectedCount === 0 ||
            isCombinedTestActionsBusy,
        },
        ...(studentAttemptEditMode
          ? [
              {
                id: 'delete-selected',
                label: (
                  <span className="inline-flex items-center gap-2 text-danger">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span>Delete Selected</span>
                  </span>
                ),
                onSelect: () => {
                  if (batchSelectedCount === 0) {
                    setGradingWarning('Select students to delete')
                    return
                  }
                  setPendingDeleteStudentAttemptIds(batchSelectedStudentIds)
                },
                disabled:
                  batchSelectedCount === 0 ||
                  isCombinedTestActionsBusy,
              },
            ]
          : []),
      ]}
      variant="secondary"
      size="sm"
      className="inline-flex"
      toggleAriaLabel="More test actions"
      menuPlacement="down"
      primaryButtonProps={{
        'aria-label': getAccessActionLabel(accessPrimaryState, accessPrimaryScope, accessPrimaryCount),
        disabled: isAccessActionDisabled,
      }}
    />
  ) : null

  const workspaceModeStatus =
    selectedWorkspaceTab === 'grading' && selectedStudentId && testGradingSaveState.status !== 'idle' ? (
      <span
        className={[
          'text-xs',
          testGradingSaveState.status === 'saved'
            ? 'font-medium text-success'
            : testGradingSaveState.status === 'saving'
              ? 'text-text-muted'
              : 'text-warning',
        ].join(' ')}
      >
        {testGradingSaveState.status === 'saved'
          ? 'Saved'
          : testGradingSaveState.status === 'saving'
            ? 'Saving...'
            : 'Unsaved'}
      </span>
    ) : null

  const selectedWorkspaceControls = workspaceState === 'selected' ? (
    <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 sm:gap-3">
      {selectedTestActions}
      <Button
        type="button"
        variant={studentAttemptEditMode ? 'secondary' : 'ghost'}
        size="sm"
        className="h-9 w-9 px-0"
        aria-label="Edit"
        title="Edit"
        aria-pressed={studentAttemptEditMode}
        disabled={isReadOnly}
        onClick={() => setStudentAttemptEditMode((prev) => !prev)}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </Button>
      {workspaceModeStatus}
    </div>
  ) : null

  const activeTestGradingMessage =
    workspaceState === 'selected' && selectedWorkspaceTab === 'grading'
      ? hasActiveTestAiRun && activeTestAiRun
        ? `Grading ${Math.min(activeTestAiRun.processed_count, activeTestAiRun.requested_count)} of ${activeTestAiRun.requested_count} students…`
        : isBatchAutoGrading
          ? 'Starting grading…'
          : isBatchReturning
            ? 'Returning work…'
            : isBatchUnsubmitting
              ? 'Unsubmitting attempts…'
            : isBatchUpdatingAccess
                ? 'Updating access…'
                : isDeletingStudentAttempt
                  ? 'Deleting student test…'
                  : ''
      : ''
  useOverlayMessage(!!activeTestGradingMessage, activeTestGradingMessage, { tone: 'loading' })

  useEffect(() => {
    if (!gradingWarning) return
    if (batchSelectedCount > 0) {
      setGradingWarning('')
      return
    }
    if (workspaceState === 'selected' && selectedWorkspaceTab === 'grading' && !activeTestGradingMessage) {
      showMessage({ text: gradingWarning, tone: 'warning' })
    }
    setGradingWarning('')
  }, [
    activeTestGradingMessage,
    batchSelectedCount,
    gradingWarning,
    selectedWorkspaceTab,
    showMessage,
    workspaceState,
  ])

  useEffect(() => {
    if (!gradingInfo) return
    if (workspaceState === 'selected' && selectedWorkspaceTab === 'grading' && !activeTestGradingMessage) {
      showMessage({ text: gradingInfo, tone: 'info' })
    }
    setGradingInfo('')
  }, [
    activeTestGradingMessage,
    gradingInfo,
    selectedWorkspaceTab,
    showMessage,
    workspaceState,
  ])

  const primaryContent = workspaceState === 'selected' ? (
    <TeacherWorkSurfaceActionBar
      center={selectedWorkspaceControls}
      centerPlacement="floating"
    />
  ) : (
    <TeacherWorkSurfaceActionBar
      center={
        <div className="flex items-center justify-center gap-1.5">
          <Tooltip content="Create a new test">
            <Button
              onClick={handleNewTest}
              variant="primary"
              size="sm"
              className="gap-1.5"
              disabled={isReadOnly}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New
            </Button>
          </Tooltip>
          <TeacherEditModeControls
            active={testEditMode}
            onActiveChange={setTestEditMode}
            disabled={isReadOnly}
            variant="secondary"
          />
        </div>
      }
      centerPlacement="floating"
    />
  )

  const feedback = (
    <>
      {statusActionError && workspaceState === 'selected' ? (
        <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {statusActionError}
        </div>
      ) : null}
      {hasPendingMarkdownImport && workspaceState === 'selected' ? (
        <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          Apply or undo markdown changes before previewing or changing the test status.
        </div>
      ) : null}
      {gradingError && workspaceState === 'selected' && selectedWorkspaceTab === 'grading' ? (
        <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {gradingError}
        </div>
      ) : null}
    </>
  )

  const summaryContent = loading ? (
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
  ) : (
    <DndContext
      sensors={testSortSensors}
      collisionDetection={closestCenter}
      onDragEnd={handleTestDragEnd}
    >
      <SortableContext
        items={tests.map((test) => test.id)}
        strategy={verticalListSortingStrategy}
      >
        <TeacherWorkItemList>
          {tests.map((test) => (
            <TeacherTestCard
              key={test.id}
              test={test}
              isReadOnly={isReadOnly}
              isDragDisabled={isReorderingTests}
              editMode={testEditMode}
              onSelect={() => {
                if (testEditMode) {
                  handleEditTest(test)
                  return
                }
                handleOpenTest(test)
              }}
              onRequestPreview={() => handleOpenSavedTestPreview({ testId: test.id, title: test.title })}
              onRequestDelete={() => setPendingDeleteTest(test)}
            />
          ))}
        </TeacherWorkItemList>
      </SortableContext>
    </DndContext>
  )

  const gradingInspector = selectedTest && selectedStudentId ? (
    <TestStudentGradingPanel
      testId={selectedTest.id}
      selectedStudentId={selectedStudentId}
      apiBasePath={apiBasePath}
      refreshToken={testGradingPanelRefreshToken}
      onSaveStateChange={setTestGradingSaveState}
    />
  ) : null

  const workspaceContent = !selectedTest ? (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <TeacherWorkspaceSplit
      className="flex-1"
      splitVariant="gapped"
      primary={gradingTable}
      inspector={gradingInspector ? <div className="h-full min-h-0 overflow-y-auto">{gradingInspector}</div> : undefined}
      inspectorWidth={gradingInspectorWidth}
      inspectorCollapsed={false}
      onInspectorWidthChange={setGradingInspectorWidth}
      dividerLabel="Resize grading and student response panes"
      primaryClassName="min-h-[200px] rounded-lg bg-surface"
      inspectorClassName="rounded-lg bg-surface"
      minPrimaryPx={420}
      minInspectorPx={360}
    />
  )

  return (
    <>
      <TeacherWorkSurfaceShell
        state={workspaceState === 'selected' ? 'workspace' : 'summary'}
        primary={primaryContent}
        feedback={feedback}
        summary={summaryContent}
        workspace={workspaceContent}
        workspaceFrame="standalone"
        workspaceFrameClassName="min-h-[360px] border-0 bg-page"
      />

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
        isOpen={showEditModal && !!selectedTestWorkspace}
        onClose={() => {
          setShowEditModal(false)
          setTestEditModalView('edit')
          setHasPendingMarkdownImport(false)
        }}
        ariaLabelledBy="test-edit-title"
        maxWidth="max-w-6xl"
        className="h-[85vh] overflow-hidden p-0"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 id="test-edit-title" className="min-w-0 basis-full truncate text-base font-semibold text-text-default sm:basis-auto sm:flex-1">
            {selectedTestWorkspace ? `Edit ${selectedTestWorkspace.title}` : 'Edit test'}
          </h2>
          <Tooltip content="Markdown view">
            <Button
              type="button"
              variant={testEditModalView === 'markdown' ? 'subtle' : 'secondary'}
              size="sm"
              aria-pressed={testEditModalView === 'markdown'}
              className="gap-1.5"
              onClick={() => {
                setTestEditModalView((current) => (current === 'markdown' ? 'edit' : 'markdown'))
              }}
            >
              <Code className="h-4 w-4" aria-hidden="true" />
              <span>Code</span>
            </Button>
          </Tooltip>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!selectedTestWorkspace) return
              handleOpenSavedTestPreview({
                testId: selectedTestWorkspace.id,
                title: selectedTestWorkspace.title,
              })
            }}
            disabled={hasPendingMarkdownImport || !selectedTestWorkspace}
            className="gap-1.5"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Preview
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowEditModal(false)
              setTestEditModalView('edit')
              setHasPendingMarkdownImport(false)
            }}
          >
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedTestWorkspace ? (
            <QuizDetailPanel
              quiz={selectedTestWorkspace}
              classroomId={classroom.id}
              apiBasePath={apiBasePath}
              onDraftSummaryChange={handleSelectedTestDraftSummaryChange}
              onQuizUpdate={(update) => {
                if (update) {
                  applySelectedTestDraftSummary(update)
                  return
                }
                void loadTests()
              }}
              onPendingMarkdownImportChange={setHasPendingMarkdownImport}
              onSaveStatusChange={setTestEditSaveStatus}
              onRequestTestPreview={handleOpenSavedTestPreview}
              showInlineDeleteAction={false}
              testQuestionLayout={testEditModalView === 'markdown' ? 'markdown-only' : 'editor-only'}
              showPreviewButton={false}
              showResultsTab={false}
            />
          ) : null}
        </div>
      </DialogPanel>

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
            disabled={isBatchAutoGrading || hasActiveTestAiRun}
            onClick={() => {
              setShowBatchGradeModal(false)
              void handleBatchAutoGrade()
            }}
          >
            {isBatchAutoGrading ? 'Grading...' : 'Grade with AI'}
          </Button>
        </div>
      </DialogPanel>

      <ConfirmDialog
        isOpen={!!pendingDeleteTest}
        title="Delete test?"
        description="This permanently removes the test and responses."
        confirmLabel={isDeletingTest ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={isDeletingTest}
        isCancelDisabled={isDeletingTest}
        onCancel={() => setPendingDeleteTest(null)}
        onConfirm={() => {
          void handleDeleteTest()
        }}
      />

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
        isOpen={showCloseAccessConfirm}
        title={
          pendingCloseAccessStudentLabel
            ? `Close access for ${pendingCloseAccessStudentLabel}?`
            : `Close access for ${closeAccessConfirmCount} student(s)?`
        }
        description="Blocks access. Saved work stays available for grading."
        confirmLabel={isBatchUpdatingAccess ? 'Closing...' : 'Close Access'}
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchUpdatingAccess}
        isCancelDisabled={isBatchUpdatingAccess}
        onCancel={() => {
          setShowCloseAccessConfirm(false)
          setPendingCloseAccessStudent(null)
          setPendingCloseAccessStudentIds(null)
        }}
        onConfirm={() => {
          void handleBatchStudentAccess('closed', {
            studentIds: pendingCloseAccessStudentIds ?? Array.from(batchSelectedIds),
          })
        }}
      />

      <ConfirmDialog
        isOpen={!!pendingOpenAccessStudent}
        title={`Open access for ${pendingOpenAccessStudent?.name || pendingOpenAccessStudent?.email || 'this student'}?`}
        description="Allows the student to start or continue. Submission state is unchanged."
        confirmLabel={isBatchUpdatingAccess ? 'Opening...' : 'Open Access'}
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchUpdatingAccess}
        isCancelDisabled={isBatchUpdatingAccess}
        onCancel={() => setPendingOpenAccessStudent(null)}
        onConfirm={() => {
          if (!pendingOpenAccessStudent) return
          void handleBatchStudentAccess('open', {
            studentIds: [pendingOpenAccessStudent.student_id],
          })
        }}
      />

      <ConfirmDialog
        isOpen={showUnsubmitConfirm}
        title={unsubmitConfirmTitle}
        description="Keeps draft answers. Clears submitted/returned state and finalized grades. Access is unchanged."
        confirmLabel={isBatchUnsubmitting ? 'Unsubmitting...' : 'Mark Unsubmitted'}
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchUnsubmitting}
        isCancelDisabled={isBatchUnsubmitting}
        onCancel={() => {
          setShowUnsubmitConfirm(false)
          setPendingUnsubmitStudent(null)
        }}
        onConfirm={() => {
          void handleBatchUnsubmit()
        }}
      />

      <ConfirmDialog
        isOpen={!!pendingDeleteStudentAttempt}
        title={`Delete ${pendingDeleteStudentAttempt?.name || pendingDeleteStudentAttempt?.email || 'this student'}'s test work?`}
        description="Deletes answers, grades, and focus history for this student. Access is unchanged."
        confirmLabel={isDeletingStudentAttempt ? 'Deleting...' : 'Delete Work'}
        confirmVariant="danger"
        cancelLabel="Cancel"
        isConfirmDisabled={isDeletingStudentAttempt}
        isCancelDisabled={isDeletingStudentAttempt}
        onCancel={() => setPendingDeleteStudentAttempt(null)}
        onConfirm={() => {
          void handleDeleteStudentAttempt()
        }}
      />

      <ConfirmDialog
        isOpen={!!pendingDeleteStudentAttemptIds}
        title={`Delete ${pendingDeleteStudentAttemptIds?.length || 0} selected test work item${pendingDeleteStudentAttemptIds?.length === 1 ? '' : 's'}?`}
        description="Deletes answers, grades, and focus history. Access is unchanged."
        confirmLabel={isDeletingStudentAttempt ? 'Deleting...' : 'Delete Work'}
        confirmVariant="danger"
        cancelLabel="Cancel"
        isConfirmDisabled={isDeletingStudentAttempt}
        isCancelDisabled={isDeletingStudentAttempt}
        onCancel={() => setPendingDeleteStudentAttemptIds(null)}
        onConfirm={() => {
          void handleDeleteSelectedStudentAttempts()
        }}
      />

      <ConfirmDialog
        isOpen={showReturnConfirm}
        title={`Return test work to ${batchSelectedCount} selected student(s)?`}
        description="Only students with closed access and fully graded open-response questions will be returned."
        confirmLabel={
          isBatchReturning
            ? 'Returning...'
            : 'Return'
        }
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchReturning}
        isCancelDisabled={isBatchReturning}
        onCancel={() => setShowReturnConfirm(false)}
        onConfirm={() => {
          void handleBatchReturn()
        }}
      />
    </>
  )
}
