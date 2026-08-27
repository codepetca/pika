'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
import { Check, ClockAlert, EllipsisVertical, Lock, LogOut, Pencil, RotateCcw, Send, Trash2, Unlock, X } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { TeacherTestCard } from '@/components/TeacherTestCard'
import {
  AssessmentStatusIndicator,
  getTestGradingWorkStatusDisplay,
} from '@/components/AssessmentStatusIndicator'
import { TestStudentGradingPanel } from '@/components/TestStudentGradingPanel'
import { TeacherTestAuthoringDialog } from '@/components/test-workspace/TeacherTestAuthoringDialog'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconButton,
  TeacherWorkSurfaceIconMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherSelectionBar } from '@/components/teacher-work-surface/TeacherSelectionBar'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'
import { TeacherWorkItemList } from '@/components/teacher-work-surface/TeacherWorkItemList'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  TEACHER_TESTS_UPDATED_EVENT,
  TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
  type TeacherTestGradingRowUpdatedEventDetail,
} from '@/lib/events'
import { invalidateGradebookForClassroom } from '@/lib/gradebook-cache'
import { getTestExitCount } from '@/lib/tests'
import { fetchJSONWithCache } from '@/lib/request-cache'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import {
  readTeacherTestResultsFromPayload,
  readTestFromPayload,
  type TeacherTestGradingQuestionSummary as TestGradingQuestionSummary,
  type TeacherTestGradingStudentRow as TestGradingStudentRow,
  type TeacherTestResultsPayload,
} from '@/lib/test-api-contract'
import { applyTestSummaryPatchToTest } from '@/lib/test-summary-patch'
import { applyDirection, compareByNameFields, toggleSort } from '@/lib/table-sort'
import { useTableSelection } from '@/hooks/useTableSelection'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'
import { useTeacherTestList } from '@/hooks/useTeacherTestList'
import {
  useTestWorkspaceNavigation,
  type TestWorkspaceState as WorkspaceState,
  type TestWorkspaceTab as WorkspaceTab,
  type UpdateSearchParamsFn,
} from '@/hooks/useTestWorkspaceNavigation'
import {
  Button,
  ConfirmDialog,
  ColumnResizeHandle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DialogPanel,
  EmptyState,
  KeyboardNavigableTable,
  PageState,
  RefreshingIndicator,
  Select,
  SortableHeaderCell,
  SplitButton,
  TableSelectionCell,
  TableSelectionHeaderCell,
  Tooltip,
  cn,
  useAppMessage,
  useOverlayMessage,
  type SplitButtonProps,
} from '@/ui'
import type {
  AssessmentEditorSummaryUpdate,
  AssessmentWorkspaceSummaryPatch,
  Classroom,
  TestAssessment,
  TestAssessmentWithStats,
  TestAiGradingRunSummary,
} from '@/types'

const getTestGradingStudentRowId = (studentId: string) => `test-grading-student-row-${studentId}`

interface Props {
  classroom: Classroom
  testsTabClickToken?: number
  selectedTestId?: string | null
  selectedTestMode?: WorkspaceTab | null
  selectedTestStudentId?: string | null
  updateSearchParams?: UpdateSearchParamsFn
  onSelectTest?: (test: TestAssessmentWithStats | null) => void
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

type TestGradingSortColumn =
  | 'first_name'
  | 'last_name'
  | 'status'
  | 'access'
  | 'score'
  | 'last_activity'
  | 'exits'
  | 'away'
type TestGradingResizableColumn = 'first' | 'last' | 'status' | 'access' | 'score' | 'last_activity'
type TestGradingStatusSort = Extract<TestGradingStudentRow['status'], 'closed' | 'submitted' | 'returned'>

const TEST_GRADING_COLUMN_LIMITS = {
  first: { defaultWidth: 96, min: 72, max: 180 },
  last: { defaultWidth: 120, min: 80, max: 220 },
  status: { defaultWidth: 188, min: 152, max: 240 },
  access: { defaultWidth: 72, min: 56, max: 112 },
  score: { defaultWidth: 80, min: 64, max: 120 },
  last_activity: { defaultWidth: 104, min: 80, max: 160 },
} satisfies Record<TestGradingResizableColumn, { defaultWidth: number; min: number; max: number }>

const TEST_GRADING_SORTABLE_STATUSES: TestGradingStatusSort[] = ['closed', 'submitted', 'returned']

const TEST_GRADING_STATUS_CHIP_CLASSES: Record<TestGradingStatusSort, string> = {
  closed: 'bg-surface-3 text-text-muted',
  submitted: 'bg-success-bg text-success',
  returned: 'bg-info-bg text-primary',
}

const TEST_LIFECYCLE_LABELS: Record<NonNullable<TestAssessment['status']>, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
}

const TEST_LIFECYCLE_DOT_CLASSES: Record<NonNullable<TestAssessment['status']>, string> = {
  draft: 'bg-border-strong',
  active: 'bg-success-solid',
  closed: 'bg-border-strong',
}

const GRADING_POLL_INTERVAL_MS = 15_000

function getTestGradingExitCount(student: TestGradingStudentRow): number {
  return getTestExitCount(student.focus_summary)
}

function TestGradingStatusSortChip({
  status,
  count,
  active,
  onClick,
}: {
  status: TestGradingStatusSort
  count: number
  active: boolean
  onClick: () => void
}) {
  const label = getTestGradingWorkStatusDisplay(status).label
  const studentLabel = count === 1 ? 'student' : 'students'

  return (
    <Tooltip content={`${count} ${studentLabel} ${label.toLowerCase()}. Sort ${label.toLowerCase()} first`}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="rounded-badge px-0 py-0"
        aria-label={`Sort ${label} first, ${count} ${studentLabel}`}
        aria-pressed={active}
        onClick={onClick}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-badge px-2 text-sm font-semibold',
            TEST_GRADING_STATUS_CHIP_CLASSES[status],
            active && 'ring-foundation ring-focus ring-offset-2 ring-offset-surface',
          )}
        >
          {count}
        </span>
      </Button>
    </Tooltip>
  )
}

function TestWorkspacePaneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
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

function getEffectiveTestAccess(
  student: Pick<TestGradingStudentRow, 'effective_access'>,
  testStatus: TestAssessment['status'] | null | undefined,
): 'open' | 'closed' {
  return student.effective_access || (testStatus === 'active' ? 'open' : 'closed')
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

function withDefaultTestStats(test: TestAssessment): TestAssessmentWithStats {
  return {
    ...test,
    assessment_type: 'test',
    documents: test.documents,
    stats: {
      total_students: 0,
      responded: 0,
      submitted: 0,
      open_access: 0,
      closed_access: 0,
      questions_count: 0,
      ...((test as Partial<TestAssessmentWithStats>).stats ?? {}),
    },
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
  onRequestDelete,
}: Props) {
  const apiBasePath = '/api/teacher/tests'
  const isReadOnly = !!classroom.archived_at
  const previousTestsTabClickTokenRef = useRef(testsTabClickToken)
  const previousSelectedTestModeRef = useRef<WorkspaceTab | null | undefined>(selectedTestMode)
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
  const gradingExitCountsRef = useRef<{ testId: string | null; counts: Map<string, number> }>({
    testId: null,
    counts: new Map(),
  })
  const latestCreateTestRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  const testsRegionRef = useRef<HTMLDivElement>(null)
  const previousClassroomIdRef = useRef(classroom.id)
  const handledCompletedRunKeysRef = useRef<Set<string>>(new Set())

  const { showMessage } = useAppMessage()
  const [testEditMode, setTestEditMode] = useState(false)
  const [isReorderingTests, setIsReorderingTests] = useState(false)
  const [selectedTestDraftSummary, setSelectedTestDraftSummary] = useState<AssessmentEditorSummaryUpdate | null>(null)
  const [hasPendingMarkdownImport, setHasPendingMarkdownImport] = useState(false)
  const [isCreatingTest, setIsCreatingTest] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [pendingDeleteTest, setPendingDeleteTest] = useState<TestAssessmentWithStats | null>(null)
  const [isDeletingTest, setIsDeletingTest] = useState(false)

  const [gradingStudents, setGradingStudents] = useState<TestGradingStudentRow[]>([])
  const [unreviewedExitCounts, setUnreviewedExitCounts] = useState<Record<string, number>>({})
  const [exitAlertStudentId, setExitAlertStudentId] = useState<string | null>(null)
  const [gradingQuestions, setGradingQuestions] = useState<TestGradingQuestionSummary[]>([])
  const [gradingServerTestStatus, setGradingServerTestStatus] = useState<TestAssessment['status'] | null>(null)
  const [gradingServerTestId, setGradingServerTestId] = useState<string | null>(null)
  const [testAiGradingRun, setTestAiGradingRun] = useState<TestAiGradingRunSummary | null>(null)
  const [gradingLoading, setGradingLoading] = useState(false)
  const [gradingRefreshing, setGradingRefreshing] = useState(false)
  const [gradingError, setGradingError] = useState('')
  const [gradingSortState, setGradingSortState] = useState<{
    column: TestGradingSortColumn
    direction: 'asc' | 'desc'
    status: TestGradingStatusSort | null
  }>({ column: 'last_name', direction: 'asc', status: null })
  const [gradingInspectorWidth, setGradingInspectorWidth] = useState(50)
  const [testGradingPanelRefreshToken, setTestGradingPanelRefreshToken] = useState(0)
  const [testGradingSaveState, setTestGradingSaveState] = useState<{
    canSave: boolean
    isSaving: boolean
    status: 'idle' | 'unsaved' | 'saving' | 'saved'
    scopeKey: string | null
  }>({
    canSave: false,
    isSaving: false,
    status: 'idle',
    scopeKey: null,
  })

  const {
    selectedTestId,
    selectedWorkspaceTab,
    selectedStudentId,
    workspaceState,
    setSelectedStudentId,
    navigateTestWorkspace,
    clearTestWorkspace,
  } = useTestWorkspaceNavigation({
    selectedTestId: selectedTestIdProp,
    selectedTestMode,
    selectedTestStudentId,
    updateSearchParams,
  })
  const activeTestGradingSaveScopeKey =
    selectedTestId && selectedWorkspaceTab === 'grading' && selectedStudentId
      ? `${classroom.id}:${selectedTestId}:${selectedStudentId}`
      : null
  const handleTestGradingSaveStateChange = useCallback((state: {
    canSave: boolean
    isSaving: boolean
    status: 'idle' | 'unsaved' | 'saving' | 'saved'
    testId: string
    studentId: string | null
  }) => {
    const scopeKey = state.studentId
      ? `${classroom.id}:${state.testId}:${state.studentId}`
      : null
    setTestGradingSaveState({
      canSave: state.canSave,
      isSaving: state.isSaving,
      status: state.status,
      scopeKey,
    })
  }, [classroom.id])
  currentClassroomIdRef.current = classroom.id
  const {
    tests,
    setTests,
    visibleTests,
    loading,
    error: testsLoadError,
    hasLoadedSnapshot: hasTestsSnapshot,
    loadTests,
    retryTests,
  } = useTeacherTestList({
    classroomId: classroom.id,
    selectedTestId,
    selectedTestDraftSummary,
    apiBasePath,
  })
  const handleRetryTests = useCallback(() => {
    testsRegionRef.current?.focus()
    void retryTests()
  }, [retryTests])
  const [gradingInfo, setGradingInfo] = useState('')
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
  const [pendingOpenAccessStudentIds, setPendingOpenAccessStudentIds] = useState<string[] | null>(null)
  const [pendingCloseAccessStudentIds, setPendingCloseAccessStudentIds] = useState<string[] | null>(null)
  const [showBatchGradeModal, setShowBatchGradeModal] = useState(false)
  const [pendingDeleteStudentAttemptIds, setPendingDeleteStudentAttemptIds] = useState<string[] | null>(null)
  const [isDeletingStudentAttempt, setIsDeletingStudentAttempt] = useState(false)

  const [statusActionError, setStatusActionError] = useState('')

  useEffect(() => {
    const previousMode = previousSelectedTestModeRef.current
    previousSelectedTestModeRef.current = selectedTestMode

    if (selectedTestMode !== undefined && previousMode === 'authoring' && selectedTestMode !== 'authoring') {
      setShowEditModal(false)
      setHasPendingMarkdownImport(false)
    }
  }, [selectedTestMode])
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [checkingActivation, setCheckingActivation] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [activationDraftVersion, setActivationDraftVersion] = useState<number | null>(null)
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
    () => visibleTests.find((test) => test.id === selectedTestId) ?? null,
    [selectedTestId, visibleTests]
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
        const { column, direction, status } = gradingSortState
        const aNameParts = getSortableNameParts(a)
        const bNameParts = getSortableNameParts(b)
        if (column === 'first_name' || column === 'last_name') {
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
            column,
            direction,
          )
        }
        if (column === 'status') {
          if (status) {
            const statusRank = Number(b.status === status) - Number(a.status === status)
            if (statusRank !== 0) return statusRank
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
              'last_name',
              'asc',
            )
          }
          return applyDirection(a.status.localeCompare(b.status), direction)
        }
        if (column === 'access') {
          const aAccess = getEffectiveTestAccess(a, selectedTestWorkspace?.status)
          const bAccess = getEffectiveTestAccess(b, selectedTestWorkspace?.status)
          return applyDirection(aAccess.localeCompare(bAccess), direction)
        }
        if (column === 'score') {
          const aScore = a.points_possible > 0 ? a.points_earned / a.points_possible : -1
          const bScore = b.points_possible > 0 ? b.points_earned / b.points_possible : -1
          return applyDirection(aScore - bScore, direction)
        }
        if (column === 'last_activity') {
          const aActivity = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0
          const bActivity = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0
          return applyDirection(aActivity - bActivity, direction)
        }
        if (column === 'exits') {
          return applyDirection(getTestGradingExitCount(a) - getTestGradingExitCount(b), direction)
        }
        const aAway = a.focus_summary?.away_total_seconds ?? 0
        const bAway = b.focus_summary?.away_total_seconds ?? 0
        return applyDirection(aAway - bAway, direction)
      }),
    [gradingSortState, gradingStudents, selectedTestWorkspace?.status]
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
    someSelected: batchSelectionIndeterminate,
    clearSelection: clearBatchSelection,
    selectedCount: batchSelectedCount,
  } = useTableSelection(gradingRowIds)
  const { columnWidths: gradingColumnWidths, setColumnWidth: setGradingColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-test-grading:v2',
    columns: TEST_GRADING_COLUMN_LIMITS,
  })

  const handleGradingSort = useCallback((column: TestGradingSortColumn) => {
    setGradingSortState((previous) => ({ ...toggleSort(previous, column), status: null }))
  }, [])

  const handleGradingStatusSort = useCallback((status: TestGradingStatusSort) => {
    setGradingSortState({ column: 'status', direction: 'asc', status })
  }, [])

  const gradingStatusCounts = useMemo(() => {
    const counts: Record<TestGradingStatusSort, number> = { closed: 0, submitted: 0, returned: 0 }
    for (const student of gradingStudents) {
      if (student.status === 'closed' || student.status === 'submitted' || student.status === 'returned') {
        counts[student.status] += 1
      }
    }
    return counts
  }, [gradingStudents])

  const batchSelectedStudents = useMemo(
    () => sortedGradingStudents.filter((student) => batchSelectedIds.has(student.student_id)),
    [batchSelectedIds, sortedGradingStudents]
  )
  const batchSelectedStudentIds = useMemo(
    () => batchSelectedStudents.map((student) => student.student_id),
    [batchSelectedStudents]
  )
  const batchSelectedSubmittedStudents = useMemo(
    () => batchSelectedStudents.filter((student) => student.status === 'submitted'),
    [batchSelectedStudents]
  )
  const batchSelectedSubmittedStudentIds = useMemo(
    () => batchSelectedSubmittedStudents.map((student) => student.student_id),
    [batchSelectedSubmittedStudents]
  )
  const batchSelectedSubmittedCount = batchSelectedSubmittedStudents.length
  const hasOpenGradingAccess = useMemo(
    () =>
      sortedGradingStudents.some(
        (student) => getEffectiveTestAccess(student, selectedTestWorkspace?.status) === 'open'
      ),
    [selectedTestWorkspace?.status, sortedGradingStudents]
  )
  const exitAlertStudent = useMemo(
    () =>
      exitAlertStudentId
        ? sortedGradingStudents.find((student) => student.student_id === exitAlertStudentId) ?? null
        : null,
    [exitAlertStudentId, sortedGradingStudents]
  )

  const clearUnreviewedExitForStudent = useCallback((studentId: string) => {
    setUnreviewedExitCounts((prev) => {
      if (!(studentId in prev)) return prev
      const next = { ...prev }
      delete next[studentId]
      return next
    })
    setExitAlertStudentId((prev) => (prev === studentId ? null : prev))
  }, [])

  useEffect(() => {
    if (previousClassroomIdRef.current === classroom.id) return

    previousClassroomIdRef.current = classroom.id
    latestCreateTestRequestIdRef.current += 1
    latestGradingRequestIdRef.current += 1
    setTestEditMode(false)
    setIsReorderingTests(false)
    setIsCreatingTest(false)
    setShowEditModal(false)
    setHasPendingMarkdownImport(false)
    setPendingDeleteTest(null)
    setIsDeletingTest(false)
    setStatusActionError('')
    setSelectedTestDraftSummary(null)
    setGradingStudents([])
    setUnreviewedExitCounts({})
    setExitAlertStudentId(null)
    setGradingQuestions([])
    setGradingServerTestStatus(null)
    setGradingServerTestId(null)
    setTestAiGradingRun(null)
    setGradingLoading(false)
    setGradingRefreshing(false)
    setGradingError('')
    setGradingInfo('')
    setTestGradingSaveState({ canSave: false, isSaving: false, status: 'idle', scopeKey: null })
    setIsBatchAutoGrading(false)
    setIsBatchReturning(false)
    setIsBatchUnsubmitting(false)
    setIsBatchUpdatingAccess(false)
    setShowReturnConfirm(false)
    setShowUnsubmitConfirm(false)
    setPendingUnsubmitStudent(null)
    setPendingOpenAccessStudent(null)
    setPendingCloseAccessStudent(null)
    setShowCloseAccessConfirm(false)
    setPendingOpenAccessStudentIds(null)
    setPendingCloseAccessStudentIds(null)
    setShowBatchGradeModal(false)
    setPendingDeleteStudentAttemptIds(null)
    setIsDeletingStudentAttempt(false)
    setStatusUpdating(false)
    setCheckingActivation(false)
    setShowActivateConfirm(false)
    setShowCloseConfirm(false)
    clearBatchSelection()
    clearTestWorkspace({ replace: true })
  }, [classroom.id, clearBatchSelection, clearTestWorkspace])

  const {
    scrollRef: gradingStudentTableScrollRef,
    preserveScrollPosition: preserveGradingStudentTableScrollPosition,
  } = useScrollPositionMemory<HTMLDivElement>({
    key: selectedTestId && selectedWorkspaceTab === 'grading'
      ? `${classroom.id}:${selectedTestId}:grading`
      : null,
    enabled: selectedWorkspaceTab === 'grading',
    restoreToken: [
      selectedStudentId ?? 'none',
      sortedGradingStudents.length,
      gradingLoading ? 'loading' : 'ready',
      gradingRefreshing ? 'refreshing' : 'idle',
    ].join(':'),
  })

  const selectGradingStudent = useCallback((studentId: string | null) => {
    preserveGradingStudentTableScrollPosition()
    setSelectedStudentId(studentId)
    if (!selectedTestId || selectedWorkspaceTab !== 'grading') return
    navigateTestWorkspace({
      testId: selectedTestId,
      mode: 'grading',
      studentId,
    })
  }, [
    navigateTestWorkspace,
    preserveGradingStudentTableScrollPosition,
    selectedTestId,
    setSelectedStudentId,
    selectedWorkspaceTab,
  ])

  const scrollToGradingStudent = useCallback((studentId: string) => {
    const scrollPane = gradingStudentTableScrollRef.current
    if (!scrollPane) return

    const row = Array.from(scrollPane.querySelectorAll('[data-test-grading-student-row-id]')).find(
      (node) => node.getAttribute('data-test-grading-student-row-id') === studentId
    )
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center' })
    }
  }, [gradingStudentTableScrollRef])

  const handleGradingStudentSelect = useCallback((studentId: string) => {
    clearUnreviewedExitForStudent(studentId)
    selectGradingStudent(studentId)
  }, [clearUnreviewedExitForStudent, selectGradingStudent])

  const handleExitAlertClick = useCallback(() => {
    if (!exitAlertStudentId) return
    clearUnreviewedExitForStudent(exitAlertStudentId)
    selectGradingStudent(exitAlertStudentId)
    const scrollAfterSelect = () => {
      scrollToGradingStudent(exitAlertStudentId)
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scrollAfterSelect)
      return
    }
    scrollAfterSelect()
  }, [clearUnreviewedExitForStudent, exitAlertStudentId, scrollToGradingStudent, selectGradingStudent])

  const dismissExitAlert = useCallback(() => {
    setExitAlertStudentId(null)
  }, [])

  const recordGradingExitCountChanges = useCallback((
    testId: string,
    students: TestGradingStudentRow[]
  ) => {
    const nextCounts = new Map(
      students.map((student) => [student.student_id, getTestGradingExitCount(student)])
    )
    const previousSnapshot = gradingExitCountsRef.current

    if (previousSnapshot.testId !== testId || previousSnapshot.counts.size === 0) {
      gradingExitCountsRef.current = { testId, counts: nextCounts }
      setUnreviewedExitCounts({})
      setExitAlertStudentId(null)
      return
    }

    const increasedStudents = students.filter((student) => {
      const previousCount = previousSnapshot.counts.get(student.student_id) ?? 0
      const nextCount = nextCounts.get(student.student_id) ?? 0
      return nextCount > previousCount
    })

    gradingExitCountsRef.current = { testId, counts: nextCounts }

    setUnreviewedExitCounts((prev) => {
      const next: Record<string, number> = {}
      for (const [studentId, exitCount] of Object.entries(prev)) {
        if ((nextCounts.get(studentId) ?? 0) >= exitCount) {
          next[studentId] = exitCount
        }
      }
      for (const student of increasedStudents) {
        next[student.student_id] = nextCounts.get(student.student_id) ?? 0
      }
      return next
    })

    if (increasedStudents.length > 0) {
      setExitAlertStudentId((current) => {
        if (current && nextCounts.has(current)) return current
        return increasedStudents[0].student_id
      })
    }
  }, [])

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
      prev.map((test) => (test.id === testId ? applyTestSummaryPatchToTest(test, update) : test))
    )
  }, [setTests])

  const applySelectedTestDraftSummary = useCallback(
    (update: AssessmentEditorSummaryUpdate) => {
      if (!selectedTestId) return

      setSelectedTestDraftSummary(update)
      applyTestSummaryPatch(selectedTestId, update)
    },
    [applyTestSummaryPatch, selectedTestId]
  )
  const handleSelectedTestDraftSummaryChange = useCallback((update: AssessmentEditorSummaryUpdate) => {
    if (selectedTestId) {
      applyTestSummaryPatch(selectedTestId, update)
    }
    setSelectedTestDraftSummary(update)
  }, [applyTestSummaryPatch, selectedTestId])

  const loadGradingRows = useCallback(async (options?: { preserveRows?: boolean }) => {
    if (!selectedTestId) {
      setGradingStudents([])
      setGradingQuestions([])
      setGradingServerTestStatus(null)
      setGradingServerTestId(null)
      setTestAiGradingRun(null)
      setGradingRefreshing(false)
      gradingExitCountsRef.current = { testId: null, counts: new Map() }
      setUnreviewedExitCounts({})
      setExitAlertStudentId(null)
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
      const { ok, data } = await fetchJSONWithCache<{ ok: boolean; data: TeacherTestResultsPayload }>(
        `teacher-test-results:${requestedTestId}:${requestId}`,
        async () => {
          const response = await fetch(`${apiBasePath}/${requestedTestId}/results`, { cache: 'no-store' })
          return { ok: response.ok, data: await response.json() }
        },
        0,
      )
      if (isStaleRequest()) return
      const results = readTeacherTestResultsFromPayload(data)
      if (!ok) throw new Error(results.error || 'Failed to load test results')

      const nextStatus = results.testStatus
      setGradingServerTestStatus(nextStatus)
      setGradingServerTestId(requestedTestId)
      setTestAiGradingRun(results.activeAiGradingRun)
      if (nextStatus) {
        setTests((prev) =>
          prev.map((test) =>
            test.id === requestedTestId && test.status !== nextStatus ? { ...test, status: nextStatus } : test
          )
        )
      }
      const nextStudents = results.students
      recordGradingExitCountChanges(requestedTestId, nextStudents)
      setGradingStudents(nextStudents)
      setGradingQuestions(results.questions)
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
  }, [recordGradingExitCountChanges, selectedTestId, setTests])

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
    if (!selectedTestId || !hasTestsSnapshot) return
    if (visibleTests.some((test) => test.id === selectedTestId)) return

    clearTestWorkspace({ replace: true })
    clearBatchSelection()
  }, [clearBatchSelection, clearTestWorkspace, hasTestsSnapshot, selectedTestId, visibleTests])

  useEffect(() => {
    setSelectedTestDraftSummary(null)
    gradingExitCountsRef.current = { testId: selectedTestId, counts: new Map() }
    setUnreviewedExitCounts({})
    setExitAlertStudentId(null)
    setPendingUnsubmitStudent(null)
    setPendingOpenAccessStudent(null)
    setPendingCloseAccessStudent(null)
    setShowUnsubmitConfirm(false)
    setShowCloseAccessConfirm(false)
    setPendingOpenAccessStudentIds(null)
    setPendingCloseAccessStudentIds(null)
    setPendingDeleteStudentAttemptIds(null)
  }, [selectedTestId])

  useEffect(() => {
    if (!exitAlertStudentId) return
    if (gradingStudents.some((student) => student.student_id === exitAlertStudentId)) return
    setExitAlertStudentId(null)
  }, [exitAlertStudentId, gradingStudents])

  useEffect(() => {
    if (previousTestsTabClickTokenRef.current === testsTabClickToken) return
    previousTestsTabClickTokenRef.current = testsTabClickToken

    setTestEditMode(false)
    if (workspaceState !== 'selected') return

    clearTestWorkspace()
    setGradingError('')
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
      gradingExitCountsRef.current = { testId: null, counts: new Map() }
      setUnreviewedExitCounts({})
      setExitAlertStudentId(null)
      clearBatchSelection()
      return
    }

    void loadGradingRows()
  }, [clearBatchSelection, loadGradingRows, selectedWorkspaceTab, setSelectedStudentId, workspaceState])

  useEffect(() => {
    if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading') return
    if (batchSelectedCount === 0 && !selectedStudentId) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return

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
      gradingServerTestStatus !== 'active' ||
      !hasOpenGradingAccess
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
  }, [
    gradingServerTestId,
    gradingServerTestStatus,
    hasOpenGradingAccess,
    loadGradingRows,
    selectedTestId,
    selectedWorkspaceTab,
    workspaceState,
  ])

  useEffect(() => {
    function handleGradingRowUpdate(event: Event) {
      if (workspaceState !== 'selected' || selectedWorkspaceTab !== 'grading' || !selectedTestId) return

      const detail = (event as CustomEvent<TeacherTestGradingRowUpdatedEventDetail>).detail
      if (!detail || detail.testId !== selectedTestId) return

      invalidateGradebookForClassroom(classroom.id)
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
  }, [classroom.id, selectedTestId, selectedWorkspaceTab, workspaceState])

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
    invalidateGradebookForClassroom(classroom.id)
    onTestGradingDataRefresh?.()

    if (message.error) {
      setGradingError(message.error)
      setGradingInfo('')
    } else {
      showMessage({ text: message.info, tone: 'info' })
      setGradingInfo('')
      setGradingError('')
    }
  }, [activeTestAiRun, classroom.id, clearBatchSelection, hasActiveTestAiRun, loadGradingRows, onTestGradingDataRefresh, showMessage])

  function handleOpenTest(test: TestAssessmentWithStats) {
    navigateTestWorkspace({ testId: test.id, mode: 'grading', studentId: null })
    setGradingError('')
    setGradingInfo('')
    clearBatchSelection()
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

  async function handleNewTest() {
    if (isCreatingTest || isReadOnly || loading) return

    const requestId = latestCreateTestRequestIdRef.current + 1
    latestCreateTestRequestIdRef.current = requestId
    const requestedClassroomId = classroom.id
    const isCurrentCreate = () => (
      latestCreateTestRequestIdRef.current === requestId &&
      currentClassroomIdRef.current === requestedClassroomId
    )

    setIsCreatingTest(true)
    try {
      const response = await fetch(apiBasePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom_id: requestedClassroomId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create test')
      }
      const createdTest = readTestFromPayload<TestAssessment>(data)
      if (!createdTest) {
        throw new Error('Failed to create test')
      }
      if (!isCurrentCreate()) return
      handleTestCreated(createdTest)
    } catch (error: any) {
      if (!isCurrentCreate()) return
      showMessage({ text: error?.message || 'Failed to create test', tone: 'warning' })
    } finally {
      if (isCurrentCreate()) {
        setIsCreatingTest(false)
      }
    }
  }

  function handleTestCreated(test: TestAssessment) {
    const createdTest = withDefaultTestStats(test)

    setTestEditMode(false)
    setHasPendingMarkdownImport(false)
    setSelectedTestDraftSummary(null)
    setTests((prev) => {
      const next = prev.filter((existing) => existing.id !== createdTest.id)
      return [createdTest, ...next]
    })
    navigateTestWorkspace({ testId: createdTest.id, mode: 'authoring', studentId: null }, { replace: true })
    setShowEditModal(true)
    window.dispatchEvent(
      new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
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
        new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
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

      const oldIndex = visibleTests.findIndex((test) => test.id === active.id)
      const newIndex = visibleTests.findIndex((test) => test.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(visibleTests, oldIndex, newIndex)
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
          new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
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
      setTests,
      showMessage,
      testEditMode,
      visibleTests,
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
      invalidateGradebookForClassroom(classroom.id)
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
      invalidateGradebookForClassroom(classroom.id)
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
    const previousAccessByStudentId = new Map(
      gradingStudents
        .filter((student) => targetStudentIds.includes(student.student_id))
        .map((student) => [
          student.student_id,
          student.effective_access || (selectedTestWorkspace?.status === 'active' ? 'open' : 'closed'),
        ] as const)
    )

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
      if (updatedCount > 0) {
        setTests((prev) =>
          prev.map((test) => {
            if (test.id !== selectedTestId) return test

            const totalStudents = test.stats.total_students || gradingStudents.length || 0
            const fallbackOpenAccess = test.status === 'active' ? totalStudents : 0
            let openAccessCount =
              typeof test.stats.open_access === 'number' ? test.stats.open_access : fallbackOpenAccess

            for (const studentId of targetStudentIds) {
              const previousAccess = previousAccessByStudentId.get(studentId)
              if (!previousAccess || previousAccess === state) continue
              openAccessCount += state === 'open' ? 1 : -1
            }

            const clampedOpenAccessCount = Math.min(Math.max(openAccessCount, 0), totalStudents)
            return {
              ...test,
              stats: {
                ...test.stats,
                open_access: clampedOpenAccessCount,
                closed_access: Math.max(totalStudents - clampedOpenAccessCount, 0),
              },
            }
          })
        )
      }

      clearBatchSelection()
      setShowCloseAccessConfirm(false)
      setPendingOpenAccessStudent(null)
      setPendingOpenAccessStudentIds(null)
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
      : batchSelectedSubmittedStudentIds
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
      invalidateGradebookForClassroom(classroom.id)
      onTestGradingDataRefresh?.()
    } catch (error: any) {
      setGradingError(error.message || 'Unsubmit failed')
    } finally {
      setIsBatchUnsubmitting(false)
    }
  }

  async function handleDeleteSelectedStudentAttempts() {
    if (!selectedTestId || !pendingDeleteStudentAttemptIds || pendingDeleteStudentAttemptIds.length === 0) return

    const targetStudentIds = pendingDeleteStudentAttemptIds
    setIsDeletingStudentAttempt(true)
    setGradingError('')
    setGradingInfo('')
    try {
      const response = await fetch(`${apiBasePath}/${selectedTestId}/students/attempts/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: targetStudentIds }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Delete failed')
      }

      const deletedCount = Number(data.deleted_student_count ?? 0)
      setGradingInfo(`Deleted test work for ${deletedCount} student${deletedCount === 1 ? '' : 's'}`)
      if (selectedStudentId && targetStudentIds.includes(selectedStudentId)) {
        selectGradingStudent(null)
      }
      clearBatchSelection()
      setPendingDeleteStudentAttemptIds(null)
      await loadGradingRows()
      setTestGradingPanelRefreshToken((prev) => prev + 1)
      invalidateGradebookForClassroom(classroom.id)
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

      const responseTest = readTestFromPayload<TestAssessmentWithStats>(data)
      const nextStatus =
        responseTest?.status === 'draft' || responseTest?.status === 'active' || responseTest?.status === 'closed'
          ? responseTest.status
          : payload.status === 'draft' || payload.status === 'active' || payload.status === 'closed'
            ? payload.status
            : undefined

      applyTestSummaryPatch(selectedTestId, {
        status: nextStatus,
        title: typeof responseTest?.title === 'string' ? responseTest.title : undefined,
        show_results: typeof responseTest?.show_results === 'boolean' ? responseTest.show_results : undefined,
        questions_count:
          typeof responseTest?.stats?.questions_count === 'number' ? responseTest.stats.questions_count : undefined,
      })

      if (nextStatus) {
        setGradingServerTestStatus(nextStatus)
        setGradingServerTestId(selectedTestId)
      }
    } catch (error: any) {
      setStatusActionError(error?.message || 'Failed to update test')
    } finally {
      setStatusUpdating(false)
      setActivationDraftVersion(null)
      setShowActivateConfirm(false)
      setShowCloseConfirm(false)
    }
  }

  async function handleSelectedTestStatusChange(newStatus: 'active' | 'closed') {
    if (newStatus === 'active') {
      if (activationDraftVersion === null) {
        setStatusActionError('Reload the saved Test draft before activating')
        return
      }
      await patchSelectedTest({ status: newStatus, draft_version: activationDraftVersion })
      return
    }
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
      const { ok, data } = await fetchJSONWithCache<{ ok: boolean; data: any }>(
        `teacher-test-detail:${selectedTest.id}`,
        async () => {
          const response = await fetch(`${apiBasePath}/${selectedTest.id}`)
          return { ok: response.ok, data: await response.json() }
        },
        0,
      )
      if (!ok) {
        throw new Error(data.error || 'Failed to validate test')
      }

      const questions = Array.isArray(data.questions) ? data.questions : []
      const draftVersion = Number(data.draft_version)
      if (!Number.isInteger(draftVersion) || draftVersion < 1) {
        setStatusActionError('Test draft version is unavailable. Reload and try again.')
        return
      }
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

      setActivationDraftVersion(draftVersion)
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
    return getEffectiveTestAccess(student, selectedTestWorkspace?.status)
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
  const selectedAccessPrimaryState: 'open' | 'closed' = shouldOpenSelectedAccess ? 'open' : 'closed'
  const selectedAccessAlternateState: 'open' | 'closed' = selectedAccessPrimaryState === 'open' ? 'closed' : 'open'
  const allAccessPrimaryState: 'open' | 'closed' = allOpenAccessCount > 0 ? 'closed' : 'open'
  const allAccessAlternateState: 'open' | 'closed' = allAccessPrimaryState === 'open' ? 'closed' : 'open'
  const openAccessConfirmCount = pendingOpenAccessStudentIds?.length ?? batchSelectedCount
  const closeAccessConfirmCount = pendingCloseAccessStudentIds?.length ?? batchSelectedCount
  const pendingCloseAccessStudentLabel =
    pendingCloseAccessStudent?.name || pendingCloseAccessStudent?.email || null
  const unsubmitConfirmTitle = pendingUnsubmitStudent
    ? `Mark ${pendingUnsubmitStudent.name || pendingUnsubmitStudent.email || 'this student'} unsubmitted?`
    : `Mark ${batchSelectedSubmittedCount} selected attempt${batchSelectedSubmittedCount === 1 ? '' : 's'} unsubmitted?`
  const isAllAccessActionDisabled =
    !selectedTestWorkspace ||
    isReadOnly ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    (allAccessPrimaryState === 'open' &&
      selectedTestWorkspace.status === 'draft' &&
      (!selectedActivation.valid || checkingActivation || statusUpdating || hasPendingMarkdownImport)) ||
    (allAccessPrimaryState === 'closed' && allStudentIds.length === 0)

  const isSelectedAccessActionDisabled =
    batchSelectedCount === 0 ||
    !selectedTestWorkspace ||
    isReadOnly ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    (selectedAccessPrimaryState === 'open' &&
      selectedTestWorkspace.status === 'draft' &&
      (!selectedActivation.valid || checkingActivation || statusUpdating || hasPendingMarkdownImport))

  function getAccessActionLabel(state: 'open' | 'closed', scope: 'All' | 'Selected', count: number): string {
    const verb = state === 'open' ? 'Open' : 'Close'
    return scope === 'Selected' ? `${verb} ${count} Selected` : `${verb} All`
  }

  function getAccessActionIcon(state: 'open' | 'closed') {
    return state === 'open'
      ? <Unlock className="h-4 w-4 text-success" aria-hidden="true" />
      : <Lock className="h-4 w-4 text-danger" aria-hidden="true" />
  }

  function handleAccessAction(state: 'open' | 'closed', scope: 'all' | 'selected') {
    if (!selectedTestWorkspace) return
    const targetStudentIds = scope === 'selected' ? batchSelectedStudentIds : allStudentIds

    if (state === 'open') {
      if (selectedTestWorkspace.status === 'draft') {
        void handleRequestSelectedTestActivate()
        return
      }
      if (targetStudentIds.length === 0) return
      setPendingOpenAccessStudent(null)
      setPendingOpenAccessStudentIds(targetStudentIds)
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

  const allAccessAlternateLabel = getAccessActionLabel(allAccessAlternateState, 'All', allStudentIds.length)
  const allAccessAlternateDisabled =
    isReadOnly ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    (allAccessAlternateState === 'open' &&
      selectedTestWorkspace?.status === 'draft' &&
      (!selectedActivation.valid || checkingActivation || statusUpdating || hasPendingMarkdownImport)) ||
    (allAccessAlternateState === 'closed' && allStudentIds.length === 0)
  const selectedAccessAlternateDisabled =
    batchSelectedCount === 0 ||
    isReadOnly ||
    isBatchAutoGrading ||
    isBatchReturning ||
    isBatchUnsubmitting ||
    isBatchUpdatingAccess ||
    (selectedAccessAlternateState === 'open' &&
      selectedTestWorkspace?.status === 'draft' &&
      (!selectedActivation.valid || checkingActivation || statusUpdating || hasPendingMarkdownImport))

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
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      onPointerDownCapture={handleGradingTablePointerDown}
    >
      {exitAlertStudent ? (
        <div
          className="border-b border-warning bg-warning-bg px-3 py-2"
          aria-live="polite"
          data-testid="test-exit-detected-alert"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleExitAlertClick}
              className="inline-flex min-w-0 items-center gap-2 rounded-control px-2 py-1 text-sm font-semibold text-warning transition-colors hover:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>Exit detected</span>
            </button>
            <button
              type="button"
              onClick={dismissExitAlert}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-control text-warning transition-colors hover:bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning"
              aria-label="Dismiss exit detected alert"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
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
        <KeyboardNavigableTable
          ariaLabel="Test grading students"
          rowKeys={gradingRowIds}
          selectedKey={selectedStudentId}
          onSelectKey={handleGradingStudentSelect}
          getRowId={getTestGradingStudentRowId}
          className="flex min-h-0 w-full flex-1 flex-col rounded-none"
        >
          <TeacherWorkSurfaceTableFrame
            ref={gradingStudentTableScrollRef}
            selectionActive={batchSelectedCount > 0}
            className="min-h-0 rounded-md border border-border"
            data-testid="test-grading-student-scroll-pane"
            onScroll={preserveGradingStudentTableScrollPosition}
          >
          <DataTable density="tight" className="table-fixed text-sm">
            <colgroup>
              <col style={{ width: '40px' }} />
              <col style={{ width: `${gradingColumnWidths.first}px` }} />
              <col style={{ width: `${gradingColumnWidths.last}px` }} />
              <col style={{ width: `${gradingColumnWidths.access}px` }} />
              <col className="hidden md:table-column" style={{ width: `${gradingColumnWidths.score}px` }} />
              <col className="hidden xl:table-column" style={{ width: `${gradingColumnWidths.last_activity}px` }} />
              <col className="hidden xl:table-column" style={{ width: '64px' }} />
              <col className="hidden xl:table-column" style={{ width: '64px' }} />
              <col style={{ width: `${gradingColumnWidths.status}px` }} />
            </colgroup>
            <DataTableHead sticky>
              <DataTableRow>
                <TableSelectionHeaderCell
                  checked={batchAllSelected}
                  indeterminate={batchSelectionIndeterminate}
                  onChange={toggleBatchSelectAll}
                  ariaLabel="Select all students"
                />
                <SortableHeaderCell
                  label="First"
                  isActive={gradingSortState.column === 'first_name'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('first_name')}
                  buttonClassName="!px-2 !pr-5 sm:!px-3 sm:!pr-5"
                  resize={{
                    value: gradingColumnWidths.first,
                    min: TEST_GRADING_COLUMN_LIMITS.first.min,
                    max: TEST_GRADING_COLUMN_LIMITS.first.max,
                    onChange: (width) => setGradingColumnWidth('first', width),
                  }}
                />
                <SortableHeaderCell
                  label="Last"
                  isActive={gradingSortState.column === 'last_name'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('last_name')}
                  buttonClassName="!px-2 !pr-5 sm:!px-3 sm:!pr-5"
                  resize={{
                    value: gradingColumnWidths.last,
                    min: TEST_GRADING_COLUMN_LIMITS.last.min,
                    max: TEST_GRADING_COLUMN_LIMITS.last.max,
                    onChange: (width) => setGradingColumnWidth('last', width),
                  }}
                />
                <SortableHeaderCell
                  label="Access"
                  isActive={gradingSortState.column === 'access'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('access')}
                  buttonClassName="!px-1.5 !pr-4 sm:!px-3 sm:!pr-4"
                  resize={{
                    value: gradingColumnWidths.access,
                    min: TEST_GRADING_COLUMN_LIMITS.access.min,
                    max: TEST_GRADING_COLUMN_LIMITS.access.max,
                    onChange: (width) => setGradingColumnWidth('access', width),
                  }}
                />
                <SortableHeaderCell
                  label="Score"
                  isActive={gradingSortState.column === 'score'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('score')}
                  className="hidden md:table-cell"
                  buttonClassName="!px-1.5 !pr-4 sm:!px-3 sm:!pr-4"
                  resize={{
                    value: gradingColumnWidths.score,
                    min: TEST_GRADING_COLUMN_LIMITS.score.min,
                    max: TEST_GRADING_COLUMN_LIMITS.score.max,
                    onChange: (width) => setGradingColumnWidth('score', width),
                  }}
                />
                <SortableHeaderCell
                  label="Activity"
                  isActive={gradingSortState.column === 'last_activity'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('last_activity')}
                  className="hidden xl:table-cell"
                  buttonClassName="!pr-5"
                  resize={{
                    value: gradingColumnWidths.last_activity,
                    min: TEST_GRADING_COLUMN_LIMITS.last_activity.min,
                    max: TEST_GRADING_COLUMN_LIMITS.last_activity.max,
                    onChange: (width) => setGradingColumnWidth('last_activity', width),
                  }}
                />
                <SortableHeaderCell
                  label="Exits"
                  isActive={gradingSortState.column === 'exits'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('exits')}
                  align="center"
                  className="hidden xl:table-cell"
                  buttonClassName="!px-1"
                />
                <SortableHeaderCell
                  label="Away"
                  isActive={gradingSortState.column === 'away'}
                  direction={gradingSortState.direction}
                  onClick={() => handleGradingSort('away')}
                  align="center"
                  className="hidden xl:table-cell"
                  buttonClassName="!px-1"
                />
                <DataTableHeaderCell
                  className="group relative !p-0"
                  aria-label="Status"
                  aria-sort={gradingSortState.column === 'status' ? 'other' : 'none'}
                  style={{ width: `${gradingColumnWidths.status}px`, maxWidth: `${gradingColumnWidths.status}px` }}
                >
                  <div className="flex min-h-control items-center gap-0.5 px-1 sm:px-2">
                    <span className="hidden shrink-0 2xl:inline">Status</span>
                    <span
                      role="group"
                      aria-label="Sort Test grading by status"
                      className="flex min-w-0 items-center"
                    >
                      {TEST_GRADING_SORTABLE_STATUSES.map((status) => (
                        <TestGradingStatusSortChip
                          key={status}
                          status={status}
                          count={gradingStatusCounts[status]}
                          active={gradingSortState.column === 'status' && gradingSortState.status === status}
                          onClick={() => handleGradingStatusSort(status)}
                        />
                      ))}
                    </span>
                  </div>
                  <ColumnResizeHandle
                    label="Status"
                    value={gradingColumnWidths.status}
                    min={TEST_GRADING_COLUMN_LIMITS.status.min}
                    max={TEST_GRADING_COLUMN_LIMITS.status.max}
                    onChange={(width) => setGradingColumnWidth('status', width)}
                  />
                </DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {sortedGradingStudents.map((student) => {
                const isSelected = student.student_id === selectedStudentId
                const studentNameParts = getSortableNameParts(student)
                const scoreLabel =
                  student.status === 'not_started'
                    ? '—'
                    : `${formatPoints(student.points_earned)}/${formatPoints(student.points_possible)}`
                const statusMeta = getTestGradingWorkStatusDisplay(student.status)
                const awayCount = student.focus_summary?.away_count ?? 0
                const awaySeconds = Math.max(
                  0,
                  Math.round(student.focus_summary?.away_total_seconds ?? 0)
                )
                const awayMinutes = Math.floor(awaySeconds / 60)
                const awayRemainder = awaySeconds % 60
                const awayLabel = `${awayMinutes}:${String(awayRemainder).padStart(2, '0')}`
                const routeExitAttempts = student.focus_summary?.route_exit_attempts ?? 0
                const windowUnmaximizeAttempts = student.focus_summary?.window_unmaximize_attempts ?? 0
                const exitsCount = getTestGradingExitCount(student)
                const formattedLastActivity = formatTorontoTime(student.last_activity_at)
                const effectiveAccess = getEffectiveTestAccess(student, selectedTestWorkspace?.status)
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
                const hasUnreviewedExit = unreviewedExitCounts[student.student_id] !== undefined
                const exitsClassName = exitsCount > 0
                  ? 'inline-flex min-w-6 cursor-help items-center justify-center rounded-badge border border-warning bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning'
                  : 'cursor-help text-text-muted'

                return (
                  <DataTableRow
                    key={student.student_id}
                    id={getTestGradingStudentRowId(student.student_id)}
                    tabIndex={-1}
                    data-test-grading-student-row=""
                    data-test-grading-student-row-id={student.student_id}
                    data-testid={`test-grading-student-row-${student.student_id}`}
                    aria-selected={isSelected}
                    className={[
                      'cursor-pointer transition-colors',
                      isSelected
                        ? 'border-l-2 border-l-primary bg-surface-selected shadow-sm'
                        : hasUnreviewedExit
                          ? 'border-l-2 border-l-warning bg-warning-bg hover:bg-warning-bg'
                          : 'hover:bg-surface-hover',
                    ].join(' ')}
                    style={
                      !isSelected && hasUnreviewedExit
                        ? {
                            boxShadow:
                              'inset 4px 0 0 var(--color-warning), inset 0 0 0 9999px color-mix(in srgb, var(--color-warning) 14%, transparent)',
                          }
                        : undefined
                    }
                    onClick={() => handleGradingStudentSelect(student.student_id)}
                  >
                    <TableSelectionCell
                      checked={batchSelectedIds.has(student.student_id)}
                      onChange={() => toggleBatchSelect(student.student_id)}
                      ariaLabel={`Select ${student.name || 'student'}`}
                      className="py-2 sm:!px-3"
                    />
                    <DataTableCell className="min-w-0 max-w-0 px-2 py-2 sm:px-3 lg:max-w-none">
                      {student.name ? <span className="sr-only">{student.name}</span> : null}
                      <span className="block truncate font-medium text-text-default" title={studentNameParts.firstName || undefined}>
                        {studentNameParts.firstName || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="min-w-0 max-w-0 px-2 py-2 sm:px-3 lg:max-w-none">
                      <span className="block truncate font-medium text-text-default" title={studentNameParts.lastName || undefined}>
                        {studentNameParts.lastName || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="px-2 py-2 sm:px-3">
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
                    </DataTableCell>
                    <DataTableCell className="hidden px-2 py-2 text-text-default sm:px-3 md:table-cell">{scoreLabel}</DataTableCell>
                    <DataTableCell
                      className={[
                        'hidden px-3 py-2 tabular-nums xl:table-cell',
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
                    </DataTableCell>
                    <DataTableCell className="hidden px-3 py-2 text-xs tabular-nums xl:table-cell">
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
                          className={exitsClassName}
                          aria-label={`Exits ${exitsCount}. Away/focus ${awayCount}, in-app exits ${routeExitAttempts}, window/full-screen exits ${windowUnmaximizeAttempts}.`}
                        >
                          {exitsCount}
                        </span>
                      </Tooltip>
                    </DataTableCell>
                    <DataTableCell className="hidden px-3 py-2 text-xs text-text-muted tabular-nums xl:table-cell">
                      <Tooltip content={`Away from test route for ${awayLabel} total.`}>
                        <span
                          className="cursor-help"
                          aria-label={`Away time ${awayLabel}. Away from test route for ${awayLabel} total.`}
                        >
                          {awayLabel}
                        </span>
                      </Tooltip>
                    </DataTableCell>
                    <DataTableCell className="px-2 py-2 sm:px-3">
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
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
            </DataTableBody>
          </DataTable>
          </TeacherWorkSurfaceTableFrame>
        </KeyboardNavigableTable>
      )}
      <TeacherSelectionBar
        selectedCount={batchSelectedCount}
        onClear={clearBatchSelection}
        clearDisabled={isCombinedTestActionsBusy}
        ariaLabel="Selected student Test actions"
        className="max-w-4xl bg-surface backdrop-blur-none"
      >
        <SplitButton
          label={(
            <span className="inline-flex items-center gap-2">
              {getAccessActionIcon(selectedAccessPrimaryState)}
              <span>{getAccessActionLabel(selectedAccessPrimaryState, 'Selected', batchSelectedCount)}</span>
            </span>
          )}
          onPrimaryClick={() => handleAccessAction(selectedAccessPrimaryState, 'selected')}
          options={[{
            id: `${selectedAccessAlternateState}-selected`,
            label: (
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                {getAccessActionIcon(selectedAccessAlternateState)}
                <span>{getAccessActionLabel(selectedAccessAlternateState, 'Selected', batchSelectedCount)}</span>
              </span>
            ),
            onSelect: () => handleAccessAction(selectedAccessAlternateState, 'selected'),
            disabled: selectedAccessAlternateDisabled,
          }]}
          variant="secondary"
          size="sm"
          toggleAriaLabel="More selected access actions"
          menuPlacement="up"
          primaryButtonProps={{
            'aria-label': getAccessActionLabel(selectedAccessPrimaryState, 'Selected', batchSelectedCount),
            disabled: isSelectedAccessActionDisabled,
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isCombinedTestActionsBusy}
          onClick={() => setShowBatchGradeModal(true)}
        >
          <Check className="h-4 w-4" aria-hidden="true" /> AI Grade
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={batchSelectedSubmittedCount === 0 || isCombinedTestActionsBusy}
          onClick={() => {
            setPendingUnsubmitStudent(null)
            setShowUnsubmitConfirm(true)
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Unsubmit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isCombinedTestActionsBusy}
          onClick={() => {
            if (selectedOpenAccessCount > 0) {
              setGradingError('Close selected students before returning')
              return
            }
            setShowReturnConfirm(true)
          }}
        >
          <Send className="h-4 w-4" aria-hidden="true" /> Return
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={isCombinedTestActionsBusy}
          onClick={() => setPendingDeleteStudentAttemptIds(batchSelectedStudentIds)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete Work
        </Button>
      </TeacherSelectionBar>
    </div>
  )

  function openSelectedTestEditor() {
    if (!selectedTestWorkspace) return
    navigateTestWorkspace({ testId: selectedTestWorkspace.id, mode: 'authoring', studentId: null })
    setHasPendingMarkdownImport(false)
    setShowEditModal(true)
  }

  const selectedTestAction: SplitButtonProps | null = selectedTestWorkspace ? {
      label: (
        <span className="inline-flex items-center gap-2">
          {getAccessActionIcon(allAccessPrimaryState)}
          <span>{getAccessActionLabel(allAccessPrimaryState, 'All', allStudentIds.length)}</span>
        </span>
      ),
      onPrimaryClick: () => handleAccessAction(allAccessPrimaryState, 'all'),
      options: [
        {
          id: `${allAccessAlternateState}-all`,
          label: (
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              {getAccessActionIcon(allAccessAlternateState)}
              <span>{allAccessAlternateLabel}</span>
            </span>
          ),
          onSelect: () => handleAccessAction(allAccessAlternateState, 'all'),
          disabled: allAccessAlternateDisabled,
        },
      ],
      variant: 'secondary',
      size: 'sm',
      className: 'inline-flex',
      toggleAriaLabel: 'More whole-Test access actions',
      menuPlacement: 'down',
      primaryButtonProps: {
        'aria-label': getAccessActionLabel(allAccessPrimaryState, 'All', allStudentIds.length),
        disabled: isAllAccessActionDisabled,
      },
    } : null

  const deleteTestAction: TeacherWorkSurfaceActionItem | null = selectedTestWorkspace ? {
    id: 'delete-test',
    label: 'Delete Test',
    icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
    onSelect: () => {
      if (onRequestDelete) {
        onRequestDelete()
        return
      }
      setPendingDeleteTest(selectedTestWorkspace)
    },
    disabled: isReadOnly || isCombinedTestActionsBusy,
    destructive: true,
  } : null

  const testUtilityActions: TeacherWorkSurfaceActionItem[] = selectedTestWorkspace && deleteTestAction ? [
    {
      id: 'edit-test',
      label: 'Edit Test',
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
      onSelect: openSelectedTestEditor,
      disabled: isReadOnly,
    },
    deleteTestAction,
  ] : []

  const workspaceModeStatus =
    activeTestGradingSaveScopeKey &&
    testGradingSaveState.scopeKey === activeTestGradingSaveScopeKey &&
    testGradingSaveState.status !== 'idle' ? (
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

  const selectedTestControls = selectedTestAction ? (
    <div
      data-testid="test-workspace-actionbar-center"
      className="flex min-w-0 items-center justify-center gap-2"
    >
      <TeacherWorkSurfaceActionCluster>
        <SplitButton {...selectedTestAction} />
      </TeacherWorkSurfaceActionCluster>
    </div>
  ) : null

  const selectedTestLifecycleStatus =
    gradingServerTestId === selectedTestWorkspace?.id && gradingServerTestStatus
      ? gradingServerTestStatus
      : selectedTestWorkspace?.status ?? null

  const selectedTestContext = selectedTestLifecycleStatus ? (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', TEST_LIFECYCLE_DOT_CLASSES[selectedTestLifecycleStatus])}
        aria-hidden="true"
      />
      <span className="truncate">{TEST_LIFECYCLE_LABELS[selectedTestLifecycleStatus]}</span>
      {workspaceModeStatus ? <span className="hidden items-center gap-1 xl:inline-flex">· {workspaceModeStatus}</span> : null}
    </div>
  ) : workspaceModeStatus

  const selectedTestUtilities = deleteTestAction ? (
    <div className="flex items-center" data-testid="test-workspace-trailing-actions">
      <div className="sm:hidden">
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="Test utilities"
          tooltip="Test utilities"
          variant="ghost"
          icon={<EllipsisVertical className="h-4 w-4" aria-hidden="true" />}
          items={testUtilityActions}
          menuAriaLabel="Test utilities"
        />
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        <TeacherWorkSurfaceIconButton
          ariaLabel="Edit Test"
          tooltip="Edit Test"
          variant="ghost"
          icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          onClick={openSelectedTestEditor}
          disabled={isReadOnly}
        />
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="More Test utilities"
          tooltip="More Test utilities"
          variant="ghost"
          icon={<EllipsisVertical className="h-4 w-4" aria-hidden="true" />}
          items={[deleteTestAction]}
          menuAriaLabel="More Test utilities"
        />
      </div>
    </div>
  ) : null

  const testGradingSaveAnnouncement =
    activeTestGradingSaveScopeKey && testGradingSaveState.scopeKey === activeTestGradingSaveScopeKey
      ? testGradingSaveState.status === 'saved'
        ? 'Grades saved'
        : testGradingSaveState.status === 'saving'
          ? 'Saving grades'
          : testGradingSaveState.status === 'unsaved'
            ? 'Unsaved grade changes'
            : ''
      : ''

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
    <TeacherWorkSurfaceContextBar
      ariaLabel="Test grading controls and status"
      testId="test-grading-context-bar"
      context={selectedTestContext}
      primary={selectedTestControls}
      actions={selectedTestUtilities}
      trailingClassName="overflow-visible"
    />
  ) : (
    <TeacherWorkSurfaceActionBar
      center={
        <TeacherWorkSurfaceActionCluster>
          <Button
            type="button"
            variant="primary"
            size="sm"
            aria-label="New test"
            onClick={handleNewTest}
            disabled={isReadOnly || isCreatingTest || loading}
          >
            {isCreatingTest ? 'Creating...' : 'New Test'}
          </Button>
          <TeacherWorkSurfaceIconButton
            ariaLabel="Organize tests"
            icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setTestEditMode((prev) => !prev)}
            disabled={isReadOnly}
            pressed={testEditMode}
            tooltip={testEditMode ? 'Done organizing tests' : 'Organize tests'}
          />
        </TeacherWorkSurfaceActionCluster>
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

  const testListContent = visibleTests.length === 0 ? (
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
        items={visibleTests.map((test) => test.id)}
        strategy={verticalListSortingStrategy}
      >
        <TeacherWorkItemList>
          {visibleTests.map((test) => (
            <TeacherTestCard
              key={test.id}
              test={test}
              isReadOnly={isReadOnly}
              isDragDisabled={isReorderingTests}
              editMode={testEditMode}
              onSelect={() => handleOpenTest(test)}
              onRequestPreview={() => handleOpenSavedTestPreview({ testId: test.id, title: test.title })}
              onRequestDelete={() => setPendingDeleteTest(test)}
            />
          ))}
        </TeacherWorkItemList>
      </SortableContext>
    </DndContext>
  )

  const summaryContent = !hasTestsSnapshot ? (
    testsLoadError ? (
      <PageState
        kind="error"
        title="Tests unavailable"
        description="Pika couldn't load this classroom's tests. Nothing was changed."
        compact
        action={<Button type="button" onClick={handleRetryTests}>Retry</Button>}
      />
    ) : (
      <PageState kind="loading" title="Loading tests" compact />
    )
  ) : (
    <div className="space-y-3">
      {loading ? <RefreshingIndicator label="Refreshing tests" /> : null}
      {testsLoadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          <span>Tests could not be refreshed. Showing the last loaded list.</span>
          <Button type="button" variant="secondary" size="sm" onClick={handleRetryTests}>
            Retry
          </Button>
        </div>
      ) : null}
      {testListContent}
    </div>
  )

  const gradingInspector = selectedTest && selectedStudentId ? (
    <TestStudentGradingPanel
      testId={selectedTest.id}
      selectedStudentId={selectedStudentId}
      apiBasePath={apiBasePath}
      refreshToken={testGradingPanelRefreshToken}
      onSaveStateChange={handleTestGradingSaveStateChange}
    />
  ) : null
  const isTestEditorOpen = !!selectedTestWorkspace && (showEditModal || selectedWorkspaceTab === 'authoring')
  const handleCloseTestEditor = useCallback(() => {
    setShowEditModal(false)
    setHasPendingMarkdownImport(false)
    if (selectedTestId && selectedWorkspaceTab === 'authoring') {
      navigateTestWorkspace({ testId: selectedTestId, mode: 'grading', studentId: null }, { replace: true })
    }
  }, [navigateTestWorkspace, selectedTestId, selectedWorkspaceTab])

  const workspaceContent = !hasTestsSnapshot ? (
    testsLoadError ? (
      <PageState
        kind="error"
        title="Tests unavailable"
        description="Pika couldn't load this classroom's tests. Nothing was changed."
        compact
        action={<Button type="button" onClick={handleRetryTests}>Retry</Button>}
      />
    ) : (
      <PageState kind="loading" title="Loading tests" compact />
    )
  ) : !selectedTest ? (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <TeacherWorkspaceSplit
      className="flex-1"
      splitVariant="gapped"
      primary={
        <TestWorkspacePaneFrame>
          {gradingTable}
        </TestWorkspacePaneFrame>
      }
      inspector={gradingInspector ? (
        <TestWorkspacePaneFrame>
          <div
            className="h-full min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
            data-testid="test-grading-inspector-scroll-pane"
          >
            {gradingInspector}
          </div>
        </TestWorkspacePaneFrame>
      ) : undefined}
      inspectorWidth={gradingInspectorWidth}
      inspectorCollapsed={false}
      onInspectorWidthChange={setGradingInspectorWidth}
      dividerLabel="Resize grading and student response panes"
      primaryClassName="flex min-h-0 flex-col rounded-lg bg-surface"
      inspectorClassName="flex min-h-0 flex-col rounded-lg bg-surface"
      minPrimaryPx={420}
      minInspectorPx={360}
    />
  )

  return (
    <>
      <span
        data-testid="teacher-test-grading-save-status"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {testGradingSaveAnnouncement}
      </span>
      <div
        ref={testsRegionRef}
        role="region"
        aria-label="Tests"
        tabIndex={-1}
        className="h-full min-h-0 focus:outline-none"
      >
        <TeacherWorkSurfaceShell
          state={workspaceState === 'selected' ? 'workspace' : 'summary'}
          primary={primaryContent}
          feedback={feedback}
          summary={summaryContent}
          workspace={workspaceContent}
          workspaceFrame="standalone"
          workspaceFrameClassName="min-h-[360px] border-0 bg-page"
        />
      </div>

      <TeacherTestAuthoringDialog
        isOpen={isTestEditorOpen}
        test={selectedTestWorkspace}
        classroomId={classroom.id}
        apiBasePath={apiBasePath}
        hasPendingMarkdownImport={hasPendingMarkdownImport}
        onClose={handleCloseTestEditor}
        onDraftSummaryChange={handleSelectedTestDraftSummaryChange}
        onTestUpdate={(update) => {
          if (update) {
            applySelectedTestDraftSummary(update)
            return
          }
          void loadTests()
        }}
        onPendingMarkdownImportChange={setHasPendingMarkdownImport}
        onRequestPreview={handleOpenSavedTestPreview}
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
        onCancel={() => {
          setActivationDraftVersion(null)
          setShowActivateConfirm(false)
        }}
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
        isOpen={!!pendingOpenAccessStudentIds}
        title={`Open access for ${openAccessConfirmCount} student(s)?`}
        description="Allows students to start or continue. Submission state is unchanged."
        confirmLabel={isBatchUpdatingAccess ? 'Opening...' : 'Open Access'}
        cancelLabel="Cancel"
        isConfirmDisabled={isBatchUpdatingAccess}
        isCancelDisabled={isBatchUpdatingAccess}
        onCancel={() => setPendingOpenAccessStudentIds(null)}
        onConfirm={() => {
          void handleBatchStudentAccess('open', {
            studentIds: pendingOpenAccessStudentIds ?? Array.from(batchSelectedIds),
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
