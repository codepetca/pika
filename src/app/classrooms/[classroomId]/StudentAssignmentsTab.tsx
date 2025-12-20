'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { Spinner } from '@/components/Spinner'
import {
  ACTIONBAR_BUTTON_CLASSNAME,
  PageActionBar,
  PageContent,
  PageLayout,
  type ActionBarItem,
} from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import type { AssignmentWithStatus, Classroom } from '@/types'
import { StudentAssignmentEditor } from './assignments/[assignmentId]/StudentAssignmentEditor'

interface Props {
  classroom: Classroom
}

type StudentAssignmentsView = 'summary' | 'details' | 'edit'

export function StudentAssignmentsTab({ classroom }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [loading, setLoading] = useState(true)

  const [isMobileSelectorOpen, setIsMobileSelectorOpen] = useState(false)
  const mobileSelectorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
        const data = await res.json()
        setAssignments(data.assignments || [])
      } catch (err) {
        console.error('Error loading assignments:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  useEffect(() => {
    if (!isMobileSelectorOpen) return

    function onMouseDown(e: MouseEvent) {
      if (!mobileSelectorRef.current) return
      if (e.target instanceof Node && !mobileSelectorRef.current.contains(e.target)) {
        setIsMobileSelectorOpen(false)
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsMobileSelectorOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isMobileSelectorOpen])

  const selectedAssignmentId = searchParams.get('assignmentId')
  const selectedAssignment = useMemo(() => {
    if (!selectedAssignmentId) return null
    return assignments.find((a) => a.id === selectedAssignmentId) ?? null
  }, [assignments, selectedAssignmentId])

  const view: StudentAssignmentsView = useMemo(() => {
    if (!selectedAssignmentId) return 'summary'
    if (!selectedAssignment) return 'summary'

    const raw = searchParams.get('view')
    if (raw === 'details') return 'details'
    return 'edit'
  }, [searchParams, selectedAssignment, selectedAssignmentId])

  const navigate = useCallback(
    (next: { assignmentId?: string | null; view?: Exclude<StudentAssignmentsView, 'summary'> | null }) => {
      const params = new URLSearchParams(search)
      params.set('tab', 'assignments')

      if (next.assignmentId) {
        params.set('assignmentId', next.assignmentId)
      } else {
        params.delete('assignmentId')
      }

      if (next.assignmentId && next.view) {
        params.set('view', next.view)
      } else {
        params.delete('view')
      }

      const query = params.toString()
      router.push(`/classrooms/${classroom.id}${query ? `?${query}` : ''}`)
    },
    [classroom.id, router, search],
  )

  const actionItems: ActionBarItem[] = useMemo(() => {
    if (!selectedAssignment) return []

    return [
      {
        id: 'view-details',
        label: view === 'details' ? 'Instructions ✓' : 'Instructions',
        onSelect: () => navigate({ assignmentId: selectedAssignment.id, view: 'details' }),
      },
      {
        id: 'edit',
        label: view === 'edit' ? 'Edit ✓' : 'Edit',
        onSelect: () => navigate({ assignmentId: selectedAssignment.id, view: 'edit' }),
      },
    ]
  }, [navigate, selectedAssignment, view])

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <>
            <div className="lg:hidden relative" ref={mobileSelectorRef}>
              <button
                type="button"
                className={[ACTIONBAR_BUTTON_CLASSNAME, 'inline-flex items-center gap-2 max-w-full'].join(' ')}
                onClick={() => setIsMobileSelectorOpen((prev) => !prev)}
                aria-label="Select assignment"
                aria-haspopup="menu"
                aria-expanded={isMobileSelectorOpen}
              >
                <span className="truncate max-w-[16rem]">Assignments</span>
                <ChevronDownIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden="true" />
              </button>

              {isMobileSelectorOpen && (
                <div
                  role="menu"
                  className="absolute z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                    onClick={() => navigate({ assignmentId: null, view: null })}
                  >
                    Assignments
                  </button>
                  <div className="max-h-72 overflow-auto">
                    {assignments.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="menuitem"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100"
                        onClick={() => navigate({ assignmentId: a.id, view: 'edit' })}
                        title={a.title}
                      >
                        {a.title}
                      </button>
                    ))}
                    {!loading && assignments.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No assignments</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        }
        actions={actionItems}
        actionsAlign="start"
      />
      <PageContent>
        <div className="min-w-0">
          {loading ? (
              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm">
                <div className="p-4">
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                </div>
              </div>
            ) : view === 'summary' ? (
              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm">
                <div className="p-4">
                  {assignments.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">No assignments yet</div>
                  ) : (
                    <div className="space-y-3">
                      {assignments.map((assignment) => (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => navigate({ assignmentId: assignment.id, view: 'edit' })}
                          className="w-full text-left block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-medium text-gray-900 dark:text-white truncate">
                                {assignment.title}
                              </h3>
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {formatDueDate(assignment.due_at)}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {formatRelativeDueDate(assignment.due_at)}
                              </p>
                            </div>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(assignment.status)}`}
                            >
                              {getAssignmentStatusLabel(assignment.status)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : !selectedAssignment ? (
              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm">
                <div className="p-6 text-sm text-gray-600 dark:text-gray-400">
                  That assignment is no longer available.
                </div>
              </div>
            ) : view === 'details' ? (
              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {selectedAssignment.title}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                        Due: {formatDueDate(selectedAssignment.due_at)} • {formatRelativeDueDate(selectedAssignment.due_at)}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(selectedAssignment.status)}`}
                    >
                      {getAssignmentStatusLabel(selectedAssignment.status)}
                    </span>
                  </div>

                  <div className="mt-4">
                    {selectedAssignment.description ? (
                      <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {selectedAssignment.description}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        No assignment details provided.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <StudentAssignmentEditor
                classroomId={classroom.id}
                assignmentId={selectedAssignment.id}
                variant="embedded"
                onExit={() => navigate({ assignmentId: null, view: null })}
              />
            )}
        </div>
      </PageContent>
    </PageLayout>
  )
}
