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
  Copy,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  Send,
} from 'lucide-react'
import { Button, ConfirmDialog, SplitButton, Tooltip, useAppMessage, useOverlayMessage } from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { Spinner } from '@/components/Spinner'
import { AssignmentModal } from '@/components/AssignmentModal'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import {
  TeacherAssignmentStudentTable,
  type TeacherAssignmentStudentRow,
} from '@/components/assignment-workspace/TeacherAssignmentStudentTable'
import {
  TeacherStudentWorkPanel,
  type TeacherAssignmentGradeTemplate,
} from '@/components/TeacherStudentWorkPanel'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherEditModeControls } from '@/components/teacher-work-surface/TeacherEditModeControls'
import { TeacherWorkSurfaceModeBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceModeBar'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  ACTIONBAR_ICON_BUTTON_CLASSNAME,
  ACTIONBAR_BUTTON_PRIMARY_CLASSNAME,
  ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME,
  PageStack,
} from '@/components/PageLayout'
import {
  calculateAssignmentStatus,
  getAssignmentRubricState,
  isAssignmentAlreadyReturnedWithoutResubmission,
} from '@/lib/assignments'
import { useAssignmentGradingLayout } from '@/hooks/use-assignment-grading-layout'
import {
  ASSIGNMENT_GRADING_LAYOUT,
  getAssignmentWorkspaceStudentCookieName,
  parseAssignmentWorkspaceStudentId,
  type AssignmentWorkspaceMode,
} from '@/lib/assignment-grading-layout'
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
  TEACHER_ASSIGNMENTS_SELECTION_EVENT,
  TEACHER_ASSIGNMENTS_UPDATED_EVENT,
  TEACHER_GRADE_UPDATED_EVENT,
  type TeacherGradeUpdatedEventDetail,
} from '@/lib/events'
import { applyDirection, compareByNameFields, toggleSort as toggleSortState } from '@/lib/table-sort'
import type { SortDirection } from '@/lib/table-sort'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import { readCookie, writeCookie } from '@/lib/cookies'

interface AssignmentWithStats extends Assignment {
  stats: AssignmentStats
}

type TeacherAssignmentSelection = { mode: 'summary' } | { mode: 'assignment'; assignmentId: string }

type StudentSubmissionRow = TeacherAssignmentStudentRow
type GradeSelectedUpdatedDoc = NonNullable<StudentSubmissionRow['doc']> & {
  student_id: string
  updated_at?: string | null
}
type GradeSelectedApplyTarget = 'grade' | 'comments'
type UpdateSearchParamsFn = (
  updater: (params: URLSearchParams) => void,
  options?: { replace?: boolean },
) => void

export type AssignmentViewMode = 'summary' | 'assignment'

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
  onViewModeChange?: (mode: AssignmentViewMode) => void
  onEditModeChange?: (active: boolean) => void
  isActive?: boolean
  selectedAssignmentId?: string | null
  selectedAssignmentStudentId?: string | null
  updateSearchParams?: UpdateSearchParamsFn
}

function isScheduledAssignment(assignment: Assignment): boolean {
  return !assignment.is_draft && !!assignment.released_at && !isVisibleAtNow(assignment.released_at)
}

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

function getStudentDisplayName(row: StudentSubmissionRow | null): string | null {
  if (!row) return null
  const fullName = [row.student_first_name, row.student_last_name].filter(Boolean).join(' ').trim()
  return fullName || row.student_email || null
}

function getBatchReturnEligibility(
  doc: StudentSubmissionRow['doc']
): 'missing' | 'blocked' | 'already_returned' | 'returnable' {
  if (!doc) return 'missing'
  if (getAssignmentRubricState(doc) === 'partial') return 'blocked'
  if (isAssignmentAlreadyReturnedWithoutResubmission(doc)) return 'already_returned'
  return 'returnable'
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

function isGradeSelectedScoreValueValid(value: string, allowBlank: boolean): boolean {
  const trimmed = value.trim()
  if (allowBlank && !trimmed) return true
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10
}

function isGradeSelectedTemplateValid(template: TeacherAssignmentGradeTemplate | null): boolean {
  if (!template) return false

  const allowBlank = template.gradeMode === 'draft'
  return [
    template.scoreCompletion,
    template.scoreThinking,
    template.scoreWorkflow,
  ].every((value) => isGradeSelectedScoreValueValid(value, allowBlank))
}

function summarizeAssignmentAiGradingErrors(run: AssignmentAiGradingRunSummary): string {
  const uniqueMessages: string[] = []
  const seen = new Set<string>()

  for (const sample of run.error_samples) {
    const message = sample.message.trim()
    if (!message || seen.has(message)) continue
    seen.add(message)
    uniqueMessages.push(message)
  }

  if (uniqueMessages.length === 0) return ''

  return uniqueMessages
    .slice(0, 3)
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
  const missingCount = run.skipped_empty_count + run.skipped_missing_count
  if (missingCount > 0) {
    summaryParts.push(`${missingCount} missing`)
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

export function TeacherClassroomView({
  classroom,
  onSelectAssignment,
  onViewModeChange,
  onEditModeChange,
  isActive = true,
  selectedAssignmentId: selectedAssignmentIdProp,
  selectedAssignmentStudentId,
  updateSearchParams,
}: Props) {
  const isReadOnly = !!classroom.archived_at
  const isUrlSelectionControlled = selectedAssignmentIdProp !== undefined

  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selection, setSelection] = useState<TeacherAssignmentSelection>({ mode: 'summary' })
  const [isReordering, setIsReordering] = useState(false)
  const [assignmentEditMode, setAssignmentEditMode] = useState(false)

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
  const syncedStudentUrlKeyRef = useRef<string | null>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(0)

  // Batch grading state
  const [isAutoGrading, setIsAutoGrading] = useState(false)
  const [isGradeSelectedSaving, setIsGradeSelectedSaving] = useState(false)
  const [isArtifactRepoAnalyzing, setIsArtifactRepoAnalyzing] = useState(false)
  const [isReturning, setIsReturning] = useState(false)
  const [batchProgressCount, setBatchProgressCount] = useState(0)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)
  const [gradeSelectedConfirmTarget, setGradeSelectedConfirmTarget] =
    useState<GradeSelectedApplyTarget | null>(null)
  const [highlightedApplyTarget, setHighlightedApplyTarget] = useState<GradeSelectedApplyTarget | null>(null)
  const [gradeSelectedTemplate, setGradeSelectedTemplate] =
    useState<TeacherAssignmentGradeTemplate | null>(null)
  const [gradeSelectedRefreshCounter, setGradeSelectedRefreshCounter] = useState(0)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const wasActiveRef = useRef(isActive)
  const handledCompletedRunKeysRef = useRef<Set<string>>(new Set())
  const showSummarySpinner = useDelayedBusy(loading && assignments.length === 0)
  const { showMessage } = useAppMessage()
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
	        fetchJSONWithCache(
	          `class-days:${classroom.id}`,
	          async () => {
	            const response = await fetch(`/api/classrooms/${classroom.id}/class-days`)
	            if (!response.ok) return { class_days: [] }
	            return response.json().catch(() => ({ class_days: [] }))
	          },
	          20_000,
	        ),
	      ])
	      setAssignments(assignmentsData.assignments || [])
	      setClassDays(classDaysRes.class_days || [])
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
      if (!over || active.id === over.id || isReordering || isReadOnly || !assignmentEditMode) return

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
    [assignmentEditMode, assignments, classroom.id, isReordering, isReadOnly, loadAssignments]
  )

  useEffect(() => {
    if (isUrlSelectionControlled) return
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
  }, [assignments, classroom.id, isUrlSelectionControlled, loading])

  useEffect(() => {
    if (!isUrlSelectionControlled) return
    if (loading) return

    const cookieName = `teacherAssignmentsSelection:${classroom.id}`
    const value = selectedAssignmentIdProp
    if (!value || value === 'summary') {
      writeCookie(cookieName, 'summary')
      setSelection({ mode: 'summary' })
      return
    }

    const assignment = assignments.find((a) => a.id === value)
    if (!assignment) {
      writeCookie(cookieName, 'summary')
      setSelection({ mode: 'summary' })
      return
    }

    // Draft/scheduled assignments open the editor for release controls.
    if (assignment.is_draft || isScheduledAssignment(assignment)) {
      setEditAssignment(assignment)
      writeCookie(cookieName, 'summary')
      setSelection({ mode: 'summary' })
    } else {
      writeCookie(cookieName, value)
      setSelection({ mode: 'assignment', assignmentId: value })
    }
  }, [assignments, classroom.id, isUrlSelectionControlled, loading, selectedAssignmentIdProp])

  useEffect(() => {
    function onSelectionEvent(e: Event) {
      if (isUrlSelectionControlled) return
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
  }, [assignments, classroom.id, isUrlSelectionControlled])

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
	        const data = await fetchJSONWithCache(
	          `teacher-assignment-detail:${assignmentId}:${refreshCounter}`,
	          async () => {
	            const response = await fetch(`/api/teacher/assignments/${assignmentId}`)
	            const payload = await response.json()
	            if (!response.ok) {
	              throw new Error(payload.error || 'Failed to load assignment')
	            }
	            return payload
	          },
	          2_000,
	        )

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

  useEffect(() => {
    onEditModeChange?.(assignmentEditMode)
  }, [assignmentEditMode, onEditModeChange])

  useEffect(() => {
    return () => {
      onEditModeChange?.(false)
    }
  }, [onEditModeChange])

  const assignmentEditModeResetKey =
    selection.mode === 'assignment' ? selection.assignmentId : 'summary'

  useEffect(() => {
    setAssignmentEditMode(false)
  }, [assignmentEditModeResetKey, classroom.id])

  useEffect(() => {
    if (isActive && !isReadOnly) return
    setAssignmentEditMode(false)
  }, [isActive, isReadOnly])

  useEffect(() => {
    if (!assignmentEditMode) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      setAssignmentEditMode(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [assignmentEditMode])

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

  const setSelectionAndPersist = useCallback((
    next: TeacherAssignmentSelection,
    options: { updateUrl?: boolean; replace?: boolean } = {},
  ) => {
    const cookieName = `teacherAssignmentsSelection:${classroom.id}`
    const cookieValue = next.mode === 'summary' ? 'summary' : next.assignmentId
    writeCookie(cookieName, cookieValue)
    setSelection(next)
    if (options.updateUrl === false || !updateSearchParams) return

    updateSearchParams((params) => {
      params.set('tab', 'assignments')
      if (next.mode === 'assignment') {
        params.set('assignmentId', next.assignmentId)
      } else {
        params.delete('assignmentId')
      }
      params.delete('assignmentStudentId')
    }, { replace: options.replace })
  }, [classroom.id, updateSearchParams])

  const setSelectedStudentAndNavigate = useCallback((
    studentId: string | null,
    options: { updateUrl?: boolean; replace?: boolean } = {},
  ) => {
    setSelectedStudentId(studentId)
    if (options.updateUrl === false || !updateSearchParams || selection.mode !== 'assignment') return

    updateSearchParams((params) => {
      params.set('tab', 'assignments')
      params.set('assignmentId', selection.assignmentId)
      if (studentId) {
        params.set('assignmentStudentId', studentId)
      } else {
        params.delete('assignmentStudentId')
      }
    }, { replace: options.replace })
  }, [selection, updateSearchParams])

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
    setSelection: batchSetSelection,
    selectedCount: batchSelectedCount,
  } = useStudentSelection(studentRowIds)
  const handleGradeTemplateChange = useCallback((template: TeacherAssignmentGradeTemplate | null) => {
    setGradeSelectedTemplate(template)
  }, [])

  useEffect(() => {
    if (selection.mode !== 'assignment') return
    setAssignmentWorkspaceMode('overview')
    setSelectedStudentId(null)
    setWorkspaceLoading(false)
    batchClearSelection()
  }, [batchClearSelection, selectedAssignmentKey, selection.mode])

  const batchSelectedReturnSummary = useMemo(() => {
    let returnableCount = 0
    let blockedCount = 0
    let missingCount = 0
    let alreadyReturnedCount = 0

    for (const student of currentStudentRows) {
      if (!batchSelectedIds.has(student.student_id)) continue

      switch (getBatchReturnEligibility(student.doc)) {
        case 'returnable':
          returnableCount += 1
          break
        case 'blocked':
          blockedCount += 1
          break
        case 'missing':
          missingCount += 1
          break
        case 'already_returned':
          alreadyReturnedCount += 1
          break
      }
    }

    return { returnableCount, blockedCount, missingCount, alreadyReturnedCount }
  }, [batchSelectedIds, currentStudentRows])

  useEffect(() => {
    if (!info) return
    showMessage({ text: info, tone: 'info' })
    setInfo('')
  }, [info, showMessage])

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
      const createdCount = Number(data.created_count ?? 0)
      const blockedCount = Number(data.blocked_count ?? 0)
      const alreadyReturnedCount = Number(data.already_returned_count ?? 0)
      const missingCount = Number(data.missing_count ?? 0)
      const returnedStudentIds = Array.isArray(data.returned_student_ids)
        ? data.returned_student_ids.filter((value: unknown): value is string => typeof value === 'string')
        : []
      const alreadyReturnedStudentIds = Array.isArray(data.already_returned_student_ids)
        ? data.already_returned_student_ids.filter((value: unknown): value is string => typeof value === 'string')
        : []
      const completedStudentIds = new Set([...returnedStudentIds, ...alreadyReturnedStudentIds])
      const remainingSelectedIds = Array.from(batchSelectedIds).filter(
        (studentId) => !completedStudentIds.has(studentId)
      )
      if (remainingSelectedIds.length > 0) {
        batchSetSelection(remainingSelectedIds)
      } else {
        batchClearSelection()
      }

      const updatedCount = Math.max(0, returnedCount - createdCount)
      const summaryParts: string[] = []
      if (updatedCount > 0) {
        summaryParts.push(`Returned ${updatedCount}`)
      }
      if (createdCount > 0) {
        summaryParts.push(`Created ${createdCount} zero-grade return${createdCount === 1 ? '' : 's'}`)
      }
      if (alreadyReturnedCount > 0) {
        summaryParts.push(`Skipped ${alreadyReturnedCount} already returned`)
      }
      if (blockedCount > 0) {
        summaryParts.push(`Blocked ${blockedCount} partial-rubric draft${blockedCount === 1 ? '' : 's'}`)
      }
      if (missingCount > 0) {
        summaryParts.push(`${missingCount} unavailable`)
      }
      if (returnedCount === 0 && clearedCount > 0) {
        summaryParts.push(`Cleared ${clearedCount}`)
      }
      setInfo(summaryParts.join(' • '))
      setShowReturnConfirm(false)
      // Reload assignment data to refresh statuses/grades
      setRefreshCounter((c) => c + 1)
    } catch (err: any) {
      setError(err.message || 'Return failed')
    } finally {
      setIsReturning(false)
    }
  }

  async function handleGradeSelected(applyTarget: GradeSelectedApplyTarget) {
    if (!selectedAssignmentData || !gradeSelectedTemplate || batchSelectedCount === 0) return

    if (applyTarget === 'grade' && !isGradeSelectedTemplateValid(gradeSelectedTemplate)) {
      setError('Scores must be blank or integers 0–10')
      return
    }

    const studentIds = Array.from(batchSelectedIds)
    setBatchProgressCount(studentIds.length)
    setIsGradeSelectedSaving(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedAssignmentData.assignment.id}/grade-selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_ids: studentIds,
          apply_target: applyTarget,
          ...(applyTarget === 'grade'
            ? {
                score_completion: gradeSelectedTemplate.scoreCompletion,
                score_thinking: gradeSelectedTemplate.scoreThinking,
                score_workflow: gradeSelectedTemplate.scoreWorkflow,
                save_mode: gradeSelectedTemplate.gradeMode,
              }
            : {
                feedback: gradeSelectedTemplate.feedbackDraft,
              }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to apply ${applyTarget}`)

      const updatedDocs: GradeSelectedUpdatedDoc[] = Array.isArray(data.docs)
        ? data.docs.filter((doc: unknown): doc is GradeSelectedUpdatedDoc =>
            !!doc && typeof doc === 'object' && typeof (doc as { student_id?: unknown }).student_id === 'string'
          )
        : []
      const docsByStudentId = new Map<string, GradeSelectedUpdatedDoc>(
        updatedDocs.map((doc) => [doc.student_id, doc])
      )

      if (docsByStudentId.size > 0) {
        setSelectedAssignmentData((prev) => {
          if (!prev || prev.assignment.id !== selectedAssignmentData.assignment.id) return prev

          const nextStudents = prev.students.map((student) => {
            const updatedDoc = docsByStudentId.get(student.student_id)
            if (!updatedDoc) return student

            return {
              ...student,
              doc: {
                ...(student.doc ?? {}),
                ...updatedDoc,
              },
              status: calculateAssignmentStatus(prev.assignment, updatedDoc as any),
              student_updated_at: updatedDoc.updated_at ?? student.student_updated_at,
            }
          })

          return { ...prev, students: nextStudents }
        })
      }

      const updatedCount = Number(data.updated_count ?? docsByStudentId.size)
      setInfo(`Applied ${applyTarget} to ${updatedCount} selected student${updatedCount === 1 ? '' : 's'}`)
      setGradeSelectedConfirmTarget(null)
      batchClearSelection()

      if (activeSelectedStudentId && docsByStudentId.has(activeSelectedStudentId)) {
        setGradeSelectedRefreshCounter((count) => count + 1)
      }
    } catch (err: any) {
      setError(err.message || `Failed to apply ${applyTarget}`)
    } finally {
      setIsGradeSelectedSaving(false)
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
    setSelectedStudentAndNavigate(currentStudentRows[selectedStudentIndex - 1].student_id)
  }, [currentStudentRows, selectedStudentIndex, setSelectedStudentAndNavigate])

  const handleGoNextStudent = useCallback(() => {
    if (selectedStudentIndex === -1 || selectedStudentIndex >= currentStudentRows.length - 1) return
    setSelectedStudentAndNavigate(currentStudentRows[selectedStudentIndex + 1].student_id)
  }, [currentStudentRows, selectedStudentIndex, setSelectedStudentAndNavigate])

  useEffect(() => {
    if (!isUrlSelectionControlled) return
    if (selection.mode !== 'assignment') {
      syncedStudentUrlKeyRef.current = null
      return
    }

    const nextStudentId = parseAssignmentWorkspaceStudentId(selectedAssignmentStudentId ?? null)
    const syncKey = `${selection.assignmentId}:${nextStudentId ?? 'none'}`
    if (syncedStudentUrlKeyRef.current === syncKey) return

    if (nextStudentId && !currentStudentRows.some((student) => student.student_id === nextStudentId)) {
      if (selectedAssignmentLoading || currentStudentRows.length === 0) return
      syncedStudentUrlKeyRef.current = syncKey
      defaultedWorkspaceKeyRef.current = null
      setSelectedStudentId(null)
      updateSearchParams?.((params) => {
        params.delete('assignmentStudentId')
      }, { replace: true })
      return
    }

    syncedStudentUrlKeyRef.current = syncKey
    defaultedWorkspaceKeyRef.current = null
    setSelectedStudentId(nextStudentId)
  }, [
    currentStudentRows,
    isUrlSelectionControlled,
    selectedAssignmentLoading,
    selectedAssignmentStudentId,
    selection,
    updateSearchParams,
  ])

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
      setSelectedStudentAndNavigate(nextStudentId, { replace: true })
    } else {
      setIndividualHeaderMeta(null)
    }

    updateModeLayout(nextMode, assignmentGradingLayout[assignmentWorkspaceMode])
    setAssignmentWorkspaceMode(nextMode)
  }, [
    assignmentGradingLayout,
    assignmentWorkspaceMode,
    resolveDetailsStudentId,
    setSelectedStudentAndNavigate,
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
      setSelectedStudentAndNavigate(nextStudentId, { replace: true })
    }
  }, [
    activeSelectedAssignmentData,
    activeSelectedStudentId,
    assignmentWorkspaceMode,
    resolveDetailsStudentId,
    selectedAssignmentLoading,
    setSelectedStudentAndNavigate,
    selection,
  ])

  // Escape key to deselect student
  useEffect(() => {
    if (assignmentEditMode) return
    if (assignmentWorkspaceMode !== 'overview') return
    if (!selectedStudentId) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectedStudentAndNavigate(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [assignmentEditMode, assignmentWorkspaceMode, selectedStudentId, setSelectedStudentAndNavigate])

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
  const highlightedInspectorSections =
    highlightedApplyTarget === 'grade'
      ? (['grades'] as const)
      : highlightedApplyTarget === 'comments'
        ? (['comments'] as const)
        : undefined
  const canOpenDetails =
    selection.mode === 'assignment' &&
    !selectedAssignmentLoading &&
    currentStudentRows.length > 0
  const workspaceActionLabelSuffix = batchSelectedCount > 0 ? ` (${batchSelectedCount})` : ''
  const hasReturnableSelection =
    batchSelectedReturnSummary.returnableCount + batchSelectedReturnSummary.missingCount > 0
  const isReturnDisabled =
    isReturning || isGradeSelectedSaving || hasActiveAssignmentAiRun || isReadOnly || batchSelectedCount === 0 || !hasReturnableSelection
  const returnTooltipContent =
    batchSelectedCount > 0 && !hasReturnableSelection
      ? 'Nothing returnable selected'
      : `Return${workspaceActionLabelSuffix}`
  const gradeSelectedTemplateIsValid = isGradeSelectedTemplateValid(gradeSelectedTemplate)
  const isApplyGradeSelectedDisabled =
    isGradeSelectedSaving ||
    isAutoGrading ||
    hasActiveAssignmentAiRun ||
    isArtifactRepoAnalyzing ||
    isReturning ||
    isReadOnly ||
    batchSelectedCount === 0 ||
    !gradeSelectedTemplate ||
    !gradeSelectedTemplateIsValid
  const isApplyCommentsSelectedDisabled =
    isGradeSelectedSaving ||
    isAutoGrading ||
    hasActiveAssignmentAiRun ||
    isArtifactRepoAnalyzing ||
    isReturning ||
    isReadOnly ||
    batchSelectedCount === 0 ||
    !gradeSelectedTemplate
  const isGradeSelectedConfirmDisabled =
    gradeSelectedConfirmTarget === 'grade'
      ? isApplyGradeSelectedDisabled
      : gradeSelectedConfirmTarget === 'comments'
        ? isApplyCommentsSelectedDisabled
        : true
  const showAssignmentAiRunOverlay = isAutoGrading || hasActiveAssignmentAiRun
  const assignmentAiRunOverlayLabel = hasActiveAssignmentAiRun && activeAssignmentAiRun
    ? `Grading ${Math.min(activeAssignmentAiRun.processed_count, activeAssignmentAiRun.requested_count)} of ${activeAssignmentAiRun.requested_count} students…`
    : `Starting grading for ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
  const gradeSelectedSavingLabel =
    gradeSelectedConfirmTarget === 'comments' ? 'Applying comments' : 'Applying grade'
  const activeWorkMessage = showAssignmentAiRunOverlay
    ? assignmentAiRunOverlayLabel
    : isArtifactRepoAnalyzing
      ? `Analyzing repos for ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
      : isReturning
        ? `Returning to ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
        : isGradeSelectedSaving
          ? `${gradeSelectedSavingLabel} to ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
          : ''
  useOverlayMessage(!!activeWorkMessage, activeWorkMessage, { tone: 'loading' })

  const studentBusyOverlay = activeWorkMessage ? (
    <div className="absolute inset-0 z-10 rounded-md bg-surface/30" aria-hidden="true" />
  ) : null

  const studentTable = (
    <TeacherAssignmentStudentTable
      rows={currentStudentRows}
      selectedStudentId={activeSelectedStudentId}
      onSelectStudent={(studentId) => {
        if (assignmentWorkspaceMode === 'details') {
          setIndividualHeaderMeta(null)
        }
        setSelectedStudentAndNavigate(studentId)
      }}
      onDeselectStudent={() => setSelectedStudentAndNavigate(null)}
      tableRef={tableContainerRef}
      selectedIds={batchSelectedIds}
      onToggleSelect={batchToggleSelect}
      onToggleSelectAll={batchToggleSelectAll}
      allSelected={batchAllSelected}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onToggleSort={toggleSort}
      dueAtMs={dueAtMs}
      density={showOverviewInspector ? 'tight' : 'compact'}
      loading={selectedAssignmentLoading || (selection.mode === 'assignment' && !activeSelectedAssignmentData && !selectedAssignmentError)}
      error={selectedAssignmentError}
      busyOverlay={studentBusyOverlay}
    />
  )

  const workspaceModeCenter = assignmentWorkspaceMode === 'overview' ? (
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
              id: 'grade-selected',
              label: (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  <span>Apply Grade to Selected Students</span>
                </span>
              ),
              onHoverChange: (active) => setHighlightedApplyTarget(active ? 'grade' : null),
              onSelect: () => {
                setHighlightedApplyTarget(null)
                setGradeSelectedConfirmTarget('grade')
              },
              disabled: isApplyGradeSelectedDisabled,
            },
            {
              id: 'comments-selected',
              label: (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  <span>Apply Comments to Selected Students</span>
                </span>
              ),
              onHoverChange: (active) => setHighlightedApplyTarget(active ? 'comments' : null),
              onSelect: () => {
                setHighlightedApplyTarget(null)
                setGradeSelectedConfirmTarget('comments')
              },
              disabled: isApplyCommentsSelectedDisabled,
            },
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
              disabled: isArtifactRepoAnalyzing || isGradeSelectedSaving || hasActiveAssignmentAiRun || isReadOnly || batchSelectedCount === 0,
            },
          ]}
          disabled={isAutoGrading || isGradeSelectedSaving || hasActiveAssignmentAiRun || isReadOnly || batchSelectedCount === 0}
          className="inline-flex"
          toggleAriaLabel={`More grading actions${workspaceActionLabelSuffix}`}
          menuPlacement="down"
          primaryButtonProps={{
            'aria-label': `AI Grade${workspaceActionLabelSuffix}`,
          }}
        />
      </Tooltip>

      <Tooltip content={returnTooltipContent}>
        <span className="inline-flex">
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="px-4"
            onClick={() => {
              setShowReturnConfirm(true)
            }}
            disabled={isReturnDisabled}
            aria-label={`Return${workspaceActionLabelSuffix}`}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span>Return</span>
          </Button>
        </span>
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
  )

  const workspaceModeStatus = workspaceLoading ? (
    <div aria-live="polite" className="inline-flex items-center gap-1 text-xs text-text-muted">
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span>Updating</span>
    </div>
  ) : null

  const workspaceModeTrailing = assignmentEditMode ? (
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
  ) : (
    <div
      className="inline-flex min-h-10 max-w-[22rem] items-center px-2 text-sm font-medium text-text-default"
      title={selectedAssignmentTitle}
    >
      <span className="truncate">{selectedAssignmentTitle}</span>
    </div>
  )

  const assignmentEditControls = (
    <TeacherEditModeControls
      active={assignmentEditMode}
      onActiveChange={setAssignmentEditMode}
      disabled={isReadOnly}
    />
  )

  const primaryButtons =
    selection.mode === 'summary' ? (
      <div
        data-testid="assignment-summary-actionbar-center"
        className="relative flex min-h-10 w-full items-center justify-center"
      >
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
        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          {assignmentEditControls}
        </div>
      </div>
    ) : (
      <TeacherWorkSurfaceModeBar
        modes={[
          { id: 'overview', label: 'Class' },
          { id: 'details', label: 'Individual', disabled: !canOpenDetails },
        ]}
        activeMode={assignmentWorkspaceMode}
        onModeChange={(mode) => handleSwitchWorkspaceMode(mode as AssignmentWorkspaceMode)}
        center={workspaceModeCenter}
        status={workspaceModeStatus}
        trailing={workspaceModeTrailing}
      />
    )

  const selectedAssignmentId = selection.mode === 'assignment' ? selection.assignmentId : null

  const feedback = (
    <>
      {error && (
        <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
    </>
  )

  const summaryContent = showSummarySpinner ? (
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
              editMode={assignmentEditMode}
              onOpen={() => {
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
  )

  const workspaceContent = selectedAssignmentId == null ? null : assignmentWorkspaceMode === 'details' ? (
    activeSelectedStudentId ? (
      <TeacherStudentWorkPanel
        classroomId={classroom.id}
        assignmentId={selectedAssignmentId}
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
        inspectorEditMode={assignmentEditMode}
        onDetailsMetaChange={setIndividualHeaderMeta}
      />
    ) : selectedAssignmentLoading || (!activeSelectedAssignmentData && !selectedAssignmentError) ? (
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
    <TeacherWorkspaceSplit
      className="flex-1"
      primaryClassName="min-h-0"
      inspectorClassName="min-h-0"
      inspectorCollapsed={false}
      inspectorWidth={activeWorkspaceLayout.inspectorWidth}
      minInspectorPx={ASSIGNMENT_GRADING_LAYOUT.inspectorMinPx}
      minPrimaryPx={ASSIGNMENT_GRADING_LAYOUT.overviewPrimaryMinPx}
      onInspectorCollapsedChange={(collapsed) => {
        updateModeLayout('overview', (current) => ({
          ...current,
          inspectorCollapsed: collapsed,
        }))
      }}
      onInspectorWidthChange={(nextInspectorWidth) => {
        updateModeLayout('overview', (current) => ({
          ...current,
          inspectorCollapsed: false,
          inspectorWidth: nextInspectorWidth,
        }))
      }}
      dividerLabel="Resize table and grading panes"
      primary={studentTable}
      inspector={
        <TeacherStudentWorkPanel
          classroomId={classroom.id}
          assignmentId={selectedAssignmentId}
          studentId={activeSelectedStudentId}
          refreshKey={gradeSelectedRefreshCounter}
          mode="overview"
          highlightedInspectorSections={highlightedInspectorSections}
          inspectorCollapsed={false}
          inspectorWidth={activeWorkspaceLayout.inspectorWidth}
          totalWidth={workspaceWidth}
          inspectorEditMode={assignmentEditMode}
          onLoadingStateChange={setWorkspaceLoading}
          onGradeTemplateChange={handleGradeTemplateChange}
        />
      }
    />
  ) : (
    studentTable
  )

  return (
    <>
      <TeacherWorkSurfaceShell
        state={selection.mode === 'summary' ? 'summary' : 'workspace'}
        primary={primaryButtons}
        actions={[]}
        trailing={selection.mode === 'summary' ? undefined : assignmentEditControls}
        feedback={feedback}
        summary={summaryContent}
        workspace={workspaceContent}
        workspaceFrame="attachedTabs"
        workspaceRef={workspaceContainerRef}
      />

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
        isOpen={!!gradeSelectedConfirmTarget}
        title={
          gradeSelectedConfirmTarget === 'comments'
            ? `Apply comments to ${batchSelectedCount} selected student(s)?`
            : `Apply grade to ${batchSelectedCount} selected student(s)?`
        }
        description={
          gradeSelectedConfirmTarget === 'comments'
            ? `This applies the open student's comment draft to the checked student(s), overwriting their saved comment drafts. It will not return comments to students.`
            : `This applies the open student's scores to the checked student(s), overwriting their saved scores. It will not change comment drafts or return comments to students.`
        }
        confirmLabel={
          isGradeSelectedSaving
            ? 'Applying...'
            : gradeSelectedConfirmTarget === 'comments'
              ? 'Apply Comments to Selected Students'
              : 'Apply Grade to Selected Students'
        }
        cancelLabel="Cancel"
        isConfirmDisabled={isGradeSelectedSaving || isGradeSelectedConfirmDisabled}
        isCancelDisabled={isGradeSelectedSaving}
        onCancel={() => (isGradeSelectedSaving ? null : setGradeSelectedConfirmTarget(null))}
        onConfirm={() => {
          if (!gradeSelectedConfirmTarget) return
          void handleGradeSelected(gradeSelectedConfirmTarget)
        }}
      />

      <ConfirmDialog
        isOpen={showReturnConfirm}
        title={`Return work to ${batchSelectedCount} selected student(s)?`}
        description={`Returning will mark ${batchSelectedReturnSummary.returnableCount} existing student document(s) as returned now, even if the work was never submitted. ${batchSelectedReturnSummary.missingCount > 0 ? `${batchSelectedReturnSummary.missingCount} selected student(s) have no work yet; Pika will create returned 0/0/0 documents for them without marking them submitted. ` : ''}${batchSelectedReturnSummary.alreadyReturnedCount > 0 ? `${batchSelectedReturnSummary.alreadyReturnedCount} selected student(s) were already returned and will be skipped. ` : ''}${batchSelectedReturnSummary.blockedCount > 0 ? `${batchSelectedReturnSummary.blockedCount} selected student(s) have partial rubric drafts and must be completed or cleared before return.` : ''}`.trim()}
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
    </>
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
