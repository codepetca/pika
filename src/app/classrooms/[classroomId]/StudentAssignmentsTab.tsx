'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { useRightSidebar, useMobileDrawer } from '@/components/layout'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import type { AssignmentWithStatus, Classroom, TiptapContent } from '@/types'
import { StudentAssignmentEditor, type StudentAssignmentEditorHandle } from '@/components/StudentAssignmentEditor'
import { RichTextViewer } from '@/components/editor'

interface Props {
  classroom: Classroom
  onSelectAssignment?: (assignment: { title: string; instructions: TiptapContent | string | null } | null) => void
}

type StudentAssignmentsView = 'summary' | 'edit'

export function StudentAssignmentsTab({ classroom, onSelectAssignment }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const { toggle: toggleSidebar, setOpen: setSidebarOpen } = useRightSidebar()
  const { openRight: openMobileSidebar } = useMobileDrawer()

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

  // Determine if this is a first-time view (needs modal)
  const isFirstTimeView = selectedAssignment && (!selectedAssignment.doc || selectedAssignment.doc.viewed_at === null)

  // Auto-show instructions modal for unviewed assignments only
  useEffect(() => {
    if (isFirstTimeView) {
      setShowInstructions(true)
    } else {
      setShowInstructions(false)
    }
  }, [isFirstTimeView])

  // Notify parent about selected assignment for sidebar
  useEffect(() => {
    if (selectedAssignment) {
      onSelectAssignment?.({
        title: selectedAssignment.title,
        instructions: selectedAssignment.rich_instructions || selectedAssignment.description,
      })
    } else {
      onSelectAssignment?.(null)
    }
  }, [selectedAssignment, onSelectAssignment])

  // Auto-open sidebar for previously viewed assignments (not first-time)
  useEffect(() => {
    if (selectedAssignment && !isFirstTimeView) {
      // Open sidebar for viewed assignments
      if (window.innerWidth < DESKTOP_BREAKPOINT) {
        openMobileSidebar()
      } else {
        setSidebarOpen(true)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when assignment changes
  }, [selectedAssignment?.id])

  // Mark assignment as viewed locally when closing instructions
  const handleCloseInstructions = useCallback(() => {
    setShowInstructions(false)
    if (selectedAssignmentId) {
      const now = new Date().toISOString()
      setAssignments((prev) =>
        prev.map((a) => {
          if (a.id !== selectedAssignmentId) return a
          // Create or update doc with viewed_at timestamp
          const updatedDoc = a.doc
            ? { ...a.doc, viewed_at: now }
            : {
                id: '',
                assignment_id: a.id,
                student_id: '',
                content: { type: 'doc', content: [] } as TiptapContent,
                is_submitted: false,
                submitted_at: null,
                viewed_at: now,
                created_at: now,
                updated_at: now,
              }
          return { ...a, doc: updatedDoc }
        })
      )
    }
  }, [selectedAssignmentId])

  return (
    <PageLayout className="h-full flex flex-col">
      <PageActionBar
        primary={
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
        trailing={
          selectedAssignment ? (
            <button
              type="button"
              className={ACTIONBAR_BUTTON_CLASSNAME}
              onClick={() => {
                if (isFirstTimeView) {
                  // Still showing first-time modal - do nothing or close it
                  setShowInstructions(false)
                } else {
                  // For viewed assignments, toggle the sidebar
                  // On mobile, open the drawer; on desktop, toggle
                  if (window.innerWidth < DESKTOP_BREAKPOINT) {
                    openMobileSidebar()
                  } else {
                    toggleSidebar()
                  }
                }
              }}
            >
              Instructions
            </button>
          ) : (
            <div />
          )
        }
      />
      <PageContent className="flex-1 min-h-0">
        <div className="min-w-0 h-full flex flex-col">
          {loading ? (
              <div className="bg-surface rounded-lg shadow-sm">
                <div className="p-4">
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                </div>
              </div>
            ) : view === 'summary' ? (
              <div className="bg-surface rounded-lg shadow-sm">
                <div className="p-4">
                  {assignments.length === 0 ? (
                    <div className="text-center py-8 text-text-muted">No assignments yet</div>
                  ) : (
                    <div className="space-y-3">
                      {assignments.map((assignment) => (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => navigate({ assignmentId: assignment.id })}
                          className="w-full text-left block p-4 border border-border rounded-lg hover:border-primary hover:bg-info-bg transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-medium text-text-default truncate">
                                {assignment.title}
                              </h3>
                              <p className="text-sm text-text-muted mt-1">
                                {formatDueDate(assignment.due_at)}
                              </p>
                              <p className="text-xs text-text-muted mt-1">
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
              <div className="bg-surface rounded-lg shadow-sm">
                <div className="p-6 text-sm text-text-muted">
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
      {/* Modal only shows for first-time views (unviewed assignments) */}
      {showInstructions && isFirstTimeView && selectedAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close instructions"
            onClick={handleCloseInstructions}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface shadow-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-text-default">Instructions</h3>
                <p className="text-xs text-text-muted truncate">{selectedAssignment.title}</p>
              </div>
              <button
                type="button"
                onClick={handleCloseInstructions}
                className="p-2 rounded-md hover:bg-surface-hover text-text-muted"
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="mt-4">
              {selectedAssignment.rich_instructions ? (
                <RichTextViewer content={selectedAssignment.rich_instructions} />
              ) : selectedAssignment.description ? (
                <div className="text-sm text-text-muted whitespace-pre-wrap">
                  {selectedAssignment.description}
                </div>
              ) : (
                <div className="text-sm text-text-muted">
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
