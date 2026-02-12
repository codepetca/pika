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
  Check,
  Circle,
  Clock,
  Pencil,
  Plus,
  RotateCcw,
  Send,
} from 'lucide-react'
import { ConfirmDialog, Tooltip } from '@/ui'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { Spinner } from '@/components/Spinner'
import { AssignmentModal } from '@/components/AssignmentModal'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
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
  getAssignmentStatusIconClass,
  getAssignmentStatusLabel,
} from '@/lib/assignments'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import type { Classroom, Assignment, AssignmentStats, AssignmentStatus, ClassDay, TiptapContent, SelectedStudentInfo } from '@/types'
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
} from '@/lib/events'
import { applyDirection, compareByNameFields, toggleSort as toggleSortState } from '@/lib/table-sort'
import type { SortDirection } from '@/lib/table-sort'

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
  doc: {
    submitted_at?: string | null
    updated_at?: string | null
    score_completion?: number | null
    score_thinking?: number | null
    score_workflow?: number | null
    graded_at?: string | null
    returned_at?: string | null
  } | null
}

export type AssignmentViewMode = 'summary' | 'assignment'

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
  onSelectStudent?: (student: SelectedStudentInfo | null) => void
  onViewModeChange?: (mode: AssignmentViewMode) => void
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

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer bg-info-bg border-l-2 border-l-blue-500'
  }
  return 'cursor-pointer hover:bg-surface-hover'
}

const STATUS_ICON_CLASS = 'h-4 w-4'
const LATE_CLOCK_CLASS = 'h-3 w-3'

function StatusIcon({ status, wasLate }: { status: AssignmentStatus; wasLate?: boolean }) {
  const colorClass = getAssignmentStatusIconClass(status)
  const cls = `${STATUS_ICON_CLASS} ${colorClass}`

  // Determine if this status should show the late clock indicator.
  // "late" statuses always show it; downstream statuses show it when wasLate is true.
  const showLate =
    status === 'in_progress_late' ||
    status === 'submitted_late' ||
    ((status === 'graded' || status === 'returned' || status === 'resubmitted') && wasLate)

  // Pick the base icon for each status
  let icon: React.ReactElement
  switch (status) {
    case 'not_started':
    case 'in_progress':
    case 'in_progress_late':
      icon = <Circle className={cls} />
      break
    case 'submitted_on_time':
    case 'submitted_late':
    case 'graded':
      icon = <Check className={cls} />
      break
    case 'returned':
      icon = <Send className={cls} />
      break
    case 'resubmitted':
      icon = <RotateCcw className={cls} />
      break
    default:
      icon = <Circle className={cls} />
  }

  if (showLate) {
    return <span className={`inline-flex items-center gap-0.5 ${colorClass}`}>{icon}<Clock className={LATE_CLOCK_CLASS} /></span>
  }
  return icon
}

export function TeacherClassroomView({ classroom, onSelectAssignment, onSelectStudent, onViewModeChange }: Props) {
  const isReadOnly = !!classroom.archived_at
  const { setOpen: setSidebarOpen, width: sidebarWidth } = useRightSidebar()
  const { openRight: openMobileSidebar } = useMobileDrawer()
  const { setExpanded: setLeftSidebarExpanded } = useLeftSidebar()

  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [loading, setLoading] = useState(true)
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
  const [selectedAssignmentLoading, setSelectedAssignmentLoading] = useState(false)
  const [selectedAssignmentError, setSelectedAssignmentError] = useState<string>('')

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

  // Batch grading state
  const [isAutoGrading, setIsAutoGrading] = useState(false)
  const [isReturning, setIsReturning] = useState(false)
  const [batchProgressCount, setBatchProgressCount] = useState(0)
  const [showReturnConfirm, setShowReturnConfirm] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Compact table when sidebar is wide or a student is selected (sidebar opens)
  const isCompactTable = sidebarWidth === '70%' || sidebarWidth === '75%' || selectedStudentId !== null

  const loadAssignments = useCallback(async () => {
    setLoading(true)
    try {
      const [assignmentsRes, classDaysRes] = await Promise.all([
        fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`),
        fetch(`/api/classrooms/${classroom.id}/class-days`),
      ])
      const assignmentsData = await assignmentsRes.json()
      const classDaysData = await classDaysRes.json().catch(() => ({ class_days: [] }))
      setAssignments(assignmentsData.assignments || [])
      setClassDays(classDaysData.class_days || [])
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
    // Draft assignments should open edit modal instead of detail view
    if (assignment.is_draft) {
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
      // Draft assignments should open edit modal instead of detail view
      if (assignment.is_draft) {
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
      } catch (err: any) {
        setSelectedAssignmentError(err.message || 'Failed to load assignment')
        setSelectedAssignmentData(null)
      } finally {
        setSelectedAssignmentLoading(false)
      }
    }

    loadSelectedAssignment()
  }, [selection, refreshCounter])

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
    }
  }, [selection.mode, selectedAssignmentData, onSelectAssignment])

  // Notify parent of view mode changes
  useEffect(() => {
    onViewModeChange?.(selection.mode)
  }, [selection.mode, onViewModeChange])

  // Auto-open sidebar when assignment is selected (separate effect)
  const prevSelectionModeRef = useRef<'summary' | 'assignment'>('summary')
  useEffect(() => {
    // Only open sidebar when transitioning from summary to assignment view
    if (selection.mode === 'assignment' && prevSelectionModeRef.current === 'summary' && selectedAssignmentData) {
      if (window.innerWidth < DESKTOP_BREAKPOINT) {
        openMobileSidebar()
      } else {
        setSidebarOpen(true)
      }
    }
    prevSelectionModeRef.current = selection.mode
  }, [selection.mode, selectedAssignmentData, setSidebarOpen, openMobileSidebar])

  function handleCreateSuccess(created: Assignment) {
    // Optimistically add the new assignment to the list
    setAssignments((prev) => [...prev, { ...created, stats: { total_students: 0, submitted: 0, late: 0 } }])
    // Reload to get accurate stats from server
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

  const studentRowIds = useMemo(() => sortedStudents.map((s) => s.student_id), [sortedStudents])
  const dueAtMs = useMemo(() => selectedAssignmentData ? new Date(selectedAssignmentData.assignment.due_at).getTime() : 0, [selectedAssignmentData])
  const {
    selectedIds: batchSelectedIds,
    toggleSelect: batchToggleSelect,
    toggleSelectAll: batchToggleSelectAll,
    allSelected: batchAllSelected,
    clearSelection: batchClearSelection,
    selectedCount: batchSelectedCount,
  } = useStudentSelection(studentRowIds)

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

  async function handleBatchReturn() {
    if (!selectedAssignmentData || batchSelectedCount === 0) return
    setBatchProgressCount(batchSelectedCount)
    setIsReturning(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/assignments/${selectedAssignmentData.assignment.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: Array.from(batchSelectedIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Return failed')
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
    return sortedStudents.findIndex((student) => student.student_id === selectedStudentId)
  }, [sortedStudents, selectedStudentId])

  const canGoPrevStudent = selectedStudentIndex > 0
  const canGoNextStudent = selectedStudentIndex !== -1 && selectedStudentIndex < sortedStudents.length - 1

  const handleGoPrevStudent = useCallback(() => {
    if (selectedStudentIndex <= 0) return
    setSelectedStudentId(sortedStudents[selectedStudentIndex - 1].student_id)
  }, [selectedStudentIndex, sortedStudents])

  const handleGoNextStudent = useCallback(() => {
    if (selectedStudentIndex === -1 || selectedStudentIndex >= sortedStudents.length - 1) return
    setSelectedStudentId(sortedStudents[selectedStudentIndex + 1].student_id)
  }, [selectedStudentIndex, sortedStudents])

  // Notify parent when student selection changes
  useEffect(() => {
    if (selectedStudentId && selection.mode === 'assignment' && selectedAssignmentData?.assignment?.id) {
      onSelectStudent?.({
        assignmentId: selectedAssignmentData.assignment.id,
        assignmentTitle: selectedAssignmentData.assignment.title,
        studentId: selectedStudentId,
        canGoPrev: canGoPrevStudent,
        canGoNext: canGoNextStudent,
        onGoPrev: handleGoPrevStudent,
        onGoNext: handleGoNextStudent,
      })
    } else {
      onSelectStudent?.(null)
    }
  }, [selectedStudentId, selection.mode, selectedAssignmentData?.assignment?.id, selectedAssignmentData?.assignment?.title, canGoPrevStudent, canGoNextStudent, handleGoPrevStudent, handleGoNextStudent, onSelectStudent])

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

  // Refresh table when a grade is saved in the sidebar
  useEffect(() => {
    function onGradeUpdated() {
      setRefreshCounter((c) => c + 1)
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
    selection.mode === 'assignment' && !!selectedAssignmentData && !selectedAssignmentLoading && !isReadOnly

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

  // Show mobile toggle only when viewing an assignment (not a student)
  // Summary mode: no toggle (mobile has no way to open panel)
  // Assignment selected (no student): toggle visible (mobile can open instructions)
  // Student selected: no toggle (panel auto-opens)
  const showMobileToggle = selection.mode === 'assignment' && selectedStudentId === null

  return (
    <PageLayout>
      <PageActionBar primary={primaryButtons} actions={[]} trailing={showMobileToggle ? <RightSidebarToggle /> : undefined} />

      <PageContent className="space-y-4">
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

        {selection.mode === 'summary' ? (
        <div>
          {loading ? (
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
                        // Draft assignments open edit modal instead of detail view
                        if (assignment.is_draft) {
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
      ) : (
        <KeyboardNavigableTable
          ref={tableContainerRef}
          rowKeys={sortedStudents.map((s) => s.student_id)}
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
              {(isAutoGrading || isReturning) && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-surface/70">
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Spinner />
                    <span>{isAutoGrading ? `Grading ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…` : `Returning to ${batchProgressCount} student${batchProgressCount === 1 ? '' : 's'}…`}</span>
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
                    />
                    <SortableHeaderCell
                      label={isCompactTable ? 'L.' : 'Last Name'}
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onClick={() => toggleSort('last')}
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
                      <DataTableCell className={isCompactTable ? 'max-w-[80px] truncate' : 'max-w-[120px] truncate'}>
                        {student.student_first_name ? (
                          <Tooltip content={`${student.student_first_name} ${student.student_last_name ?? ''}`}>
                            <span>{student.student_first_name}</span>
                          </Tooltip>
                        ) : '—'}
                      </DataTableCell>
                      <DataTableCell className={isCompactTable ? 'w-8' : 'max-w-[120px] truncate'}>
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
                    </DataTableRow>
                    )
                  })}
                  {sortedStudents.length === 0 && (
                    <EmptyStateRow colSpan={isCompactTable ? 5 : 6} message="No students enrolled" />
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
        onSuccess={(assignment) => {
          if (editAssignment) {
            handleEditSuccess(assignment)
          } else {
            handleCreateSuccess(assignment)
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
