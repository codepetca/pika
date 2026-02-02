'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, ContentDialog } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import type { AssignmentWithStatus, Classroom, TiptapContent } from '@/types'
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

  // Determine if this is a first-time view (needs auto-show)
  const isFirstTimeView = selectedAssignment && (!selectedAssignment.doc || selectedAssignment.doc.viewed_at === null)

  // Auto-show instructions modal for unviewed assignments
  useEffect(() => {
    if (isFirstTimeView) {
      setShowInstructions(true)
    } else {
      setShowInstructions(false)
    }
  }, [isFirstTimeView])

  // Mark assignment as viewed locally when closing first-time instructions
  const markAsViewed = useCallback(() => {
    if (selectedAssignmentId) {
      const now = new Date().toISOString()
      setAssignments((prev) =>
        prev.map((a) => {
          if (a.id !== selectedAssignmentId) return a
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
                score_completion: null,
                score_thinking: null,
                score_workflow: null,
                feedback: null,
                graded_at: null,
                graded_by: null,
                returned_at: null,
                authenticity_score: null,
                authenticity_flags: null,
                created_at: now,
                updated_at: now,
              }
          return { ...a, doc: updatedDoc }
        })
      )
    }
  }, [selectedAssignmentId])

  const handleCloseInstructions = useCallback(() => {
    setShowInstructions(false)
    if (isFirstTimeView) {
      markAsViewed()
    }
  }, [isFirstTimeView, markAsViewed])

  return (
    <PageLayout className="h-full flex flex-col">
      <PageActionBar
        primary={
          selectedAssignment && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowInstructions(true)}
            >
              Instructions
            </Button>
          )
        }
        trailing={
          selectedAssignment ? (
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
      <ContentDialog
        isOpen={showInstructions && !!selectedAssignment}
        onClose={handleCloseInstructions}
        title="Instructions"
        subtitle={selectedAssignment?.title}
        maxWidth="max-w-4xl"
      >
        {selectedAssignment?.rich_instructions ? (
          <RichTextViewer content={selectedAssignment.rich_instructions} />
        ) : selectedAssignment?.description ? (
          <div className="text-sm text-text-muted whitespace-pre-wrap">
            {selectedAssignment.description}
          </div>
        ) : (
          <div className="text-sm text-text-muted">
            No assignment details provided.
          </div>
        )}
      </ContentDialog>
    </PageLayout>
  )
}
