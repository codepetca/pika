'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import type { AssignmentWithStatus, Classroom } from '@/types'
import { StudentAssignmentEditor, type StudentAssignmentEditorHandle } from '@/components/StudentAssignmentEditor'
import { RichTextViewer } from '@/components/editor'

interface Props {
  classroom: Classroom
}

type StudentAssignmentsView = 'summary' | 'edit'

export function StudentAssignmentsTab({ classroom }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showInstructions, setShowInstructions] = useState(false)
  const [editorState, setEditorState] = useState({ isSubmitted: false, canSubmit: false, submitting: false })
  const editorRef = useRef<StudentAssignmentEditorHandle>(null)

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

  const selectedAssignmentId = searchParams.get('assignmentId')
  const selectedAssignment = useMemo(() => {
    if (!selectedAssignmentId) return null
    return assignments.find((a) => a.id === selectedAssignmentId) ?? null
  }, [assignments, selectedAssignmentId])

  const view: StudentAssignmentsView = useMemo(() => {
    if (!selectedAssignmentId) return 'summary'
    if (!selectedAssignment) return 'summary'
    return 'edit'
  }, [selectedAssignment, selectedAssignmentId])

  const navigate = useCallback(
    (next: { assignmentId?: string | null }) => {
      const params = new URLSearchParams(search)
      params.set('tab', 'assignments')
      params.delete('view')

      if (next.assignmentId) {
        params.set('assignmentId', next.assignmentId)
      } else {
        params.delete('assignmentId')
      }

      const query = params.toString()
      router.push(`/classrooms/${classroom.id}${query ? `?${query}` : ''}`)
    },
    [classroom.id, router, search],
  )

  const handleSubmit = useCallback(async () => {
    await editorRef.current?.submit()
  }, [])

  const handleUnsubmit = useCallback(async () => {
    await editorRef.current?.unsubmit()
  }, [])

  // Auto-show instructions for unviewed assignments (no doc or viewed_at is null)
  useEffect(() => {
    if (selectedAssignment && (!selectedAssignment.doc || selectedAssignment.doc.viewed_at === null)) {
      setShowInstructions(true)
    } else {
      setShowInstructions(false)
    }
  }, [selectedAssignment])

  // Mark assignment as viewed locally when closing instructions
  const handleCloseInstructions = useCallback(() => {
    setShowInstructions(false)
    if (selectedAssignmentId) {
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === selectedAssignmentId && a.doc
            ? { ...a, doc: { ...a.doc, viewed_at: new Date().toISOString() } }
            : a
        )
      )
    }
  }, [selectedAssignmentId])

  return (
    <PageLayout className="h-full flex flex-col">
      <PageActionBar
        primary={
          selectedAssignment ? (
            <button
              type="button"
              className={ACTIONBAR_BUTTON_CLASSNAME}
              onClick={() => setShowInstructions(true)}
            >
              Instructions
            </button>
          ) : (
            <div />
          )
        }
        trailing={
          selectedAssignment && (
            <Button
              size="sm"
              variant={editorState.isSubmitted ? 'secondary' : 'primary'}
              onClick={editorState.isSubmitted ? handleUnsubmit : handleSubmit}
              disabled={editorState.submitting || (!editorState.isSubmitted && !editorState.canSubmit)}
            >
              {editorState.submitting
                ? (editorState.isSubmitted ? 'Unsubmitting...' : 'Submitting...')
                : (editorState.isSubmitted ? 'Unsubmit' : 'Submit')}
            </Button>
          )
        }
      />
      <PageContent className="flex-1 min-h-0">
        <div className="min-w-0 h-full flex flex-col">
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
                          onClick={() => navigate({ assignmentId: assignment.id })}
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
            ) : (
              <StudentAssignmentEditor
                ref={editorRef}
                classroomId={classroom.id}
                assignmentId={selectedAssignment.id}
                variant="embedded"
                onExit={() => navigate({ assignmentId: null })}
                onStateChange={setEditorState}
              />
            )}
        </div>
      </PageContent>
      {showInstructions && selectedAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            aria-label="Close instructions"
            onClick={handleCloseInstructions}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Instructions</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{selectedAssignment.title}</p>
              </div>
              <button
                type="button"
                onClick={handleCloseInstructions}
                className="p-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="mt-4">
              {selectedAssignment.rich_instructions ? (
                <RichTextViewer content={selectedAssignment.rich_instructions} />
              ) : selectedAssignment.description ? (
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {selectedAssignment.description}
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  No assignment details provided.
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={handleCloseInstructions}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
