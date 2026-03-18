'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button, Card, ContentDialog, EmptyState, RefreshingIndicator } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout, PageStack } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
} from '@/lib/assignments'
import type { AssignmentWithStatus, Classroom, TiptapContent } from '@/types'
import { StudentAssignmentEditor, type StudentAssignmentEditorHandle } from '@/components/StudentAssignmentEditor'
import { RichTextViewer } from '@/components/editor'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { fetchJSONWithCache } from '@/lib/request-cache'

interface Props {
  classroom: Classroom
  selectedAssignmentId?: string | null
  isActive?: boolean
  updateSearchParams?: (updater: (params: URLSearchParams) => void, options?: { replace?: boolean }) => void
}

type StudentAssignmentsView = 'summary' | 'edit'

export function StudentAssignmentsTab({
  classroom,
  selectedAssignmentId = null,
  isActive = true,
  updateSearchParams = () => {},
}: Props) {
  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [editorState, setEditorState] = useState({ isSubmitted: false, canSubmit: false, submitting: false, hasRepoMetadata: false })
  const editorRef = useRef<StudentAssignmentEditorHandle>(null)
  const wasActiveRef = useRef(isActive)
  const showBlockingSpinner = useDelayedBusy(loading && assignments.length === 0)

  const loadAssignments = useCallback(
    async (options?: { preserveContent?: boolean }) => {
      const preserveContent = options?.preserveContent ?? false
      if (preserveContent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      try {
        const data = await fetchJSONWithCache(
          `student-assignments:${classroom.id}`,
          async () => {
            const res = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
            if (!res.ok) throw new Error('Failed to load assignments')
            return res.json()
          },
          20_000,
        )
        setAssignments(data.assignments || [])
        setHasLoaded(true)
      } catch (err) {
        console.error('Error loading assignments:', err)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [classroom.id]
  )

  useEffect(() => {
    if (isActive && !hasLoaded) {
      wasActiveRef.current = true
      loadAssignments()
      return
    }
    if (isActive && !wasActiveRef.current && hasLoaded) {
      loadAssignments({ preserveContent: true })
    }
    wasActiveRef.current = isActive
  }, [hasLoaded, isActive, loadAssignments])

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
      updateSearchParams((params) => {
        params.set('tab', 'assignments')
        params.delete('view')
        if (next.assignmentId) {
          params.set('assignmentId', next.assignmentId)
        } else {
          params.delete('assignmentId')
        }
      })
    },
    [updateSearchParams],
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
                repo_url: null,
                github_username: null,
                is_submitted: false,
                submitted_at: null,
                viewed_at: now,
                score_completion: null,
                score_thinking: null,
                score_workflow: null,
                feedback: null,
                teacher_feedback_draft: null,
                teacher_feedback_draft_updated_at: null,
                feedback_returned_at: null,
                ai_feedback_suggestion: null,
                ai_feedback_suggested_at: null,
                ai_feedback_model: null,
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
      {selectedAssignment ? (
        <PageActionBar
          primary={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowInstructions(true)}>
                Instructions
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => editorRef.current?.openRepoDialog()}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Repo
              </Button>
            </div>
          }
          trailing={
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
          }
        />
      ) : null}
      <PageContent className={selectedAssignment ? 'flex-1 min-h-0' : 'pt-0 flex-1 min-h-0'}>
        <div className="min-w-0 h-full flex flex-col">
          {refreshing && (
            <RefreshingIndicator className="mb-2 px-0 py-0" />
          )}
          {showBlockingSpinner ? (
              <Card tone="panel" padding="lg">
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              </Card>
            ) : view === 'summary' ? (
              assignments.length === 0 ? (
                <EmptyState
                  title="No assignments yet"
                  description="When your teacher posts work, it will show up here with due dates and submission status."
                />
              ) : (
                <PageStack>
                  {assignments.map((assignment) => (
                    <button
                      key={assignment.id}
                      type="button"
                      data-testid="assignment-card"
                      onClick={() => navigate({ assignmentId: assignment.id })}
                      className="block w-full rounded-card border border-border bg-surface-panel px-5 py-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-text-default">
                            {assignment.title}
                          </h3>
                          <p className="mt-1 text-sm text-text-muted">
                            {formatDueDate(assignment.due_at)}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-text-muted">
                            {formatRelativeDueDate(assignment.due_at)}
                          </p>
                        </div>
                        <span
                          className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getAssignmentStatusBadgeClass(assignment.status)}`}
                        >
                          {getAssignmentStatusLabel(assignment.status)}
                        </span>
                      </div>
                    </button>
                  ))}
                </PageStack>
              )
            ) : !selectedAssignment ? (
              <EmptyState
                title="Assignment unavailable"
                description="That assignment is no longer available."
                tone="muted"
              />
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
        {selectedAssignment?.instructions_markdown ? (
          <LimitedMarkdown content={selectedAssignment.instructions_markdown} />
        ) : selectedAssignment?.rich_instructions ? (
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
