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
  Circle,
  Clock,
  Pencil,
  Plus,
  RotateCcw,
  Send,
} from 'lucide-react'
import { Button, ConfirmDialog, Input, RefreshingIndicator, Tooltip } from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { Spinner } from '@/components/Spinner'
import { AssignmentModal } from '@/components/AssignmentModal'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import { AssignmentArtifactsCell } from '@/components/AssignmentArtifactsCell'
import {
  ACTIONBAR_BUTTON_CLASSNAME,
  ACTIONBAR_BUTTON_PRIMARY_CLASSNAME,
  ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME,
  PageActionBar,
  PageContent,
  PageLayout,
} from '@/components/PageLayout'
import { useRightSidebar, useMobileDrawer, useLeftSidebar, RightSidebarToggle } from '@/components/layout'
import {
  calculateAssignmentStatus,
  getAssignmentStatusIconClass,
  getAssignmentStatusLabel,
  hasDraftSavedGrade,
} from '@/lib/assignments'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import { isVisibleAtNow } from '@/lib/scheduling'
import type {
  AssignmentRepoReviewConfig,
  AssignmentRepoReviewResult,
  AssignmentRepoReviewRun,
  Classroom,
  Assignment,
  AssignmentStats,
  AssignmentStatus,
  ClassDay,
  TiptapContent,
  SelectedStudentInfo,
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

interface RepoReviewStudentRow {
  student_id: string
  student_email: string
  student_name: string | null
  github_login: string | null
  commit_emails: string[]
  status: AssignmentStatus
  doc: {
    submitted_at?: string | null
    updated_at?: string | null
    score_completion?: number | null
    score_thinking?: number | null
    score_workflow?: number | null
    graded_at?: string | null
    returned_at?: string | null
  } | null
  result: AssignmentRepoReviewResult | null
}

interface SelectedRepoReviewData {
  assignment: Assignment
  classroom: { id: string; title: string; teacher_id: string; archived_at: string | null }
  config: AssignmentRepoReviewConfig | null
  latest_run: AssignmentRepoReviewRun | null
  latest_completed_run: AssignmentRepoReviewRun | null
  summary: {
    confidence: number
    team_timeline: Array<{ date: string; weighted_contribution: number; commit_count: number }>
    contribution_total: number
    warnings: Array<{ message: string }>
  }
  students: RepoReviewStudentRow[]
}

export type AssignmentViewMode = 'summary' | 'assignment'

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
  onSelectStudent?: (student: SelectedStudentInfo | null) => void
  onViewModeChange?: (mode: AssignmentViewMode) => void
  isActive?: boolean
}

function getCookieValue(name: string) {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${encodeURIComponent(name)}=`))
  if (!match) return null
  const value = match.split('=').slice(1).join('=')
  return decodeURIComponent(value)
}

function setCookieValue(name: string, value: string) {
  if (typeof document === 'undefined') return
  const maxAgeSeconds = 60 * 60 * 24 * 365
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
}

function formatTorontoDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(' AM', ' am').replace(' PM', ' pm')
}

function formatTorontoDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
  })
}

function isScheduledAssignment(assignment: Assignment): boolean {
  return !assignment.is_draft && !!assignment.released_at && !isVisibleAtNow(assignment.released_at)
}

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer bg-info-bg border-l-2 border-l-blue-500'
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

export function TeacherClassroomView({
  classroom,
  onSelectAssignment,
  onSelectStudent,
  onViewModeChange,
  isActive = true,
}: Props) {
  const isReadOnly = !!classroom.archived_at
  const { setOpen: setSidebarOpen, width: sidebarWidth } = useRightSidebar()
  const { openRight: openMobileSidebar, close: closeMobileSidebar } = useMobileDrawer()
  const { setExpanded: setLeftSidebarExpanded } = useLeftSidebar()

  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
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
  const [selectedRepoReviewData, setSelectedRepoReviewData] = useState<SelectedRepoReviewData | null>(null)
  const [selectedAssignmentLoading, setSelectedAssignmentLoading] = useState(false)
  const [selectedAssignmentError, setSelectedAssignmentError] = useState<string>('')
  const [repoReviewSaving, setRepoReviewSaving] = useState(false)
  const [repoReviewRunning, setRepoReviewRunning] = useState(false)
  const [repoReviewApplying, setRepoReviewApplying] = useState(false)
  const [repoReviewMappings, setRepoReviewMappings] = useState<Record<string, { github_login: string; commit_emails: string }>>({})

  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: 'first' | 'last' | 'status'
    direction: SortDirection
  }>({ column: 'last', direction: 'asc' })

  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [info, setInfo] = useState('')

  // Batch grading state
  const [isAutoGrading, setIsAutoGrading] = useState(false)
  const [isArtifactRepoAnalyzing, setIsArtifactRepoAnalyzing] = useState(false)
  const [isReturning, setIsReturning] = useState(false)
  const [batchProgressCount, setBatchProgressCount] = useState(0)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const wasActiveRef = useRef(isActive)
  const showSummarySpinner = useDelayedBusy(loading && assignments.length === 0)

  // Compact table when sidebar is wide or a student is selected (sidebar opens)
  const isCompactTable = sidebarWidth === '70%' || sidebarWidth === '75%' || selectedStudentId !== null

  const loadAssignments = useCallback(async (options?: { preserveContent?: boolean }) => {
    const preserveContent = options?.preserveContent ?? false
    if (preserveContent) {
      setRefreshing(true)
    } else {
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
      setRefreshing(false)
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
    const value = getCookieValue(cookieName)
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
      setSelectedRepoReviewData(null)
      setSelectedAssignmentError('')
      setSelectedAssignmentLoading(false)
      return
    }

    const assignmentId = selection.assignmentId
    const assignmentMeta = assignments.find((item) => item.id === assignmentId)

    async function loadSelectedAssignment() {
      setSelectedAssignmentLoading(true)
      setSelectedAssignmentError('')
      try {
        const response = await fetch(
          assignmentMeta?.evaluation_mode === 'repo_review'
            ? `/api/teacher/assignments/${assignmentId}/repo-review`
            : `/api/teacher/assignments/${assignmentId}`
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load assignment')
        }

        if (assignmentMeta?.evaluation_mode === 'repo_review') {
          setSelectedRepoReviewData(data as SelectedRepoReviewData)
          setSelectedAssignmentData(null)
        } else {
          setSelectedAssignmentData({
            assignment: data.assignment,
            students: (data.students || []) as StudentSubmissionRow[],
          })
          setSelectedRepoReviewData(null)
        }
      } catch (err: any) {
        setSelectedAssignmentError(err.message || 'Failed to load assignment')
        setSelectedAssignmentData(null)
        setSelectedRepoReviewData(null)
      } finally {
        setSelectedAssignmentLoading(false)
      }
    }

    loadSelectedAssignment()
  }, [assignments, refreshCounter, selection])

  // Notify parent about selected assignment for sidebar
  useEffect(() => {
    if (selection.mode === 'summary') {
      onSelectAssignment?.(null)
    } else if (selectedAssignmentData) {
      const { assignment } = selectedAssignmentData
      onSelectAssignment?.({
        title: assignment.title,
        instructions: assignment.rich_instructions || assignment.description,
      })
    } else if (selectedRepoReviewData) {
      onSelectAssignment?.(null)
    }
  }, [selection.mode, selectedAssignmentData, selectedRepoReviewData, onSelectAssignment])

  useEffect(() => {
    if (!selectedRepoReviewData) {
      setRepoReviewMappings({})
      return
    }

    setRepoReviewMappings(
      Object.fromEntries(
        selectedRepoReviewData.students.map((student) => [
          student.student_id,
          {
            github_login: student.github_login || '',
            commit_emails: student.commit_emails.join(', '),
          },
        ])
      )
    )
  }, [selectedRepoReviewData])

  // Notify parent of view mode changes
  useEffect(() => {
    onViewModeChange?.(selection.mode)
  }, [selection.mode, onViewModeChange])

  // Keep inspector closed for assignment list view (work now lives in-table).
  useEffect(() => {
    if (selection.mode !== 'assignment' || selectedStudentId) return
    if (window.innerWidth < DESKTOP_BREAKPOINT) {
      closeMobileSidebar()
    } else {
      setSidebarOpen(false)
    }
  }, [selection.mode, selectedStudentId, closeMobileSidebar, setSidebarOpen])

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
    setCookieValue(cookieName, cookieValue)
    setSelection(next)
    setIsSelectorOpen(false)
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

  const sortedRepoReviewStudents = useMemo(() => {
    if (!selectedRepoReviewData) return []
    const rows = [...selectedRepoReviewData.students]
    if (sortColumn === 'status') {
      rows.sort((a, b) => {
        const scoreA = a.result?.relative_contribution_share ?? 0
        const scoreB = b.result?.relative_contribution_share ?? 0
        const cmp = scoreB - scoreA
        if (cmp !== 0) return applyDirection(cmp, sortDirection)
        return (a.student_name || a.student_email).localeCompare(b.student_name || b.student_email)
      })
      return rows
    }

    const nameColumn = sortColumn === 'first' ? 'first_name' as const : 'last_name' as const
    rows.sort((a, b) =>
      compareByNameFields(
        {
          firstName: a.student_name?.split(' ')[0] || null,
          lastName: a.student_name?.split(' ').slice(1).join(' ') || null,
          id: a.student_email,
        },
        {
          firstName: b.student_name?.split(' ')[0] || null,
          lastName: b.student_name?.split(' ').slice(1).join(' ') || null,
          id: b.student_email,
        },
        nameColumn,
        sortDirection
      )
    )
    return rows
  }, [selectedRepoReviewData, sortColumn, sortDirection])

  const isRepoReviewSelection = !!selectedRepoReviewData
  const currentStudentRows = isRepoReviewSelection ? sortedRepoReviewStudents : sortedStudents

  const studentRowIds = useMemo(() => currentStudentRows.map((s) => s.student_id), [currentStudentRows])
  const dueAtMs = useMemo(() => selectedAssignmentData ? new Date(selectedAssignmentData.assignment.due_at).getTime() : 0, [selectedAssignmentData])
  const {
    selectedIds: batchSelectedIds,
    toggleSelect: batchToggleSelect,
    toggleSelectAll: batchToggleSelectAll,
    allSelected: batchAllSelected,
    clearSelection: batchClearSelection,
    selectedCount: batchSelectedCount,
  } = useStudentSelection(studentRowIds)
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

  // Auto-dismiss warning after 3 seconds, or immediately when students are selected
  useEffect(() => {
    if (!warning) return
    if (batchSelectedCount > 0) {
      setWarning('')
      return
    }
    const timer = setTimeout(() => setWarning(''), 3000)
    return () => clearTimeout(timer)
  }, [warning, batchSelectedCount])
  useEffect(() => {
    if (!info) return
    const timer = setTimeout(() => setInfo(''), 4000)
    return () => clearTimeout(timer)
  }, [info])

  async function handleBatchAutoGrade() {
    if (!selectedAssignmentData || batchSelectedCount === 0) return
    setBatchProgressCount(batchSelectedCount)
    setIsAutoGrading(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedAssignmentData.assignment.id}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Auto-grade failed')
      const total = (data.graded_count ?? 0) + (data.skipped_count ?? 0)
      if (data.graded_count === 0) {
        setError('No gradable content found — submissions may be empty')
      } else if (data.skipped_count > 0) {
        setError(`Graded ${data.graded_count} of ${total} — ${data.skipped_count} skipped (empty content)`)
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
      const skippedCount = Number(data.skipped_count ?? 0)
      setInfo(`Returned ${returnedCount} graded work item(s)${skippedCount > 0 ? ` • ${skippedCount} ungraded skipped` : ''}`)
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

  const handleGoPrevStudent = useCallback(() => {
    if (selectedStudentIndex <= 0) return
    setSelectedStudentId(currentStudentRows[selectedStudentIndex - 1].student_id)
  }, [currentStudentRows, selectedStudentIndex])

  const handleGoNextStudent = useCallback(() => {
    if (selectedStudentIndex === -1 || selectedStudentIndex >= currentStudentRows.length - 1) return
    setSelectedStudentId(currentStudentRows[selectedStudentIndex + 1].student_id)
  }, [currentStudentRows, selectedStudentIndex])

  // Notify parent when student selection changes
  useEffect(() => {
    const activeAssignment = selectedAssignmentData?.assignment || selectedRepoReviewData?.assignment || null
    if (selectedStudentId && selection.mode === 'assignment' && activeAssignment?.id) {
      onSelectStudent?.({
        assignmentId: activeAssignment.id,
        assignmentTitle: activeAssignment.title,
        studentId: selectedStudentId,
        canGoPrev: canGoPrevStudent,
        canGoNext: canGoNextStudent,
        onGoPrev: handleGoPrevStudent,
        onGoNext: handleGoNextStudent,
      })
    } else {
      onSelectStudent?.(null)
    }
  }, [selectedAssignmentData?.assignment, selectedRepoReviewData?.assignment, selectedStudentId, selection.mode, canGoPrevStudent, canGoNextStudent, handleGoPrevStudent, handleGoNextStudent, onSelectStudent])

  // Auto-open right sidebar and collapse left sidebar when student is selected
  const prevSelectedStudentIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Only act when transitioning from no selection to a selection
    if (selectedStudentId && !prevSelectedStudentIdRef.current) {
      if (window.innerWidth < DESKTOP_BREAKPOINT) {
        openMobileSidebar()
      } else {
        setSidebarOpen(true)
        // Collapse left sidebar to make room for the right sidebar content
        setLeftSidebarExpanded(false)
      }
    }
    prevSelectedStudentIdRef.current = selectedStudentId
  }, [selectedStudentId, setSidebarOpen, openMobileSidebar, setLeftSidebarExpanded])

  // Escape key to deselect student
  useEffect(() => {
    if (!selectedStudentId) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectedStudentId(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedStudentId])

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

  // Click outside student table to deselect, but not when clicking
  // the right sidebar (aside) or mobile drawer (fixed overlay).
  useEffect(() => {
    if (!selectedStudentId) return

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (tableContainerRef.current?.contains(target)) return
      if (target.closest('aside') || target.closest('[role="dialog"]')) return
      setSelectedStudentId(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [selectedStudentId])

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
    selection.mode === 'assignment' && (!!selectedAssignmentData || !!selectedRepoReviewData) && !selectedAssignmentLoading && !isReadOnly

  async function handleRunRepoReview() {
    if (!selectedRepoReviewData) return
    setRepoReviewRunning(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedRepoReviewData.assignment.id}/repo-review/run`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to run repo review')
      setInfo(`Analyzed ${data.analyzed_students ?? 0} student(s)`)
      setRefreshCounter((count) => count + 1)
    } catch (err: any) {
      setError(err.message || 'Failed to run repo review')
    } finally {
      setRepoReviewRunning(false)
    }
  }

  async function handleApplyRepoReview() {
    if (!selectedRepoReviewData) return
    setRepoReviewApplying(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedRepoReviewData.assignment.id}/repo-review/apply`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to apply repo review drafts')
      setInfo(`Applied draft grades for ${data.applied_count ?? 0} student(s)`)
      setRefreshCounter((count) => count + 1)
    } catch (err: any) {
      setError(err.message || 'Failed to apply repo review drafts')
    } finally {
      setRepoReviewApplying(false)
    }
  }

  function updateRepoReviewMapping(studentId: string, field: 'github_login' | 'commit_emails', value: string) {
    setRepoReviewMappings((prev) => ({
      ...prev,
      [studentId]: {
        github_login: prev[studentId]?.github_login || '',
        commit_emails: prev[studentId]?.commit_emails || '',
        [field]: value,
      },
    }))
  }

  async function handleSaveRepoReviewMappings() {
    if (!selectedRepoReviewData?.config) return
    setRepoReviewSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedRepoReviewData.assignment.id}/repo-review/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          repo_url: `${selectedRepoReviewData.config.repo_owner}/${selectedRepoReviewData.config.repo_name}`,
          default_branch: selectedRepoReviewData.config.default_branch,
          review_start_at: selectedRepoReviewData.config.review_start_at,
          review_end_at: selectedRepoReviewData.config.review_end_at,
          include_pr_reviews: selectedRepoReviewData.config.include_pr_reviews,
          student_mappings: selectedRepoReviewData.students.map((student) => ({
            student_id: student.student_id,
            github_login: repoReviewMappings[student.student_id]?.github_login?.trim() || null,
            commit_emails: (repoReviewMappings[student.student_id]?.commit_emails || '')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save GitHub mappings')
      setInfo('Saved repo review mappings')
      setRefreshCounter((count) => count + 1)
    } catch (err: any) {
      setError(err.message || 'Failed to save GitHub mappings')
    } finally {
      setRepoReviewSaving(false)
    }
  }

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
    ) : selectedRepoReviewData ? (
      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          className={`${ACTIONBAR_BUTTON_CLASSNAME} flex items-center gap-1`}
          onClick={() => {
            setEditAssignment(selectedRepoReviewData.assignment)
          }}
          disabled={!canEditAssignment}
          aria-label="Edit assignment"
        >
          <Pencil className="h-5 w-5" aria-hidden="true" />
          <span>Edit</span>
        </button>
        <button
          type="button"
          className={`${ACTIONBAR_BUTTON_CLASSNAME} flex items-center gap-1`}
          onClick={() => {
            void handleRunRepoReview()
          }}
          disabled={repoReviewRunning || isReadOnly}
          aria-label="Analyze repo"
        >
          <BarChart3 className="h-5 w-5" aria-hidden="true" />
          <span>{repoReviewRunning ? 'Analyzing...' : 'Analyze'}</span>
        </button>
        <button
          type="button"
          className={`${ACTIONBAR_BUTTON_CLASSNAME} flex items-center gap-1`}
          onClick={() => {
            void handleApplyRepoReview()
          }}
          disabled={repoReviewApplying || isReadOnly || !selectedRepoReviewData.latest_completed_run}
          aria-label="Apply draft grades"
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          <span>{repoReviewApplying ? 'Applying...' : 'Apply Drafts'}</span>
        </button>
        <Tooltip content={batchSelectedCount > 0 ? `Return (${batchSelectedCount})` : 'Select students to return'}>
          <button
            type="button"
            className={`${ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME} ${batchSelectedCount === 0 ? 'opacity-50' : ''}`}
            onClick={() => {
              if (batchSelectedCount === 0) {
                setWarning('Select students to return')
                return
              }
              setShowReturnConfirm(true)
            }}
            disabled={isReturning || isReadOnly}
            aria-label={batchSelectedCount > 0 ? `Return to ${batchSelectedCount} students` : 'Select students to return'}
          >
            <Send className={`h-5 w-5 ${batchSelectedCount > 0 ? 'text-blue-500' : ''}`} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    ) : (
      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          className={`${ACTIONBAR_BUTTON_CLASSNAME} flex items-center gap-1`}
          onClick={() => {
            if (selectedAssignmentData) {
              setEditAssignment(selectedAssignmentData.assignment)
            }
          }}
          disabled={!canEditAssignment}
          aria-label="Edit assignment"
        >
          <Pencil className="h-5 w-5" aria-hidden="true" />
          <span>Edit</span>
        </button>
        {selectedAssignmentData && (
          <>
            <Tooltip content={batchSelectedCount > 0 ? `Analyze repo (${batchSelectedCount})` : 'Select students to analyze repos'}>
              <button
                type="button"
                className={`${ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME} ${batchSelectedCount === 0 ? 'opacity-50' : ''}`}
                onClick={() => {
                  if (batchSelectedCount === 0) {
                    setWarning('Select students to analyze repos')
                    return
                  }
                  void handleBatchArtifactRepoAnalyze()
                }}
                disabled={isArtifactRepoAnalyzing || isReadOnly}
                aria-label={batchSelectedCount > 0 ? `Analyze repos for ${batchSelectedCount} students` : 'Select students to analyze repos'}
              >
                <BarChart3 className={`h-5 w-5 ${batchSelectedCount > 0 ? 'text-primary' : ''}`} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content={batchSelectedCount > 0 ? `AI grade (${batchSelectedCount})` : 'Select students to grade'}>
              <button
                type="button"
                className={`${ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME} ${batchSelectedCount === 0 ? 'opacity-50' : ''}`}
                onClick={() => {
                  if (batchSelectedCount === 0) {
                    setWarning('Select students to grade')
                    return
                  }
                  handleBatchAutoGrade()
                }}
                disabled={isAutoGrading || isReadOnly}
                aria-label={batchSelectedCount > 0 ? `AI grade ${batchSelectedCount} students` : 'Select students to grade'}
              >
                <Check className={`h-5 w-5 ${batchSelectedCount > 0 ? 'text-purple-500' : ''}`} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content={batchSelectedCount > 0 ? `Return (${batchSelectedCount})` : 'Select students to return'}>
              <button
                type="button"
                className={`${ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME} ${batchSelectedCount === 0 ? 'opacity-50' : ''}`}
                onClick={() => {
                  if (batchSelectedCount === 0) {
                    setWarning('Select students to return')
                    return
                  }
                  setShowReturnConfirm(true)
                }}
                disabled={isReturning || isReadOnly}
                aria-label={batchSelectedCount > 0 ? `Return to ${batchSelectedCount} students` : 'Select students to return'}
              >
                <Send className={`h-5 w-5 ${batchSelectedCount > 0 ? 'text-blue-500' : ''}`} aria-hidden="true" />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    )

  // Keep the panel toggle only in summary mode (markdown view).
  // Assignment mode now shows work artifacts in-table instead of instructions.
  const showMobileToggle = selection.mode === 'summary'

  return (
    <PageLayout>
      <PageActionBar primary={primaryButtons} actions={[]} trailing={showMobileToggle ? <RightSidebarToggle /> : undefined} />

      <PageContent className="space-y-3">
        {refreshing && (
          <RefreshingIndicator className="px-0 py-0" />
        )}
        {error && (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {warning && (
          <div className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            {warning}
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
            <div className="text-center py-6 text-sm text-text-muted">
              No assignments yet
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={assignments.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {assignments.map((assignment) => (
                    <SortableAssignmentCard
                      key={assignment.id}
                      assignment={assignment}
                      isReadOnly={isReadOnly}
                      isDragDisabled={isReordering}
                      onSelect={() => {
                        // Draft/scheduled assignments open edit modal instead of detail view
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
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      ) : isRepoReviewSelection ? (
        <KeyboardNavigableTable
          ref={tableContainerRef}
          rowKeys={currentStudentRows.map((s) => s.student_id)}
          selectedKey={selectedStudentId}
          onSelectKey={setSelectedStudentId}
        >
          <div className="space-y-3">
            {selectedAssignmentLoading ? (
              <TableCard>
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              </TableCard>
            ) : selectedAssignmentError || !selectedRepoReviewData ? (
              <TableCard>
                <div className="p-4 text-sm text-danger">
                  {selectedAssignmentError || 'Failed to load repo review'}
                </div>
              </TableCard>
            ) : (
              <>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-text-muted">Repo Review</div>
                        <div className="mt-1 text-lg font-semibold text-text-default">
                          {selectedRepoReviewData.config
                            ? `${selectedRepoReviewData.config.repo_owner}/${selectedRepoReviewData.config.repo_name}`
                            : 'Repo not configured'}
                        </div>
                        <div className="mt-1 text-sm text-text-muted">
                          Branch {selectedRepoReviewData.config?.default_branch || 'main'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="rounded-full border border-border bg-surface-2 px-3 py-1 text-sm font-medium text-text-default">
                          Confidence {Math.round((selectedRepoReviewData.summary.confidence || 0) * 100)}%
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void handleSaveRepoReviewMappings()
                          }}
                          disabled={repoReviewSaving || !selectedRepoReviewData.config}
                        >
                          {repoReviewSaving ? 'Saving...' : 'Save mappings'}
                        </Button>
                      </div>
                    </div>
                    {selectedRepoReviewData.latest_run?.warnings_json?.length ? (
                      <div className="mt-3 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                        {selectedRepoReviewData.latest_run.warnings_json.map((warning) => warning.message).join(' ')}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-border bg-surface p-4">
                    <div className="text-xs uppercase tracking-wide text-text-muted">Team Timeline</div>
                    <div className="mt-3 flex items-end gap-1">
                      {selectedRepoReviewData.summary.team_timeline.length ? (
                        selectedRepoReviewData.summary.team_timeline.map((point) => (
                          <Tooltip
                            key={point.date}
                            content={`${point.date}: ${point.commit_count} commit${point.commit_count === 1 ? '' : 's'}`}
                          >
                            <div
                              className="flex-1 rounded-t bg-primary/80"
                              style={{ height: `${Math.max(12, Math.round(point.weighted_contribution * 24))}px` }}
                            />
                          </Tooltip>
                        ))
                      ) : (
                        <div className="text-sm text-text-muted">Run analysis to populate workflow activity.</div>
                      )}
                    </div>
                  </div>
                </div>

                <TableCard>
                  <DataTable density={isCompactTable ? 'tight' : 'compact'}>
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
                          label={isCompactTable ? 'First' : 'First Name'}
                          isActive={sortColumn === 'first'}
                          direction={sortDirection}
                          onClick={() => toggleSort('first')}
                          className={isCompactTable ? 'w-[5.5rem]' : 'w-[8rem]'}
                        />
                        <SortableHeaderCell
                          label={isCompactTable ? 'L.' : 'Last Name'}
                          isActive={sortColumn === 'last'}
                          direction={sortDirection}
                          onClick={() => toggleSort('last')}
                          className={isCompactTable ? 'w-[4.5rem]' : 'w-[8rem]'}
                        />
                        <DataTableHeaderCell className="w-[14rem]">GitHub Mapping</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[8rem]">Contribution</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[8rem]">Consistency</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[8rem]">Iteration</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[4.75rem]">Grade</DataTableHeaderCell>
                      </DataTableRow>
                    </DataTableHead>
                    <DataTableBody>
                      {sortedRepoReviewStudents.map((student) => {
                        const isSelected = selectedStudentId === student.student_id
                        const totalScore =
                          student.doc?.score_completion != null &&
                          student.doc?.score_thinking != null &&
                          student.doc?.score_workflow != null
                            ? student.doc.score_completion + student.doc.score_thinking + student.doc.score_workflow
                            : null
                        const [firstName, ...lastNameParts] = (student.student_name || '').split(' ')
                        return (
                          <DataTableRow
                            key={student.student_id}
                            className={getRowClassName(isSelected)}
                            onClick={() => setSelectedStudentId(isSelected ? null : student.student_id)}
                          >
                            <DataTableCell>
                              <input
                                type="checkbox"
                                checked={batchSelectedIds.has(student.student_id)}
                                onChange={() => batchToggleSelect(student.student_id)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                aria-label={`Select ${student.student_name || student.student_email}`}
                              />
                            </DataTableCell>
                            <DataTableCell>{firstName || '—'}</DataTableCell>
                            <DataTableCell>{lastNameParts.join(' ') || '—'}</DataTableCell>
                            <DataTableCell className="align-top">
                              <div className="space-y-2">
                                <Input
                                  value={repoReviewMappings[student.student_id]?.github_login || ''}
                                  onChange={(event) => updateRepoReviewMapping(student.student_id, 'github_login', event.target.value)}
                                  placeholder="github login"
                                  onClick={(event) => event.stopPropagation()}
                                />
                                <Input
                                  value={repoReviewMappings[student.student_id]?.commit_emails || ''}
                                  onChange={(event) => updateRepoReviewMapping(student.student_id, 'commit_emails', event.target.value)}
                                  placeholder="commit emails (comma separated)"
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </div>
                            </DataTableCell>
                            <DataTableCell>
                              <div className="space-y-1">
                                <MetricBar value={student.result?.relative_contribution_share || 0} />
                                <div className="text-xs text-text-muted">
                                  {Math.round((student.result?.relative_contribution_share || 0) * 100)}%
                                </div>
                              </div>
                            </DataTableCell>
                            <DataTableCell>
                              <div className="space-y-1">
                                <MetricBar value={student.result?.spread_score || 0} />
                                <div className="text-xs text-text-muted">
                                  {Math.round((student.result?.spread_score || 0) * 100)}%
                                </div>
                              </div>
                            </DataTableCell>
                            <DataTableCell>
                              <div className="space-y-1">
                                <MetricBar value={student.result?.iteration_score || 0} />
                                <div className="text-xs text-text-muted">
                                  {Math.round((student.result?.iteration_score || 0) * 100)}%
                                </div>
                              </div>
                            </DataTableCell>
                            <DataTableCell className="whitespace-nowrap text-text-muted">
                              {totalScore !== null ? `${Math.round((totalScore / 30) * 100)}%` : '—'}
                            </DataTableCell>
                          </DataTableRow>
                        )
                      })}
                      {sortedRepoReviewStudents.length === 0 && (
                        <EmptyStateRow colSpan={8} message="No students enrolled" />
                      )}
                    </DataTableBody>
                  </DataTable>
                </TableCard>
              </>
            )}
          </div>
        </KeyboardNavigableTable>
      ) : (
        <KeyboardNavigableTable
          ref={tableContainerRef}
          rowKeys={currentStudentRows.map((s) => s.student_id)}
          selectedKey={selectedStudentId}
          onSelectKey={setSelectedStudentId}
        >
          <TableCard>
            {selectedAssignmentLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : selectedAssignmentError || !selectedAssignmentData ? (
              <div className="p-4 text-sm text-danger">
                {selectedAssignmentError || 'Failed to load assignment'}
              </div>
            ) : (
              <div className="relative">
              {(isAutoGrading || isArtifactRepoAnalyzing || isReturning) && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-surface/70">
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Spinner />
                    <span>
                      {isAutoGrading
                        ? `Grading ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
                        : isArtifactRepoAnalyzing
                          ? `Analyzing repos for ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`
                          : `Returning to ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`}
                    </span>
                  </div>
                </div>
              )}
              <DataTable density={isCompactTable ? 'tight' : 'compact'}>
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
                      label={isCompactTable ? 'First' : 'First Name'}
                      isActive={sortColumn === 'first'}
                      direction={sortDirection}
                      onClick={() => toggleSort('first')}
                      className={isCompactTable ? 'w-[5.5rem]' : 'w-[8rem]'}
                    />
                    <SortableHeaderCell
                      label={isCompactTable ? 'L.' : 'Last Name'}
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onClick={() => toggleSort('last')}
                      className={isCompactTable ? 'w-[4.5rem]' : 'w-[8rem]'}
                    />
                    <SortableHeaderCell
                      label={isCompactTable ? '' : 'Status'}
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onClick={() => toggleSort('status')}
                      className="w-[5.75rem]"
                    />
                    <DataTableHeaderCell className="w-[4.75rem]">Grade</DataTableHeaderCell>
                    {!isCompactTable && <DataTableHeaderCell className="w-[5.5rem]">Updated</DataTableHeaderCell>}
                    <DataTableHeaderCell className={isCompactTable ? 'w-[6.5rem]' : 'w-[38%] min-w-[24rem]'}>
                      {isCompactTable ? 'Work' : 'Artifacts'}
                    </DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {sortedStudents.map((student) => {
                    const isSelected = selectedStudentId === student.student_id
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
                    const wasLate = !!(student.doc?.submitted_at && dueAtMs && new Date(student.doc.submitted_at).getTime() > dueAtMs)
                    return (
                    <DataTableRow
                      key={student.student_id}
                      className={getRowClassName(isSelected)}
                      onClick={() => setSelectedStudentId(isSelected ? null : student.student_id)}
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
                      <DataTableCell className={isCompactTable ? 'w-[5.5rem] max-w-[5.5rem] truncate' : 'w-[8rem] max-w-[8rem] truncate'}>
                        {student.student_first_name ? (
                          <Tooltip content={`${student.student_first_name} ${student.student_last_name ?? ''}`}>
                            <span>{student.student_first_name}</span>
                          </Tooltip>
                        ) : '—'}
                      </DataTableCell>
                      <DataTableCell className={isCompactTable ? 'w-[4.5rem] max-w-[4.5rem] truncate' : 'w-[8rem] max-w-[8rem] truncate'}>
                        {student.student_last_name ? (
                          isCompactTable ? (
                            <Tooltip content={student.student_last_name}>
                              <span>{student.student_last_name[0]}.</span>
                            </Tooltip>
                          ) : (
                            <Tooltip content={student.student_last_name}>
                              <span>{student.student_last_name}</span>
                            </Tooltip>
                          )
                        ) : '—'}
                      </DataTableCell>
                      <DataTableCell className="w-[5.75rem]">
                        <Tooltip content={getAssignmentStatusLabel(student.status)}>
                          <span className="inline-flex" role="img" aria-label={getAssignmentStatusLabel(student.status)}>
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
                      {!isCompactTable && (
                        <DataTableCell className="w-[5.5rem] whitespace-nowrap text-text-muted">
                          {student.student_updated_at ? (
                            <Tooltip content={formatTorontoDateTime(student.student_updated_at)}>
                              <span>{formatTorontoDateShort(student.student_updated_at)}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                      )}
                      <DataTableCell className={isCompactTable ? 'w-[6.5rem]' : 'w-[38%] min-w-[24rem] align-top'}>
                        <AssignmentArtifactsCell
                          artifacts={student.artifacts || []}
                          isCompact={isCompactTable}
                        />
                      </DataTableCell>
                    </DataTableRow>
                    )
                  })}
                  {sortedStudents.length === 0 && (
                    <EmptyStateRow colSpan={isCompactTable ? 6 : 7} message="No students enrolled" />
                  )}
                </DataTableBody>
              </DataTable>
              </div>
            )}
          </TableCard>
        </KeyboardNavigableTable>
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
        description={`Eligible to return now: ${batchSelectedGradedCount} ready (graded or draft-scored)${batchSelectedUngradedCount > 0 ? ` • ${batchSelectedUngradedCount} incomplete will be skipped` : ''}`}
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
          Some assignments have rich formatting that will be lost when editing as plain text.
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
