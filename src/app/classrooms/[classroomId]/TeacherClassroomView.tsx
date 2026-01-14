'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
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
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Spinner } from '@/components/Spinner'
import { CreateAssignmentModal } from '@/components/CreateAssignmentModal'
import { EditAssignmentModal } from '@/components/EditAssignmentModal'
import { TeacherStudentWorkModal } from '@/components/TeacherStudentWorkModal'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import {
  ACTIONBAR_BUTTON_CLASSNAME,
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
import type { Classroom, Assignment, AssignmentStats, AssignmentStatus, TiptapContent } from '@/types'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
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

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
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
  return new Date(iso).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function TeacherClassroomView({ classroom, onSelectAssignment }: Props) {
  const isReadOnly = !!classroom.archived_at
  const { setOpen: setSidebarOpen } = useRightSidebar()
  const { openRight: openMobileSidebar } = useMobileDrawer()
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

  // Notify parent about selected assignment for sidebar and auto-open sidebar
  useEffect(() => {
    if (selection.mode === 'summary') {
      onSelectAssignment?.(null)
    } else if (selectedAssignmentData) {
      const { assignment } = selectedAssignmentData
      onSelectAssignment?.({
        title: assignment.title,
        instructions: assignment.rich_instructions || assignment.description,
      })
      // Auto-open sidebar when assignment is selected
      if (window.innerWidth < 1024) {
        openMobileSidebar()
      } else {
        setSidebarOpen(true)
      }
    }
  }, [selection.mode, selectedAssignmentData, onSelectAssignment, setSidebarOpen, openMobileSidebar])

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

  const actionItems: ActionBarItem[] = useMemo(() => {
    return [
      {
        id: 'toggle-new-assignment',
        label: 'New Assignment',
        onSelect: () => setIsCreateModalOpen(true),
        disabled: isReadOnly,
        primary: true,
      },
    ]
  }, [isReadOnly])

  const canEditAssignment =
    selection.mode === 'assignment' && !!selectedAssignmentData && !selectedAssignmentLoading && !isReadOnly
  const editAssignmentButton = selection.mode === 'assignment' ? (
    <button
      type="button"
      className={ACTIONBAR_BUTTON_CLASSNAME}
      onClick={() => {
        if (!selectedAssignmentData) return
        setEditAssignment(selectedAssignmentData.assignment)
      }}
      disabled={!canEditAssignment}
    >
      Edit assignment
    </button>
  ) : (
    <div />
  )

  return (
    <PageLayout>
      <PageActionBar primary={editAssignmentButton} actions={actionItems} />

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
        <TableCard overflowX>
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
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Submitted</DataTableHeaderCell>
                  <DataTableHeaderCell>Last updated</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {sortedStudents.map((student) => (
                  <DataTableRow
                    key={student.student_id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    onClick={() => setSelectedStudentId(student.student_id)}
                  >
                    <DataTableCell>{student.student_first_name ?? '—'}</DataTableCell>
                    <DataTableCell>{student.student_last_name ?? '—'}</DataTableCell>
                    <DataTableCell>
                      <span
                        className={`inline-block w-3 h-3 rounded-full ${getAssignmentStatusDotClass(student.status)}`}
                        title={getAssignmentStatusLabel(student.status)}
                      />
                    </DataTableCell>
                    <DataTableCell className="text-gray-700 dark:text-gray-300">
                      {student.doc?.submitted_at ? formatTorontoDateTime(student.doc.submitted_at) : '—'}
                    </DataTableCell>
                    <DataTableCell className="text-gray-700 dark:text-gray-300">
                      {student.doc?.updated_at ? formatTorontoDateTime(student.doc.updated_at) : '—'}
                    </DataTableCell>
                  </DataTableRow>
                ))}
                {sortedStudents.length === 0 && (
                  <EmptyStateRow colSpan={5} message="No students enrolled" />
                )}
              </DataTableBody>
            </DataTable>
          )}
        </TableCard>
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

      {selection.mode === 'assignment' && selectedAssignmentData?.assignment?.id && selectedStudentId && (
        <TeacherStudentWorkModal
          isOpen={true}
          assignmentId={selectedAssignmentData.assignment.id}
          studentId={selectedStudentId}
          canGoPrev={canGoPrevStudent}
          canGoNext={canGoNextStudent}
          onGoPrev={handleGoPrevStudent}
          onGoNext={handleGoNextStudent}
          onClose={() => setSelectedStudentId(null)}
        />
      )}

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
