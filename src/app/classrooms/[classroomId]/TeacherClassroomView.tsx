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
import { Plus } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Spinner } from '@/components/Spinner'
import { CreateAssignmentModal } from '@/components/CreateAssignmentModal'
import { EditAssignmentModal } from '@/components/EditAssignmentModal'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import {
  ACTIONBAR_BUTTON_CLASSNAME,
  ACTIONBAR_BUTTON_PRIMARY_CLASSNAME,
  PageActionBar,
  PageContent,
  PageLayout,
  type ActionBarItem,
} from '@/components/PageLayout'
import { useRightSidebar, useMobileDrawer } from '@/components/layout'
import {
  getAssignmentStatusBadgeClass,
  getAssignmentStatusDotClass,
  getAssignmentStatusLabel,
} from '@/lib/assignments'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import type { Classroom, Assignment, AssignmentStats, AssignmentStatus, TiptapContent } from '@/types'
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

interface AssignmentWithStats extends Assignment {
  stats: AssignmentStats
}

type TeacherAssignmentSelection = { mode: 'summary' } | { mode: 'assignment'; assignmentId: string }

const TEACHER_ASSIGNMENTS_SELECTION_EVENT = 'pika:teacherAssignmentsSelection'
const TEACHER_ASSIGNMENTS_UPDATED_EVENT = 'pika:teacherAssignmentsUpdated'

interface StudentSubmissionRow {
  student_id: string
  student_email: string
  student_first_name: string | null
  student_last_name: string | null
  status: AssignmentStatus
  doc: { submitted_at?: string | null; updated_at?: string | null } | null
}

interface SelectedStudentInfo {
  assignmentId: string
  assignmentTitle: string
  studentId: string
  canGoPrev: boolean
  canGoNext: boolean
  onGoPrev: () => void
  onGoNext: () => void
}

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
  onSelectStudent?: (student: SelectedStudentInfo | null) => void
  showInstructionsPanel?: boolean
  onToggleInstructions?: () => void
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

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer bg-blue-100 dark:bg-blue-900/50 border-l-2 border-l-blue-500'
  }
  return 'cursor-pointer border-l-2 border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
}

export function TeacherClassroomView({ classroom, onSelectAssignment, onSelectStudent, showInstructionsPanel, onToggleInstructions }: Props) {
  const isReadOnly = !!classroom.archived_at
  const { setOpen: setSidebarOpen, width: sidebarWidth } = useRightSidebar()
  const { openRight: openMobileSidebar } = useMobileDrawer()

  // Hide "Last updated" column when sidebar is 70% or wider to fit table without scrolling
  const isCompactTable = sidebarWidth === '70%'
  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
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

  const [sortColumn, setSortColumn] = useState<'first' | 'last'>('last')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [error, setError] = useState('')

  const loadAssignments = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`)
      const data = await response.json()
      setAssignments(data.assignments || [])
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
    const exists = assignments.some((a) => a.id === value)
    setSelection(exists ? { mode: 'assignment', assignmentId: value } : { mode: 'summary' })
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
      const exists = assignments.some((a) => a.id === value)
      setSelection(exists ? { mode: 'assignment', assignmentId: value } : { mode: 'summary' })
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
  }, [selection])

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
    const dir = sortDirection === 'asc' ? 1 : -1
    const rows = [...selectedAssignmentData.students]
    rows.sort((a, b) => {
      const primaryA = sortColumn === 'first' ? a.student_first_name : a.student_last_name
      const primaryB = sortColumn === 'first' ? b.student_first_name : b.student_last_name

      const missingA = primaryA ? 0 : 1
      const missingB = primaryB ? 0 : 1
      if (missingA !== missingB) return (missingA - missingB) * dir

      const valueA = (primaryA || '').trim()
      const valueB = (primaryB || '').trim()
      const cmp = valueA.localeCompare(valueB)
      if (cmp !== 0) return cmp * dir

      return a.student_email.localeCompare(b.student_email) * dir
    })
    return rows
  }, [selectedAssignmentData, sortColumn, sortDirection])

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
  }, [selectedStudentId, selection.mode, selectedAssignmentData?.assignment?.id, canGoPrevStudent, canGoNextStudent, handleGoPrevStudent, handleGoNextStudent, onSelectStudent])

  // Auto-open sidebar when student is selected (separate effect to avoid re-opening on every dependency change)
  const prevSelectedStudentIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Only open sidebar when transitioning from no selection to a selection
    if (selectedStudentId && !prevSelectedStudentIdRef.current) {
      if (window.innerWidth < DESKTOP_BREAKPOINT) {
        openMobileSidebar()
      } else {
        setSidebarOpen(true)
      }
    }
    prevSelectedStudentIdRef.current = selectedStudentId
  }, [selectedStudentId, setSidebarOpen, openMobileSidebar])

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

  function toggleSort(column: 'first' | 'last') {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDirection('asc')
      return
    }
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
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

  const actionItems: ActionBarItem[] = useMemo(() => {
    if (selection.mode !== 'assignment') return []
    const items: ActionBarItem[] = [
      {
        id: 'edit-assignment',
        label: 'Edit',
        onSelect: () => {
          if (selectedAssignmentData) {
            setEditAssignment(selectedAssignmentData.assignment)
          }
        },
        disabled: !canEditAssignment,
      },
    ]
    // Add Instructions toggle (always visible when viewing an assignment)
    if (onToggleInstructions) {
      items.push({
        id: 'toggle-instructions',
        label: 'Instructions',
        onSelect: onToggleInstructions,
      })
    }
    return items
  }, [selection.mode, selectedAssignmentData, canEditAssignment, onToggleInstructions])

  const newAssignmentButton = (
    <button
      type="button"
      className={`${ACTIONBAR_BUTTON_PRIMARY_CLASSNAME} !px-2.5`}
      onClick={() => setIsCreateModalOpen(true)}
      disabled={isReadOnly}
      aria-label="New assignment"
    >
      <Plus className="h-5 w-5" aria-hidden="true" />
    </button>
  )

  return (
    <PageLayout>
      <PageActionBar primary={newAssignmentButton} actions={actionItems} />

      <PageContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        )}

        {selection.mode === 'summary' ? (
        <div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
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
                      onSelect={() => setSelectionAndPersist({ mode: 'assignment', assignmentId: assignment.id })}
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
              <div className="p-4 text-sm text-red-600 dark:text-red-400">
                {selectedAssignmentError || 'Failed to load assignment'}
              </div>
            ) : (
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <SortableHeaderCell
                      label="First Name"
                      isActive={sortColumn === 'first'}
                      direction={sortDirection}
                      onClick={() => toggleSort('first')}
                    />
                    <SortableHeaderCell
                      label="Last Name"
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onClick={() => toggleSort('last')}
                    />
                    <DataTableHeaderCell>{isCompactTable ? '' : 'Status'}</DataTableHeaderCell>
                    {!isCompactTable && <DataTableHeaderCell>Last updated</DataTableHeaderCell>}
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {sortedStudents.map((student) => {
                    const isSelected = selectedStudentId === student.student_id
                    return (
                    <DataTableRow
                      key={student.student_id}
                      className={getRowClassName(isSelected)}
                      onClick={() => setSelectedStudentId(isSelected ? null : student.student_id)}
                    >
                      <DataTableCell className="max-w-[120px] truncate" title={student.student_first_name ?? undefined}>{student.student_first_name ?? '—'}</DataTableCell>
                      <DataTableCell className="max-w-[120px] truncate" title={student.student_last_name ?? undefined}>{student.student_last_name ?? '—'}</DataTableCell>
                      <DataTableCell>
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${getAssignmentStatusDotClass(student.status)}`}
                          title={getAssignmentStatusLabel(student.status)}
                        />
                      </DataTableCell>
                      {!isCompactTable && (
                        <DataTableCell className="text-gray-700 dark:text-gray-300">
                          {student.doc?.updated_at ? formatTorontoDateTime(student.doc.updated_at) : '—'}
                        </DataTableCell>
                      )}
                    </DataTableRow>
                    )
                  })}
                  {sortedStudents.length === 0 && (
                    <EmptyStateRow colSpan={isCompactTable ? 3 : 4} message="No students enrolled" />
                  )}
                </DataTableBody>
              </DataTable>
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


      <EditAssignmentModal
        isOpen={!!editAssignment}
        assignment={editAssignment}
        onClose={() => setEditAssignment(null)}
        onSuccess={handleEditSuccess}
      />

      <CreateAssignmentModal
        isOpen={isCreateModalOpen}
        classroomId={classroom.id}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
      </PageContent>
    </PageLayout>
  )
}
