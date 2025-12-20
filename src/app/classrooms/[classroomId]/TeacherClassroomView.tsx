'use client'

import { useCallback, useMemo, useRef, useState, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Input } from '@/components/Input'
import { Spinner } from '@/components/Spinner'
import { TeacherStudentWorkModal } from '@/components/TeacherStudentWorkModal'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import { DateActionBar } from '@/components/DateActionBar'
import { addDaysToDateString } from '@/lib/date-string'
import { formatDueDate } from '@/lib/assignments'
import {
  getAssignmentStatusBadgeClass,
  getAssignmentStatusLabel,
} from '@/lib/assignments'
import { fromTorontoTime, getTodayInToronto } from '@/lib/timezone'
import type { Classroom, Assignment, AssignmentStats, AssignmentStatus } from '@/types'
import { ChevronDownIcon, TrashIcon } from '@heroicons/react/24/outline'
import { parse } from 'date-fns'
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

function toTorontoEndOfDayIso(dateString: string) {
  const date = parse(dateString, 'yyyy-MM-dd', new Date())
  date.setHours(23, 59, 0, 0)
  return fromTorontoTime(date).toISOString()
}

export function TeacherClassroomView({ classroom }: Props) {
  const router = useRouter()
  const selectorRef = useRef<HTMLDivElement | null>(null)
  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [selection, setSelection] = useState<TeacherAssignmentSelection>({ mode: 'summary' })
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)

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

  // New assignment form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const loadAssignments = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`)
      const data = await response.json()
      setAssignments(data.assignments || [])
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

  useEffect(() => {
    if (!isSelectorOpen) return
    function handleMouseDown(e: MouseEvent) {
      if (!selectorRef.current) return
      if (e.target instanceof Node && !selectorRef.current.contains(e.target)) {
        setIsSelectorOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsSelectorOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSelectorOpen])

  async function handleCreateAssignment(e: FormEvent) {
    e.preventDefault()
    setError('')
    setCreating(true)

    try {
      const response = await fetch('/api/teacher/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          title,
          description,
          due_at: toTorontoEndOfDayIso(dueAt),
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create assignment')
      }

      // Reset form and reload
      setTitle('')
      setDescription('')
      setDueAt('')
      setShowNewForm(false)
      loadAssignments()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  function setSelectionAndPersist(next: TeacherAssignmentSelection) {
    const cookieName = `teacherAssignmentsSelection:${classroom.id}`
    const cookieValue = next.mode === 'summary' ? 'summary' : next.assignmentId
    setCookieValue(cookieName, cookieValue)
    setSelection(next)
    setIsSelectorOpen(false)
  }

  const selectorLabel = useMemo(() => {
    if (selection.mode === 'summary') return 'Assignments'
    const found = assignments.find((a) => a.id === selection.assignmentId)
    return found?.title || 'Assignment'
  }, [assignments, selection])

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
    const items: ActionBarItem[] = []

    if (selection.mode === 'assignment') {
      items.push({
        id: 'open-assignment',
        label: 'Open assignment',
        onSelect: () => {
          if (!selectedAssignmentData) return
          router.push(`/classrooms/${classroom.id}/assignments/${selectedAssignmentData.assignment.id}`)
        },
        disabled: selectedAssignmentLoading || !selectedAssignmentData,
      })
    }

    items.push({
      id: 'toggle-new-assignment',
      label: showNewForm ? 'Cancel' : '+ New Assignment',
      onSelect: () => setShowNewForm((prev) => !prev),
    })

    return items
  }, [classroom.id, router, selectedAssignmentData, selectedAssignmentLoading, selection.mode, showNewForm])

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <div className="relative" ref={selectorRef}>
            <button
              type="button"
              className={[ACTIONBAR_BUTTON_CLASSNAME, 'inline-flex items-center gap-2 max-w-full'].join(' ')}
              onClick={() => setIsSelectorOpen((prev) => !prev)}
              aria-label="Select assignment view"
            >
              <span className="truncate max-w-[16rem]">{selectorLabel}</span>
              <ChevronDownIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            </button>
            {isSelectorOpen && (
              <div className="absolute z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                  onClick={() => setSelectionAndPersist({ mode: 'summary' })}
                >
                  Assignments
                </button>
                <div className="max-h-72 overflow-auto">
                  {assignments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                      onClick={() => setSelectionAndPersist({ mode: 'assignment', assignmentId: a.id })}
                      title={a.title}
                    >
                      {a.title}
                    </button>
                  ))}
                  {assignments.length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No assignments</div>
                  )}
                </div>
              </div>
            )}
          </div>
        }
        actions={actionItems}
      />

      <PageContent className="space-y-4">

      {/* New Assignment Form */}
      {showNewForm && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <form onSubmit={handleCreateAssignment} className="space-y-3 max-w-xl">
              <Input
                label="Title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={creating}
                placeholder="Assignment title"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Instructions
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Assignment instructions (optional)"
                  disabled={creating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Due Date
                </label>
                <DateActionBar
                  value={dueAt}
                  onChange={(date) => {
                    const today = getTodayInToronto()
                    if (date < today) {
                      setError('Due date cannot be before today')
                      return
                    }
                    setError('')
                    setDueAt(date)
                  }}
                  onPrev={() => {
                    const newDate = addDaysToDateString(dueAt, -1)
                    const today = getTodayInToronto()
                    if (newDate < today) {
                      setError('Due date cannot be before today')
                      return
                    }
                    setError('')
                    setDueAt(newDate)
                  }}
                  onNext={() => {
                    setError('')
                    setDueAt(addDaysToDateString(dueAt, 1))
                  }}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

            <div className="flex gap-2">
              <Button type="submit" disabled={creating || !title || !dueAt}>
                {creating ? 'Creating...' : 'Create Assignment'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewForm(false)}
                disabled={creating}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">
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
            <div className="space-y-2">
              {assignments.map((assignment) => (
                <Link
                  key={assignment.id}
                  href={`/classrooms/${classroom.id}/assignments/${assignment.id}`}
                  className="block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {assignment.title}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {assignment.stats.submitted} / {assignment.stats.total_students} submitted
                        {assignment.stats.late > 0 ? ` • ${assignment.stats.late} late` : ''}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Due: {formatDueDate(assignment.due_at)}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          setPendingDelete({ id: assignment.id, title: assignment.title })
                        }}
                        className="p-2 rounded-md text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-200 dark:hover:bg-red-900/20"
                        aria-label={`Delete ${assignment.title}`}
                      >
                        <TrashIcon className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
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
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(student.status)}`}>
                        {getAssignmentStatusLabel(student.status)}
                      </span>
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
          onClose={() => setSelectedStudentId(null)}
        />
      )}
      </PageContent>
    </PageLayout>
  )
}
