'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
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
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Send,
} from 'lucide-react'
import { Button, ConfirmDialog, SplitButton, Tooltip } from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { Spinner } from '@/components/Spinner'
import { AssignmentModal } from '@/components/AssignmentModal'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import { AssignmentArtifactsCell } from '@/components/AssignmentArtifactsCell'
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'
import {
  ACTIONBAR_ICON_BUTTON_CLASSNAME,
  ACTIONBAR_BUTTON_PRIMARY_CLASSNAME,
  ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME,
  PageActionBar,
  PageContent,
  PageLayout,
  PageStack,
} from '@/components/PageLayout'
import { RightSidebarToggle } from '@/components/layout'
import {
  calculateAssignmentStatus,
  getAssignmentStatusIconClass,
  getAssignmentStatusLabel,
  hasDraftSavedGrade,
} from '@/lib/assignments'
import { useAssignmentGradingLayout } from '@/hooks/use-assignment-grading-layout'
import {
  getAssignmentWorkspaceStudentCookieName,
  parseAssignmentWorkspaceStudentId,
  type AssignmentWorkspaceMode,
} from '@/lib/assignment-grading-layout'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import { isVisibleAtNow } from '@/lib/scheduling'
import type {
  Classroom,
  Assignment,
  AssignmentAiGradingRunSummary,
  AssignmentStats,
  AssignmentStatus,
  ClassDay,
  TiptapContent,
} from '@/types'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import {
  TEACHER_ASSIGNMENTS_SELECTION_EVENT,
  TEACHER_ASSIGNMENTS_UPDATED_EVENT,
  TEACHER_GRADE_UPDATED_EVENT,
  type TeacherGradeUpdatedEventDetail,
} from '@/lib/events'
import { applyDirection, compareByNameFields, toggleSort as toggleSortState } from '@/lib/table-sort'
import type { SortDirection } from '@/lib/table-sort'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'
import { readCookie, writeCookie } from '@/lib/cookies'
import { useWindowSize } from '@/hooks/use-window-size'

interface AssignmentWithStats extends Assignment {
  stats: AssignmentStats
}

type TeacherAssignmentSelection = { mode: 'summary' } | { mode: 'assignment'; assignmentId: string }

interface StudentSubmissionRow {
  student_id: string
  student_email: string
  student_first_name: string | null
  student_last_name: string | null
  status: AssignmentStatus
  student_updated_at?: string | null
  artifacts: AssignmentArtifact[]
  doc: {
    submitted_at?: string | null
    updated_at?: string | null
    score_completion?: number | null
    score_thinking?: number | null
    score_workflow?: number | null
    graded_at?: string | null
    returned_at?: string | null
    feedback_returned_at?: string | null
  } | null
}

export type AssignmentViewMode = 'summary' | 'assignment'

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
  onViewModeChange?: (mode: AssignmentViewMode) => void
  isActive?: boolean
}

function isScheduledAssignment(assignment: Assignment): boolean {
  return !assignment.is_draft && !!assignment.released_at && !isVisibleAtNow(assignment.released_at)
}

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer border-l-2 border-l-primary bg-surface-selected shadow-sm'
  }
  return 'cursor-pointer hover:bg-surface-hover'
}

const STATUS_ICON_CLASS = 'h-4 w-4'
const LATE_CLOCK_CLASS = 'h-3 w-3'

function MetricBar({ value }: { value: number }) {
  const percentage = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div className="h-2 w-full rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

function StatusIcon({
  status,
  wasLate,
  hasDraftGrade = false,
}: {
  status: AssignmentStatus
  wasLate?: boolean
  hasDraftGrade?: boolean
}) {
  const colorClass = getAssignmentStatusIconClass(status)
  let iconColorClass = colorClass
  let icon: React.ReactElement

  // Determine if this status should show the late clock indicator.
  // "late" statuses always show it; downstream statuses show it when wasLate is true.
  const showLate =
    status === 'in_progress_late' ||
    status === 'submitted_late' ||
    ((status === 'graded' || status === 'returned' || status === 'resubmitted') && wasLate)

  // Pick the base icon for each status.
  // Submitted is a circle unless draft grading has been saved.
  switch (status) {
    case 'not_started':
    case 'in_progress':
    case 'in_progress_late':
      icon = <Circle className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
      break
    case 'submitted_on_time':
    case 'submitted_late':
      if (hasDraftGrade) {
        iconColorClass = 'text-gray-400'
        icon = <Check className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
      } else {
        icon = <Circle className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
      }
      break
    case 'graded':
      iconColorClass = 'text-green-500'
      icon = <Check className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
      break
    case 'returned':
      icon = <Send className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
      break
    case 'resubmitted':
      icon = <RotateCcw className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
      break
    default:
      icon = <Circle className={`${STATUS_ICON_CLASS} ${iconColorClass}`} />
  }

  if (showLate) {
    return <span className={`inline-flex items-center gap-0.5 ${iconColorClass}`}>{icon}<Clock className={LATE_CLOCK_CLASS} /></span>
  }
  return icon
}

function getTeacherAssignmentStatusTooltipLabel(status: AssignmentStatus, wasLate: boolean): string {
  const baseLabel = getAssignmentStatusLabel(status)
  if (!wasLate) return baseLabel

  if (status === 'graded' || status === 'returned' || status === 'resubmitted') {
    return `${baseLabel} (late)`
  }

  return baseLabel
}

function getStudentDisplayName(row: StudentSubmissionRow | null): string | null {
  if (!row) return null
  const fullName = [row.student_first_name, row.student_last_name].filter(Boolean).join(' ').trim()
  return fullName || row.student_email || null
}

function isAssignmentAiGradingRunActive(run: AssignmentAiGradingRunSummary | null): boolean {
  return !!run && (run.status === 'queued' || run.status === 'running')
}

function getAssignmentAiRunPollDelayMs(run: AssignmentAiGradingRunSummary | null): number {
  if (!run || !isAssignmentAiGradingRunActive(run) || !run.next_retry_at) {
    return 2000
  }

  const retryAt = new Date(run.next_retry_at).getTime()
  if (!Number.isFinite(retryAt)) {
    return 2000
  }

  const delay = retryAt - Date.now() + 250
  return Math.min(Math.max(delay, 1000), 10_000)
}

function summarizeAssignmentAiGradingErrors(run: AssignmentAiGradingRunSummary): string {
  const counts = new Map<string, number>()

  for (const sample of run.error_samples) {
    const message = sample.message.trim()
    if (!message) continue
    counts.set(message, (counts.get(message) || 0) + 1)
  }

  if (counts.size === 0) return ''

  return Array.from(counts.entries())
    .slice(0, 3)
    .map(([message, count]) => (count > 1 ? `${count} students: ${message}` : message))
    .join(' · ')
}

function formatAssignmentAiGradingRunMessage(run: AssignmentAiGradingRunSummary): {
  info: string
  error: string
} {
  const summaryParts: string[] = []

  if (run.completed_count > 0) {
    summaryParts.push(`Graded ${run.completed_count}`)
  }
  if (run.skipped_empty_count > 0) {
    summaryParts.push(`${run.skipped_empty_count} empty`)
  }
  if (run.skipped_missing_count > 0) {
    summaryParts.push(`${run.skipped_missing_count} missing`)
  }
  if (run.failed_count > 0) {
    summaryParts.push(`${run.failed_count} failed`)
  }

  const summary = summaryParts.length > 0
    ? summaryParts.join(' • ')
    : 'No grading changes were needed'
  const errorSummary = summarizeAssignmentAiGradingErrors(run)

  if (run.status === 'completed_with_errors' || run.status === 'failed') {
    return {
      info: '',
      error: errorSummary ? `${summary}\n${errorSummary}` : summary,
    }
  }

  return {
    info: summary,
    error: '',
  }
}

const ASSIGNMENT_AI_GRADING_RUN_NOTE =
  'Keep this assignment open while grading runs. Reopening it resumes the current progress.'

export function TeacherClassroomView({
  classroom,
  onSelectAssignment,
  onViewModeChange,
  isActive = true,
}: Props) {
  const isReadOnly = !!classroom.archived_at
  const { width: viewportWidth } = useWindowSize()
  const isDesktop = viewportWidth >= DESKTOP_BREAKPOINT

  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selection, setSelection] = useState<TeacherAssignmentSelection>({ mode: 'summary' })
  const [isReordering, setIsReordering] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const [selectedAssignmentData, setSelectedAssignmentData] = useState<{
    assignment: Assignment
    students: StudentSubmissionRow[]
  } | null>(null)
  const [assignmentAiGradingRun, setAssignmentAiGradingRun] = useState<AssignmentAiGradingRunSummary | null>(null)
  const [selectedAssignmentLoading, setSelectedAssignmentLoading] = useState(false)
  const [selectedAssignmentError, setSelectedAssignmentError] = useState<string>('')

  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: 'first' | 'last' | 'status'
    direction: SortDirection
  }>({ column: 'last', direction: 'asc' })

  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [individualHeaderMeta, setIndividualHeaderMeta] = useState<{
    studentName: string
    characterCount: number
  } | null>(null)
  const [assignmentWorkspaceMode, setAssignmentWorkspaceMode] =
    useState<AssignmentWorkspaceMode>('overview')
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const workspaceContainerRef = useRef<HTMLDivElement | null>(null)
  const defaultedWorkspaceKeyRef = useRef<string | null>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(0)

  // Batch grading state
  const [isAutoGrading, setIsAutoGrading] = useState(false)
  const [isArtifactRepoAnalyzing, setIsArtifactRepoAnalyzing] = useState(false)
  const [isReturning, setIsReturning] = useState(false)
  const [batchProgressCount, setBatchProgressCount] = useState(0)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const wasActiveRef = useRef(isActive)
  const handledCompletedRunKeysRef = useRef<Set<string>>(new Set())
  const showSummarySpinner = useDelayedBusy(loading && assignments.length === 0)
  const {
    layout: assignmentGradingLayout,
    updateModeLayout,
  } = useAssignmentGradingLayout(classroom.id, workspaceWidth)

  const loadAssignments = useCallback(async (options?: { preserveContent?: boolean }) => {
    const preserveContent = options?.preserveContent ?? false
    if (!preserveContent) {
      setLoading(true)
    }
    try {
      const [assignmentsData, classDaysRes] = await Promise.all([
        fetchJSONWithCache(
          `teacher-assignments:${classroom.id}`,
          async () => {
            const response = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`)
            if (!response.ok) throw new Error('Failed to load assignments')
            return response.json()
          },
          20_000,
        ),
        fetch(`/api/classrooms/${classroom.id}/class-days`),
      ])
      const classDaysData = await classDaysRes.json().catch(() => ({ class_days: [] }))
      setAssignments(assignmentsData.assignments || [])
      setClassDays(classDaysData.class_days || [])
      setHasLoadedOnce(true)
      window.dispatchEvent(
        new CustomEvent(TEACHER_ASSIGNMENTS_UPDATED_EVENT, {
          detail: { classroomId: classroom.id },
        })
      )
    } catch (err) {
      console.error('Error loading assignments:', err)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])

  useEffect(() => {
    if (isActive && !wasActiveRef.current && hasLoadedOnce) {
      loadAssignments({ preserveContent: true })
    }
    wasActiveRef.current = isActive
  }, [hasLoadedOnce, isActive, loadAssignments])

  useEffect(() => {
    const node = workspaceContainerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0
      setWorkspaceWidth((current) => (Math.abs(current - nextWidth) < 1 ? current : nextWidth))
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [selection.mode, assignmentWorkspaceMode, selectedStudentId])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || isReordering || isReadOnly) return

      const oldIndex = assignments.findIndex((a) => a.id === active.id)
      const newIndex = assignments.findIndex((a) => a.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      // Optimistically update local state
      const reordered = arrayMove(assignments, oldIndex, newIndex)
      setAssignments(reordered)

      // Persist to server
      setIsReordering(true)
      try {
        const orderedIds = reordered.map((a) => a.id)
        await fetch('/api/teacher/assignments/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classroom_id: classroom.id, assignment_ids: orderedIds }),
        })
        invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
        // Notify sidebar to refresh
        window.dispatchEvent(
          new CustomEvent(TEACHER_ASSIGNMENTS_UPDATED_EVENT, {
            detail: { classroomId: classroom.id },
          })
        )
      } catch (err) {
        console.error('Failed to reorder assignments:', err)
        setError('Failed to save assignment order. Please try again.')
        // Reload to restore server state on error
        loadAssignments()
      } finally {
        setIsReordering(false)
      }
    },
    [assignments, classroom.id, isReordering, isReadOnly, loadAssignments]
  )

  useEffect(() => {
    if (loading) return
    const cookieName = `teacherAssignmentsSelection:${classroom.id}`
    const value = readCookie(cookieName)
    if (!value || value === 'summary') {
      setSelection({ mode: 'summary' })
      return
    }
    const assignment = assignments.find((a) => a.id === value)
    if (!assignment) {
      setSelection({ mode: 'summary' })
      return
    }
    // Draft/scheduled assignments open the editor for release controls.
    if (assignment.is_draft || isScheduledAssignment(assignment)) {
      setEditAssignment(assignment)
      setSelection({ mode: 'summary' })
    } else {
      setSelection({ mode: 'assignment', assignmentId: value })
    }
  }, [assignments, classroom.id, loading])

  useEffect(() => {
    function onSelectionEvent(e: Event) {
      const event = e as CustomEvent<{ classroomId?: string; value?: string }>
      if (!event.detail) return
      if (event.detail.classroomId !== classroom.id) return

      const value = event.detail.value
      if (!value || value === 'summary') {
        setSelection({ mode: 'summary' })
        return
      }
      const assignment = assignments.find((a) => a.id === value)
      if (!assignment) {
        setSelection({ mode: 'summary' })
        return
      }
      // Draft/scheduled assignments open the editor for release controls.
      if (assignment.is_draft || isScheduledAssignment(assignment)) {
        setEditAssignment(assignment)
        setSelection({ mode: 'summary' })
      } else {
        setSelection({ mode: 'assignment', assignmentId: value })
      }
    }

    window.addEventListener(TEACHER_ASSIGNMENTS_SELECTION_EVENT, onSelectionEvent)
    return () => window.removeEventListener(TEACHER_ASSIGNMENTS_SELECTION_EVENT, onSelectionEvent)
  }, [assignments, classroom.id])

  useEffect(() => {
    if (selection.mode !== 'assignment') {
      setSelectedAssignmentData(null)
      setAssignmentAiGradingRun(null)
      setSelectedAssignmentError('')
      setSelectedAssignmentLoading(false)
      return
    }

    const assignmentId = selection.assignmentId

    async function loadSelectedAssignment() {
      setSelectedAssignmentLoading(true)
      setSelectedAssignmentError('')
      try {
        const response = await fetch(`/api/teacher/assignments/${assignmentId}`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load assignment')
        }

        setSelectedAssignmentData({
          assignment: data.assignment,
          students: (data.students || []) as StudentSubmissionRow[],
        })
        setAssignmentAiGradingRun((data.active_ai_grading_run as AssignmentAiGradingRunSummary | null) ?? null)
      } catch (err: any) {
        setSelectedAssignmentError(err.message || 'Failed to load assignment')
        setSelectedAssignmentData(null)
        setAssignmentAiGradingRun(null)
      } finally {
        setSelectedAssignmentLoading(false)
      }
    }

    loadSelectedAssignment()
  }, [assignments, refreshCounter, selection])

  useEffect(() => {
    if (selection.mode !== 'assignment') {
      setAssignmentWorkspaceMode('overview')
      setSelectedStudentId(null)
      setWorkspaceLoading(false)
      return
    }
  }, [selection])

  const activeSelectedAssignmentData = useMemo(() => {
    if (selection.mode !== 'assignment' || !selectedAssignmentData) return null
    return selectedAssignmentData.assignment.id === selection.assignmentId
      ? selectedAssignmentData
      : null
  }, [selectedAssignmentData, selection])

  const activeAssignmentAiRun = useMemo(() => {
    if (selection.mode !== 'assignment' || !assignmentAiGradingRun) return null
    return assignmentAiGradingRun.assignment_id === selection.assignmentId
      ? assignmentAiGradingRun
      : null
  }, [assignmentAiGradingRun, selection])
  const activeAssignmentAiRunId = activeAssignmentAiRun?.id ?? null
  const hasActiveAssignmentAiRun = isAssignmentAiGradingRunActive(activeAssignmentAiRun)

  // Notify parent about selected assignment for sidebar
  useEffect(() => {
    if (selection.mode === 'summary') {
      onSelectAssignment?.(null)
    } else if (activeSelectedAssignmentData) {
      const { assignment } = activeSelectedAssignmentData
      onSelectAssignment?.({
        title: assignment.title,
        instructions: assignment.instructions_markdown || assignment.rich_instructions || assignment.description,
      })
    } else {
      onSelectAssignment?.(null)
    }
  }, [activeSelectedAssignmentData, onSelectAssignment, selection.mode])

  // Notify parent of view mode changes
  useEffect(() => {
    onViewModeChange?.(selection.mode)
  }, [selection.mode, onViewModeChange])

  function handleCreateSuccess(created: Assignment) {
    // Optimistically add the new assignment to the list
    setAssignments((prev) => [...prev, { ...created, stats: { total_students: 0, submitted: 0, late: 0 } }])
    // Reload to get accurate stats from server
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    loadAssignments()
  }

  function handleEditSuccess(updated: Assignment) {
    // Optimistically update the assignment in the list
    setAssignments((prev) =>
      prev.map((assignment) =>
        assignment.id === updated.id ? { ...assignment, ...updated } : assignment
      )
    )
    // Update selected assignment if it's the one being edited
    setSelectedAssignmentData((prev) => {
      if (!prev || prev.assignment.id !== updated.id) return prev
      return { ...prev, assignment: updated }
    })
    // Reload to ensure consistency
    invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
    loadAssignments()
  }

  function setSelectionAndPersist(next: TeacherAssignmentSelection) {
    const cookieName = `teacherAssignmentsSelection:${classroom.id}`
    const cookieValue = next.mode === 'summary' ? 'summary' : next.assignmentId
    writeCookie(cookieName, cookieValue)
    setSelection(next)
  }

  const sortedStudents = useMemo(() => {
    if (!selectedAssignmentData) return []
    const rows = [...selectedAssignmentData.students]
    if (sortColumn === 'status') {
      const submittedStatuses = new Set<AssignmentStatus>([
        'submitted_on_time', 'submitted_late', 'graded', 'returned', 'resubmitted',
      ])
      rows.sort((a, b) => {
        const rankA = submittedStatuses.has(a.status) ? 0 : 1
        const rankB = submittedStatuses.has(b.status) ? 0 : 1
        const cmp = rankA - rankB
        if (cmp !== 0) return applyDirection(cmp, sortDirection)
        return compareByNameFields(
          { firstName: a.student_first_name, lastName: a.student_last_name, id: a.student_email },
          { firstName: b.student_first_name, lastName: b.student_last_name, id: b.student_email },
          'last_name',
          sortDirection
        )
      })
    } else {
      const nameColumn = sortColumn === 'first' ? 'first_name' as const : 'last_name' as const
      rows.sort((a, b) =>
        compareByNameFields(
          { firstName: a.student_first_name, lastName: a.student_last_name, id: a.student_email },
          { firstName: b.student_first_name, lastName: b.student_last_name, id: b.student_email },
          nameColumn,
          sortDirection
        )
      )
    }
    return rows
  }, [selectedAssignmentData, sortColumn, sortDirection])

  const currentStudentRows = useMemo(
    () => (activeSelectedAssignmentData ? sortedStudents : []),
    [activeSelectedAssignmentData, sortedStudents],
  )

  const studentRowIds = useMemo(() => currentStudentRows.map((s) => s.student_id), [currentStudentRows])
  const dueAtMs = useMemo(
    () => (activeSelectedAssignmentData ? new Date(activeSelectedAssignmentData.assignment.due_at).getTime() : 0),
    [activeSelectedAssignmentData],
  )
  const selectedAssignmentKey =
    selection.mode === 'assignment' ? selection.assignmentId : null
  const {
    selectedIds: batchSelectedIds,
    toggleSelect: batchToggleSelect,
    toggleSelectAll: batchToggleSelectAll,
    allSelected: batchAllSelected,
    clearSelection: batchClearSelection,
    selectedCount: batchSelectedCount,
  } = useStudentSelection(studentRowIds)

  useEffect(() => {
    if (selection.mode !== 'assignment') return
    setAssignmentWorkspaceMode('overview')
    setSelectedStudentId(null)
    setWorkspaceLoading(false)
    batchClearSelection()
  }, [batchClearSelection, selectedAssignmentKey, selection.mode])

  const batchSelectedGradedCount = useMemo(() => {
    if (currentStudentRows.length === 0) return 0
    let graded = 0
    for (const student of currentStudentRows) {
      const doc = student.doc
      const hasDraftScores = !!(
        doc &&
        doc.score_completion != null &&
        doc.score_thinking != null &&
        doc.score_workflow != null
      )
      if (batchSelectedIds.has(student.student_id) && (doc?.graded_at || hasDraftScores)) {
        graded += 1
      }
    }
    return graded
  }, [batchSelectedIds, currentStudentRows])
  const batchSelectedUngradedCount = batchSelectedCount - batchSelectedGradedCount

  useEffect(() => {
    if (!info) return
    const timer = setTimeout(() => setInfo(''), 4000)
    return () => clearTimeout(timer)
  }, [info])

  useEffect(() => {
    if (!selectedAssignmentKey || !activeAssignmentAiRunId || !hasActiveAssignmentAiRun) return

    let isCancelled = false
    let timeoutId: number | undefined

    const syncRun = async () => {
      const assignmentId = selectedAssignmentKey
      const runId = activeAssignmentAiRunId
      let shouldContinue = true
      let nextDelayMs = 2000

      try {
        const statusResponse = await fetch(
          `/api/teacher/assignments/${assignmentId}/auto-grade-runs/${runId}`,
        )
        const statusData = await statusResponse.json().catch(() => ({}))
        if (!isCancelled && statusResponse.ok && statusData.run) {
          const nextRun = statusData.run as AssignmentAiGradingRunSummary
          setAssignmentAiGradingRun(nextRun)
          if (!isAssignmentAiGradingRunActive(nextRun)) {
            shouldContinue = false
            return
          }

          const statusDelayMs = getAssignmentAiRunPollDelayMs(nextRun)
          nextDelayMs = statusDelayMs
          if (statusDelayMs > 2500) {
            return
          }
        }

        const tickResponse = await fetch(
          `/api/teacher/assignments/${assignmentId}/auto-grade-runs/${runId}/tick`,
          {
            method: 'POST',
          },
        )
        const tickData = await tickResponse.json().catch(() => ({}))
        if (!isCancelled && tickResponse.ok && tickData.run) {
          const nextRun = tickData.run as AssignmentAiGradingRunSummary
          setAssignmentAiGradingRun(nextRun)
          if (!isAssignmentAiGradingRunActive(nextRun)) {
            shouldContinue = false
          } else {
            nextDelayMs = getAssignmentAiRunPollDelayMs(nextRun)
          }
        }
      } catch {
        // Keep the run state visible; the next poll cycle can recover.
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
  }, [activeAssignmentAiRunId, hasActiveAssignmentAiRun, selectedAssignmentKey])

  useEffect(() => {
    if (!activeAssignmentAiRun || hasActiveAssignmentAiRun) return

    const handledKey = `${activeAssignmentAiRun.id}:${activeAssignmentAiRun.status}:${activeAssignmentAiRun.processed_count}:${activeAssignmentAiRun.failed_count}`
    if (handledCompletedRunKeysRef.current.has(handledKey)) return
    handledCompletedRunKeysRef.current.add(handledKey)

    const message = formatAssignmentAiGradingRunMessage(activeAssignmentAiRun)
    batchClearSelection()
    setRefreshCounter((count) => count + 1)

    if (message.error) {
      setError(message.error)
      setInfo('')
    } else {
      setInfo(message.info)
      setError('')
    }
  }, [activeAssignmentAiRun, batchClearSelection, hasActiveAssignmentAiRun])

  async function handleBatchAutoGrade() {
    if (!selectedAssignmentData || batchSelectedCount === 0) return
    setBatchProgressCount(batchSelectedCount)
    setIsAutoGrading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedAssignmentData.assignment.id}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (res.status === 202 && data.run) {
        setAssignmentAiGradingRun(data.run as AssignmentAiGradingRunSummary)
        batchClearSelection()
        return
      }
      if (res.status === 409 && data.run) {
        setAssignmentAiGradingRun(data.run as AssignmentAiGradingRunSummary)
        throw new Error(data.error || 'Another grading run is already active')
      }
      if (!res.ok) throw new Error(data.error || 'Auto-grade failed')
      const total = (data.graded_count ?? 0) + (data.skipped_count ?? 0)
      if (data.graded_count === 0) {
        setError('No gradable content found — submissions may be empty')
      } else if (data.skipped_count > 0) {
        setInfo(`Graded ${data.graded_count} of ${total} • ${data.skipped_count} skipped`)
        setError('')
      }
      batchClearSelection()
      // Reload assignment data to refresh statuses/grades
      setRefreshCounter((c) => c + 1)
    } catch (err: any) {
      setError(err.message || 'Auto-grade failed')
    } finally {
      setIsAutoGrading(false)
    }
  }

  async function handleBatchArtifactRepoAnalyze() {
    if (!selectedAssignmentData || batchSelectedCount === 0) return
    setBatchProgressCount(batchSelectedCount)
    setIsArtifactRepoAnalyzing(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedAssignmentData.assignment.id}/artifact-repo/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Repo analysis failed')

      const skipSummary = Object.entries((data.skipped_reasons || {}) as Record<string, number>)
        .map(([reason, count]) => `${count} ${reason}`)
        .join(' • ')
      setInfo(
        `Analyzed ${data.analyzed_students ?? 0} student(s) across ${data.repo_groups ?? 0} repo group(s)${
          skipSummary ? ` • ${skipSummary}` : ''
        }`
      )
      batchClearSelection()
      setRefreshCounter((c) => c + 1)
    } catch (err: any) {
      setError(err.message || 'Repo analysis failed')
    } finally {
      setIsArtifactRepoAnalyzing(false)
    }
  }

  async function handleBatchReturn() {
    if (!selectedAssignmentData || batchSelectedCount === 0) return
    setBatchProgressCount(batchSelectedCount)
    setIsReturning(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedAssignmentData.assignment.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Return failed')
      const returnedCount = Number(data.returned_count ?? 0)
      const clearedCount = Number(data.cleared_count ?? returnedCount)
      const missingCount = Number(data.missing_count ?? 0)
      setInfo(
        `Cleared ${clearedCount} mailbox item(s)${returnedCount > 0 ? ` • ${returnedCount} returned with grades` : ''}${missingCount > 0 ? ` • ${missingCount} no work yet` : ''}`
      )
      batchClearSelection()
      setShowReturnConfirm(false)
      // Reload assignment data to refresh statuses/grades
      setRefreshCounter((c) => c + 1)
    } catch (err: any) {
      setError(err.message || 'Return failed')
    } finally {
      setIsReturning(false)
    }
  }

  const selectedStudentIndex = useMemo(() => {
    if (!selectedStudentId) return -1
    return currentStudentRows.findIndex((student) => student.student_id === selectedStudentId)
  }, [currentStudentRows, selectedStudentId])

  const canGoPrevStudent = selectedStudentIndex > 0
  const canGoNextStudent = selectedStudentIndex !== -1 && selectedStudentIndex < currentStudentRows.length - 1
  const selectedStudentRow = useMemo(() => {
    if (!selectedStudentId) return null
    return currentStudentRows.find((student) => student.student_id === selectedStudentId) ?? null
  }, [currentStudentRows, selectedStudentId])
  const activeSelectedStudentId = selectedStudentRow?.student_id ?? null

  const handleGoPrevStudent = useCallback(() => {
    if (selectedStudentIndex <= 0) return
    setSelectedStudentId(currentStudentRows[selectedStudentIndex - 1].student_id)
  }, [currentStudentRows, selectedStudentIndex])

  const handleGoNextStudent = useCallback(() => {
    if (selectedStudentIndex === -1 || selectedStudentIndex >= currentStudentRows.length - 1) return
    setSelectedStudentId(currentStudentRows[selectedStudentIndex + 1].student_id)
  }, [currentStudentRows, selectedStudentIndex])

  useEffect(() => {
    if (selection.mode !== 'assignment' || !activeSelectedStudentId) return
    writeCookie(
      getAssignmentWorkspaceStudentCookieName(classroom.id, selection.assignmentId),
      activeSelectedStudentId,
    )
  }, [activeSelectedStudentId, classroom.id, selection])

  useEffect(() => {
    if (!selectedStudentId) return
    if (currentStudentRows.some((student) => student.student_id === selectedStudentId)) return
    setSelectedStudentId(null)
  }, [currentStudentRows, selectedStudentId])

  useEffect(() => {
    if (selection.mode === 'assignment') return
    defaultedWorkspaceKeyRef.current = null
  }, [selection.mode])

  const resolveDetailsStudentId = useCallback(() => {
    if (selection.mode !== 'assignment') return null

    if (selectedStudentId && currentStudentRows.some((student) => student.student_id === selectedStudentId)) {
      return selectedStudentId
    }

    const remembered = parseAssignmentWorkspaceStudentId(
      readCookie(
        getAssignmentWorkspaceStudentCookieName(classroom.id, selection.assignmentId),
      ),
    )

    if (remembered && currentStudentRows.some((student) => student.student_id === remembered)) {
      return remembered
    }

    return currentStudentRows[0]?.student_id ?? null
  }, [classroom.id, currentStudentRows, selectedStudentId, selection])

  const handleSwitchWorkspaceMode = useCallback((nextMode: AssignmentWorkspaceMode) => {
    if (nextMode === assignmentWorkspaceMode) return

    if (nextMode === 'details') {
      const nextStudentId = resolveDetailsStudentId()
      if (!nextStudentId) return
      setIndividualHeaderMeta(null)
      setSelectedStudentId(nextStudentId)
    } else {
      setIndividualHeaderMeta(null)
    }

    updateModeLayout(nextMode, assignmentGradingLayout[assignmentWorkspaceMode])
    setAssignmentWorkspaceMode(nextMode)
  }, [
    assignmentGradingLayout,
    assignmentWorkspaceMode,
    resolveDetailsStudentId,
    updateModeLayout,
  ])

  useEffect(() => {
    if (selection.mode !== 'assignment') return
    if (!activeSelectedAssignmentData || selectedAssignmentLoading) return
    const workspaceKey = `${selection.assignmentId}:${assignmentWorkspaceMode}`
    if (defaultedWorkspaceKeyRef.current === workspaceKey) return

    if (activeSelectedStudentId) {
      defaultedWorkspaceKeyRef.current = workspaceKey
      return
    }

    const nextStudentId = resolveDetailsStudentId()
    if (nextStudentId) {
      defaultedWorkspaceKeyRef.current = workspaceKey
      setSelectedStudentId(nextStudentId)
    }
  }, [
    activeSelectedAssignmentData,
    activeSelectedStudentId,
    assignmentWorkspaceMode,
    resolveDetailsStudentId,
    selectedAssignmentLoading,
    selection,
  ])

  // Escape key to deselect student
  useEffect(() => {
    if (assignmentWorkspaceMode !== 'overview') return
    if (!selectedStudentId) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectedStudentId(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [assignmentWorkspaceMode, selectedStudentId])

  useEffect(() => {
    if (selection.mode !== 'assignment') {
      setIndividualHeaderMeta(null)
    }
  }, [selection.mode])

  useEffect(() => {
    setIndividualHeaderMeta(null)
  }, [selectedAssignmentKey])

  // Apply sidebar grade saves to the current row without forcing a table reload.
  useEffect(() => {
    function onGradeUpdated(event: Event) {
      const customEvent = event as CustomEvent<TeacherGradeUpdatedEventDetail>
      const detail = customEvent.detail
      if (!detail?.assignmentId || !detail?.studentId || !detail?.doc) return
      const updatedDoc = detail.doc

      setSelectedAssignmentData((prev) => {
        if (!prev || prev.assignment.id !== detail.assignmentId) return prev

        let didUpdate = false
        const nextStudents = prev.students.map((student) => {
          if (student.student_id !== detail.studentId) return student
          didUpdate = true
          return {
            ...student,
            doc: {
              ...student.doc,
              ...updatedDoc,
            },
            status: calculateAssignmentStatus(prev.assignment, updatedDoc),
            student_updated_at: updatedDoc.updated_at ?? student.student_updated_at,
          }
        })

        return didUpdate ? { ...prev, students: nextStudents } : prev
      })
    }

    window.addEventListener(TEACHER_GRADE_UPDATED_EVENT, onGradeUpdated)
    return () => window.removeEventListener(TEACHER_GRADE_UPDATED_EVENT, onGradeUpdated)
  }, [])

  function toggleSort(column: 'first' | 'last' | 'status') {
    setSortState((prev) => toggleSortState(prev, column))
  }

  async function deleteAssignment() {
    if (!pendingDelete) return
    setError('')
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/teacher/assignments/${pendingDelete.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete assignment')
      }
      setPendingDelete(null)
      invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
      await loadAssignments()
      if (selection.mode === 'assignment' && selection.assignmentId === pendingDelete.id) {
        setSelectionAndPersist({ mode: 'summary' })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete assignment')
    } finally {
      setIsDeleting(false)
    }
  }

  const canEditAssignment =
    selection.mode === 'assignment' && !!activeSelectedAssignmentData && !selectedAssignmentLoading && !isReadOnly
  const selectedAssignmentSummary = selection.mode === 'assignment'
    ? assignments.find((item) => item.id === selection.assignmentId) ?? null
    : null
  const selectedAssignmentTitle =
    activeSelectedAssignmentData?.assignment.title ??
    selectedAssignmentSummary?.title ??
    'Assignment'
  const selectedStudentDisplayName =
    individualHeaderMeta?.studentName ?? getStudentDisplayName(selectedStudentRow)
  const individualCharacterCountLabel =
    selectedStudentDisplayName
      ? individualHeaderMeta
        ? `${individualHeaderMeta.characterCount} chars`
        : 'Loading…'
      : null
  const activeWorkspaceLayout = assignmentGradingLayout[assignmentWorkspaceMode]
  const showOverviewInspector =
    assignmentWorkspaceMode === 'overview' &&
    !!activeSelectedStudentId
  const canOpenDetails =
    selection.mode === 'assignment' &&
    !selectedAssignmentLoading &&
    currentStudentRows.length > 0
  const workspaceActionLabelSuffix = batchSelectedCount > 0 ? ` (${batchSelectedCount})` : ''
  const showAssignmentAiRunOverlay = isAutoGrading || hasActiveAssignmentAiRun
  const assignmentAiRunOverlayLabel = hasActiveAssignmentAiRun && activeAssignmentAiRun
    ? `Grading ${Math.min(activeAssignmentAiRun.processed_count, activeAssignmentAiRun.requested_count)} of ${activeAssignmentAiRun.requested_count} students…`
    : `Starting grading for ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`

  function handleOverviewInspectorResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!workspaceContainerRef.current) return

    event.preventDefault()
    const { right, width } = workspaceContainerRef.current.getBoundingClientRect()
    if (width <= 0) return

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextInspectorWidth = ((right - moveEvent.clientX) / width) * 100
      updateModeLayout('overview', (current) => ({
        ...current,
        inspectorCollapsed: false,
        inspectorWidth: nextInspectorWidth,
      }))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  function handleOverviewInspectorResizeReset() {
    updateModeLayout('overview', (current) => ({
      ...current,
      inspectorCollapsed: false,
      inspectorWidth: 50,
    }))
  }

  const studentTable = (
    <div className="flex h-full min-h-0 flex-col">
      <KeyboardNavigableTable
        ref={tableContainerRef}
        rowKeys={currentStudentRows.map((student) => student.student_id)}
        selectedKey={activeSelectedStudentId}
        onSelectKey={setSelectedStudentId}
        onDeselect={() => setSelectedStudentId(null)}
      >
        <TableCard chrome="flush">
          {selectedAssignmentLoading || (selection.mode === 'assignment' && !activeSelectedAssignmentData && !selectedAssignmentError) ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : selectedAssignmentError ? (
            <div className="p-4 text-sm text-danger">
              {selectedAssignmentError}
            </div>
          ) : (
            <div className="relative">
              {(showAssignmentAiRunOverlay || isArtifactRepoAnalyzing || isReturning) && (
                <div className="absolute inset-0 z-10 flex items-start justify-center rounded-md bg-surface/70 px-4 pt-4">
                  <div className="flex max-w-[24rem] flex-col gap-1 rounded-2xl border border-border bg-surface px-3 py-2 text-xs leading-tight text-text-muted shadow-sm sm:max-w-[28rem] sm:text-sm">
                    <div className="flex items-center gap-2">
                      <Spinner />
                      <span>
                        {showAssignmentAiRunOverlay
                          ? assignmentAiRunOverlayLabel
                          : isArtifactRepoAnalyzing
                            ? `Analyzing repos for ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
                            : `Returning to ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`}
                      </span>
                    </div>
                    {showAssignmentAiRunOverlay ? (
                      <p className="pl-6 text-[11px] leading-tight text-text-muted sm:text-xs">
                        {ASSIGNMENT_AI_GRADING_RUN_NOTE}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
              <DataTable density={showOverviewInspector ? 'tight' : 'compact'}>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell className="w-10">
                      <input
                        type="checkbox"
                        checked={batchAllSelected}
                        onChange={batchToggleSelectAll}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        aria-label="Select all students"
                      />
                    </DataTableHeaderCell>
                    <SortableHeaderCell
                      label="First Name"
                      isActive={sortColumn === 'first'}
                      direction={sortDirection}
                      onClick={() => toggleSort('first')}
                      className="w-[7rem]"
                    />
                    <SortableHeaderCell
                      label="Last Name"
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onClick={() => toggleSort('last')}
                      className="w-[7rem]"
                    />
                    <SortableHeaderCell
                      label="Status"
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onClick={() => toggleSort('status')}
                      className="w-[4.5rem]"
                    />
                    <DataTableHeaderCell className="w-[4.75rem]">Grade</DataTableHeaderCell>
                    <DataTableHeaderCell className="w-[11rem]">Artifacts</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {currentStudentRows.map((student) => {
                    const isSelected = activeSelectedStudentId === student.student_id
                    const totalScore =
                      student.doc?.score_completion != null &&
                      student.doc?.score_thinking != null &&
                      student.doc?.score_workflow != null
                        ? student.doc.score_completion + student.doc.score_thinking + student.doc.score_workflow
                        : null
                    const hasDraftGrade = hasDraftSavedGrade(student.doc ? {
                      graded_at: student.doc.graded_at ?? null,
                      score_completion: student.doc.score_completion ?? null,
                      score_thinking: student.doc.score_thinking ?? null,
                      score_workflow: student.doc.score_workflow ?? null,
                    } : null)
                    const wasLate = !!(
                      student.doc?.submitted_at &&
                      dueAtMs &&
                      new Date(student.doc.submitted_at).getTime() > dueAtMs
                    )

                    return (
                      <DataTableRow
                        key={student.student_id}
                        className={getRowClassName(isSelected)}
                        onClick={() => {
                          if (assignmentWorkspaceMode === 'details') {
                            setIndividualHeaderMeta(null)
                          }
                          setSelectedStudentId(student.student_id)
                        }}
                      >
                        <DataTableCell>
                          <input
                            type="checkbox"
                            checked={batchSelectedIds.has(student.student_id)}
                            onChange={() => batchToggleSelect(student.student_id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                            aria-label={`Select ${student.student_first_name ?? ''} ${student.student_last_name ?? ''}`}
                          />
                        </DataTableCell>
                        <DataTableCell className="w-[7rem] max-w-[7rem] truncate">
                          {student.student_first_name ? (
                            <Tooltip content={`${student.student_first_name} ${student.student_last_name ?? ''}`}>
                              <span>{student.student_first_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell className="w-[7rem] max-w-[7rem] truncate">
                          {student.student_last_name ? (
                            <Tooltip content={student.student_last_name}>
                              <span>{student.student_last_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell className="w-[4.5rem]">
                          <Tooltip content={getTeacherAssignmentStatusTooltipLabel(student.status, wasLate)}>
                            <span className="inline-flex" role="img" aria-label={getTeacherAssignmentStatusTooltipLabel(student.status, wasLate)}>
                              <StatusIcon
                                status={student.status}
                                wasLate={wasLate}
                                hasDraftGrade={hasDraftGrade}
                              />
                            </span>
                          </Tooltip>
                        </DataTableCell>
                        <DataTableCell className="w-[4.75rem] whitespace-nowrap text-text-muted">
                          {totalScore !== null ? `${Math.round((totalScore / 30) * 100)}` : '—'}
                        </DataTableCell>
                        <DataTableCell className="w-[11rem] max-w-[11rem] align-top">
                          <AssignmentArtifactsCell
                            artifacts={student.artifacts || []}
                            isCompact={showOverviewInspector}
                          />
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                  {sortedStudents.length === 0 && (
                    <EmptyStateRow colSpan={6} message="No students enrolled" />
                  )}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </TableCard>
      </KeyboardNavigableTable>
    </div>
  )

  const primaryButtons =
    selection.mode === 'summary' ? (
      <button
        type="button"
        className={`${ACTIONBAR_BUTTON_PRIMARY_CLASSNAME} flex items-center gap-1`}
        onClick={() => setIsCreateModalOpen(true)}
        disabled={isReadOnly}
        aria-label="New assignment"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        <span>New</span>
      </button>
    ) : (
      <div className="flex w-full flex-wrap items-center gap-2 sm:min-h-[2.75rem]">
        <div className="mb-[-1px] flex items-end gap-1 self-end">
          <button
            type="button"
            className={[
              assignmentWorkspaceMode === 'overview'
                ? 'relative z-10 rounded-t-lg border border-border border-b-surface bg-surface text-text-default'
                : 'rounded-t-lg border border-transparent bg-surface-2 text-text-muted hover:bg-surface-hover hover:text-text-default',
              'min-h-10 px-3 py-2 text-sm font-medium transition-colors',
            ].join(' ')}
            onClick={() => handleSwitchWorkspaceMode('overview')}
            aria-pressed={assignmentWorkspaceMode === 'overview'}
          >
            Class
          </button>
          <button
            type="button"
            className={[
              assignmentWorkspaceMode === 'details'
                ? 'relative z-10 rounded-t-lg border border-border border-b-surface bg-surface text-text-default'
                : 'rounded-t-lg border border-transparent bg-surface-2 text-text-muted hover:bg-surface-hover hover:text-text-default',
              !canOpenDetails ? 'cursor-not-allowed opacity-50 hover:bg-surface-2 hover:text-text-muted' : '',
              'min-h-10 px-3 py-2 text-sm font-medium transition-colors',
            ].join(' ')}
            onClick={() => handleSwitchWorkspaceMode('details')}
            aria-pressed={assignmentWorkspaceMode === 'details'}
            disabled={!canOpenDetails}
          >
            Individual
          </button>
        </div>

        <div className="flex min-w-0 basis-full justify-center sm:basis-auto sm:flex-1">
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 sm:gap-3">
            {assignmentWorkspaceMode === 'overview' ? (
              <>
                <Tooltip content={`Grade${workspaceActionLabelSuffix}`}>
                  <SplitButton
                    label={
                      <span className="inline-flex items-center gap-2">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <span>AI Grade</span>
                      </span>
                    }
                    onPrimaryClick={() => {
                      void handleBatchAutoGrade()
                    }}
                    options={[
                      {
                        id: 'repo-analysis',
                        label: (
                          <span className="inline-flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" aria-hidden="true" />
                            <span>Repo analysis</span>
                          </span>
                        ),
                        onSelect: () => {
                          void handleBatchArtifactRepoAnalyze()
                        },
                        disabled: isArtifactRepoAnalyzing || hasActiveAssignmentAiRun || isReadOnly || batchSelectedCount === 0,
                      },
                    ]}
                    disabled={isAutoGrading || hasActiveAssignmentAiRun || isReadOnly || batchSelectedCount === 0}
                    className="inline-flex"
                    toggleAriaLabel={`More grading actions${workspaceActionLabelSuffix}`}
                    menuPlacement="down"
                    primaryButtonProps={{
                      'aria-label': `AI Grade${workspaceActionLabelSuffix}`,
                    }}
                  />
                </Tooltip>

                <Tooltip content={`Return${workspaceActionLabelSuffix}`}>
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    className="px-4"
                    onClick={() => {
                      setShowReturnConfirm(true)
                    }}
                    disabled={isReturning || hasActiveAssignmentAiRun || isReadOnly || batchSelectedCount === 0}
                    aria-label={`Return${workspaceActionLabelSuffix}`}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>Return</span>
                  </Button>
                </Tooltip>
              </>
            ) : (
              <>
                <div
                  className="min-w-0 max-w-[18rem] truncate text-center text-sm font-medium text-text-default"
                  title={selectedStudentDisplayName ?? undefined}
                >
                  {selectedStudentDisplayName ?? 'No student selected'}
                </div>
                {individualCharacterCountLabel && (
                  <div className="shrink-0 text-xs text-text-muted" aria-label={individualCharacterCountLabel}>
                    {individualCharacterCountLabel}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={ACTIONBAR_ICON_BUTTON_CLASSNAME}
                    onClick={handleGoPrevStudent}
                    disabled={!canGoPrevStudent}
                    aria-label="Previous student"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={ACTIONBAR_ICON_BUTTON_CLASSNAME}
                    onClick={handleGoNextStudent}
                    disabled={!canGoNextStudent}
                    aria-label="Next student"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}

            {workspaceLoading && (
              <div aria-live="polite" className="inline-flex items-center gap-1 text-xs text-text-muted">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Updating</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 sm:ml-auto sm:gap-2">
          <Tooltip content="Edit assignment">
            <button
              type="button"
              className={`${ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME} inline-flex max-w-[22rem] items-center gap-2`}
              onClick={() => {
                if (activeSelectedAssignmentData) {
                  setEditAssignment(activeSelectedAssignmentData.assignment)
                }
              }}
              disabled={!canEditAssignment}
              aria-label="Edit assignment"
              title={selectedAssignmentTitle}
            >
              <span className="truncate">{selectedAssignmentTitle}</span>
              <Pencil className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    )

  const showMobileToggle = selection.mode === 'summary'

  return (
    <PageLayout className="flex h-full min-h-0 flex-col">
      <PageActionBar
        primary={primaryButtons}
        actions={[]}
        trailing={showMobileToggle ? <RightSidebarToggle /> : undefined}
        className={selection.mode === 'summary' ? '' : 'pl-0 pr-2'}
      />

      <PageContent
        className={
          selection.mode === 'summary'
            ? 'flex flex-col gap-3'
            : 'px-0 flex min-h-0 flex-1 flex-col gap-3 pt-0'
        }
      >
        {error && (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-md border border-primary bg-info-bg px-3 py-2 text-sm text-info">
            {info}
          </div>
        )}

        {selection.mode === 'summary' ? (
          <div>
            {showSummarySpinner ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : assignments.length === 0 ? (
              <div className="py-6 text-center text-sm text-text-muted">
                No assignments yet
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={assignments.map((assignment) => assignment.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <PageStack>
                    {assignments.map((assignment) => (
                      <SortableAssignmentCard
                        key={assignment.id}
                        assignment={assignment}
                        isReadOnly={isReadOnly}
                        isDragDisabled={isReordering}
                        onSelect={() => {
                          if (assignment.is_draft || isScheduledAssignment(assignment)) {
                            setEditAssignment(assignment)
                          } else {
                            setSelectionAndPersist({ mode: 'assignment', assignmentId: assignment.id })
                          }
                        }}
                        onEdit={() => setEditAssignment(assignment)}
                        onDelete={() => setPendingDelete({ id: assignment.id, title: assignment.title })}
                      />
                    ))}
                  </PageStack>
                </SortableContext>
              </DndContext>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-lg border border-border bg-surface">
            <div
              ref={workspaceContainerRef}
              className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
            >
              {assignmentWorkspaceMode === 'details' ? (
                activeSelectedStudentId ? (
                  <TeacherStudentWorkPanel
                    classroomId={classroom.id}
                    assignmentId={selection.assignmentId}
                    studentId={activeSelectedStudentId}
                    mode="details"
                    inspectorCollapsed={false}
                    inspectorWidth={activeWorkspaceLayout.inspectorWidth}
                    totalWidth={workspaceWidth}
                    onLayoutChange={(next) => updateModeLayout('details', next)}
                    onLoadingStateChange={setWorkspaceLoading}
                    onGoPrevStudent={handleGoPrevStudent}
                    onGoNextStudent={handleGoNextStudent}
                    canGoPrevStudent={canGoPrevStudent}
                    canGoNextStudent={canGoNextStudent}
                    onDetailsMetaChange={setIndividualHeaderMeta}
                  />
                ) : selectedAssignmentLoading || (selection.mode === 'assignment' && !activeSelectedAssignmentData && !selectedAssignmentError) ? (
                  <div className="flex flex-1 items-center justify-center py-12">
                    <Spinner />
                  </div>
                ) : selectedAssignmentError ? (
                  <div className="flex flex-1 items-center justify-center p-4 text-sm text-danger">
                    {selectedAssignmentError}
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
                    No student submissions yet.
                  </div>
                )
              ) : showOverviewInspector ? (
                <div className="flex h-full min-h-0 flex-col lg:flex-row">
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {studentTable}
                  </div>
                  {isDesktop && (
                    <div className="relative hidden w-0 shrink-0 lg:block">
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize table and grading panes"
                        className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize bg-transparent"
                        onPointerDown={handleOverviewInspectorResizeStart}
                        onDoubleClick={handleOverviewInspectorResizeReset}
                      >
                        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
                      </div>
                    </div>
                  )}
                  <div
                    className="min-h-0 border-t border-border bg-surface lg:border-t-0"
                    style={
                      isDesktop
                        ? ({
                            width: `${activeWorkspaceLayout.inspectorWidth}%`,
                            flexBasis: `${activeWorkspaceLayout.inspectorWidth}%`,
                          } as const)
                        : undefined
                    }
                  >
                    <TeacherStudentWorkPanel
                      classroomId={classroom.id}
                      assignmentId={selection.assignmentId}
                      studentId={activeSelectedStudentId}
                      mode="overview"
                      inspectorCollapsed={false}
                      inspectorWidth={activeWorkspaceLayout.inspectorWidth}
                      totalWidth={workspaceWidth}
                      onLoadingStateChange={setWorkspaceLoading}
                    />
                  </div>
                </div>
              ) : (
                studentTable
              )}
            </div>
          </div>
        )}

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="Delete assignment?"
        description={pendingDelete ? `${pendingDelete.title}\n\nThis cannot be undone.` : undefined}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={isDeleting}
        isCancelDisabled={isDeleting}
        onCancel={() => (isDeleting ? null : setPendingDelete(null))}
        onConfirm={deleteAssignment}
      />


      <ConfirmDialog
        isOpen={showReturnConfirm}
        title={`Return work to ${batchSelectedCount} selected student(s)?`}
        description={`This clears the assignment mailbox for the selected students. ${batchSelectedGradedCount} ready item(s) will also be returned to students now.${batchSelectedUngradedCount > 0 ? ` ${batchSelectedUngradedCount} not-yet-graded item(s) will be cleared from the mailbox only.` : ''}`}
        confirmLabel={isReturning ? 'Returning...' : 'Return'}
        cancelLabel="Cancel"
        isConfirmDisabled={isReturning}
        isCancelDisabled={isReturning}
        onCancel={() => (isReturning ? null : setShowReturnConfirm(false))}
        onConfirm={handleBatchReturn}
      />

      <AssignmentModal
        isOpen={isCreateModalOpen || !!editAssignment}
        classroomId={classroom.id}
        assignment={editAssignment}
        classDays={classDays}
        onClose={() => {
          setEditAssignment(null)
          setIsCreateModalOpen(false)
        }}
        onSuccess={(assignment, options) => {
          if (editAssignment) {
            handleEditSuccess(assignment)
          } else {
            handleCreateSuccess(assignment)
          }
          if (options?.closeModal === false) {
            return
          }
          setEditAssignment(null)
          setIsCreateModalOpen(false)
        }}
      />
      </PageContent>
    </PageLayout>
  )
}

// Sidebar content component - rendered via page.tsx
export function TeacherAssignmentsMarkdownSidebar({
  markdownContent,
  markdownError,
  markdownWarning,
  hasRichContent,
  bulkSaving,
  onMarkdownChange,
  onSave,
}: {
  markdownContent: string
  markdownError: string | null
  markdownWarning: string | null
  hasRichContent: boolean
  bulkSaving: boolean
  onMarkdownChange: (content: string) => void
  onSave: () => void
}) {
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
      {hasRichContent && (
        <div className="mx-3 mt-3 p-2 rounded bg-warning-bg text-sm text-warning">
          Some legacy assignments were converted from rich text and may have simplified formatting.
        </div>
      )}

      {markdownWarning && (
        <div className="mx-3 mt-3 p-2 rounded bg-warning-bg text-sm text-warning whitespace-pre-wrap">
          <strong>Warning:</strong> {markdownWarning}
        </div>
      )}

      {markdownError && (
        <div className="mx-3 mt-3 p-2 rounded bg-danger-bg text-sm text-danger whitespace-pre-wrap">
          {markdownError}
        </div>
      )}

      <textarea
        value={markdownContent}
        onChange={(e) => onMarkdownChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 w-full p-3 font-mono text-sm bg-surface text-text-default resize-none border-0 focus:ring-0 focus:outline-none"
      />
    </div>
  )
}
