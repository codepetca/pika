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
import type {
  AssignmentWithStatus,
  Classroom,
  ClassworkMaterial,
  StudentSurveyView,
  TiptapContent,
} from '@/types'
import { StudentAssignmentEditor, type StudentAssignmentEditorHandle } from '@/components/StudentAssignmentEditor'
import { RichTextViewer } from '@/components/editor'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { StudentSurveyPanel } from '@/components/surveys/StudentSurveyPanel'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { fetchJSONWithCache } from '@/lib/request-cache'
import { buildOrderedClassworkItems } from '@/lib/classwork-order'
import { getStudentSurveyStatus, getSurveyStatusBadgeClass, getSurveyStatusLabel } from '@/lib/surveys'

interface Props {
  classroom: Classroom
  selectedAssignmentId?: string | null
  selectedMaterialId?: string | null
  selectedSurveyId?: string | null
  isActive?: boolean
  updateSearchParams?: (updater: (params: URLSearchParams) => void, options?: { replace?: boolean }) => void
}

type StudentAssignmentsView = 'summary' | 'edit' | 'material' | 'survey'

export function StudentAssignmentsTab({
  classroom,
  selectedAssignmentId = null,
  selectedMaterialId = null,
  selectedSurveyId = null,
  isActive = true,
  updateSearchParams = () => {},
}: Props) {
  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [materials, setMaterials] = useState<ClassworkMaterial[]>([])
  const [surveys, setSurveys] = useState<StudentSurveyView[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [editorState, setEditorState] = useState({ isSubmitted: false, canSubmit: false, submitting: false, hasRepoMetadata: false })
  const editorRef = useRef<StudentAssignmentEditorHandle>(null)
  const wasActiveRef = useRef(isActive)
  const showBlockingSpinner = useDelayedBusy(
    loading && assignments.length === 0 && materials.length === 0 && surveys.length === 0
  )

  const loadAssignments = useCallback(
    async (options?: { preserveContent?: boolean }) => {
      const preserveContent = options?.preserveContent ?? false
      if (preserveContent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      try {
        const [assignmentsData, materialsData, surveysData] = await Promise.all([
          fetchJSONWithCache(
            `student-assignments:${classroom.id}`,
            async () => {
              const res = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
              if (!res.ok) throw new Error('Failed to load assignments')
              return res.json()
            },
            20_000,
          ),
          fetchJSONWithCache(
            `student-materials:${classroom.id}`,
            async () => {
              const res = await fetch(`/api/student/classrooms/${classroom.id}/materials`)
              if (!res.ok) throw new Error('Failed to load materials')
              return res.json()
            },
            20_000,
          ),
          fetchJSONWithCache(
            `student-surveys:${classroom.id}`,
            async () => {
              const res = await fetch(`/api/student/surveys?classroom_id=${classroom.id}`)
              if (!res.ok) throw new Error('Failed to load surveys')
              return res.json()
            },
            20_000,
          ).catch(() => ({ surveys: [] })),
        ])
        setAssignments(assignmentsData.assignments || [])
        setMaterials(materialsData.materials || [])
        setSurveys(surveysData.surveys || [])
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

  const selectedMaterial = useMemo(() => {
    if (!selectedMaterialId) return null
    return materials.find((material) => material.id === selectedMaterialId) ?? null
  }, [materials, selectedMaterialId])

  const selectedSurvey = useMemo(() => {
    if (!selectedSurveyId) return null
    return surveys.find((survey) => survey.id === selectedSurveyId) ?? null
  }, [selectedSurveyId, surveys])

  const classworkItems = useMemo(
    () => buildOrderedClassworkItems(assignments, materials, surveys),
    [assignments, materials, surveys],
  )

  const view: StudentAssignmentsView = useMemo(() => {
    if (selectedMaterialId && selectedMaterial) return 'material'
    if (selectedSurveyId && selectedSurvey) return 'survey'
    if (!selectedAssignmentId) return 'summary'
    if (!selectedAssignment) return 'summary'
    return 'edit'
  }, [selectedAssignment, selectedAssignmentId, selectedMaterial, selectedMaterialId, selectedSurvey, selectedSurveyId])

  const navigate = useCallback(
    (next: { assignmentId?: string | null; materialId?: string | null; surveyId?: string | null }) => {
      updateSearchParams((params) => {
        params.set('tab', 'assignments')
        params.delete('view')
        if (next.assignmentId) {
          params.set('assignmentId', next.assignmentId)
        } else {
          params.delete('assignmentId')
        }
        if (next.materialId) {
          params.set('materialId', next.materialId)
        } else {
          params.delete('materialId')
        }
        if (next.surveyId) {
          params.set('surveyId', next.surveyId)
        } else {
          params.delete('surveyId')
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
                teacher_cleared_at: null,
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
      ) : selectedMaterial ? (
        <PageActionBar
          primary={
            <Button size="sm" variant="secondary" onClick={() => navigate({ materialId: null })}>
              Back
            </Button>
          }
        />
      ) : null}
      <PageContent className="flex-1 min-h-0">
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
              assignments.length === 0 && materials.length === 0 && surveys.length === 0 ? (
                <EmptyState
                  title="No classwork yet"
                  description="When your teacher posts assignments, materials, or surveys, they will show up here."
                />
              ) : (
                <PageStack>
                  {classworkItems.map((item) => {
                    if (item.type === 'material') {
                      const material = item.material
                      return (
                        <button
                          key={material.id}
                          type="button"
                          data-testid="material-card"
                          onClick={() => navigate({ materialId: material.id })}
                          className="block w-full rounded-card border border-border bg-info-bg px-5 py-4 text-left transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-info-bg-hover hover:shadow-panel"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="truncate text-base font-semibold text-text-default">
                                {material.title}
                              </h3>
                              <p className="mt-1 text-sm text-primary">
                                Material
                              </p>
                            </div>
                            <span className="rounded-badge bg-info-bg px-2.5 py-1 text-xs font-semibold text-primary">
                              Posted
                            </span>
                          </div>
                        </button>
                      )
                    }

                    if (item.type === 'survey') {
                      const survey = item.survey
                      return (
                        <button
                          key={survey.id}
                          type="button"
                          data-testid="survey-card"
                          onClick={() => navigate({ surveyId: survey.id })}
                          className="block w-full rounded-card border border-border bg-surface-panel px-5 py-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="truncate text-base font-semibold text-text-default">
                                {survey.title}
                              </h3>
                              <p className="mt-1 text-sm text-primary">
                                Survey{survey.dynamic_responses ? ' · Dynamic' : ''}
                              </p>
                            </div>
                            <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${getSurveyStatusBadgeClass(survey.status)}`}>
                              {survey.student_status === 'not_started'
                                ? getSurveyStatusLabel(survey.status)
                                : survey.student_status === 'can_update'
                                  ? 'Update'
                                  : 'Done'}
                            </span>
                          </div>
                        </button>
                      )
                    }

                    const assignment = item.assignment
                    return (
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
                    )
                  })}
                </PageStack>
              )
            ) : view === 'material' && selectedMaterial ? (
              <Card tone="panel" padding="lg">
                <div className="mb-4">
                  <p className="text-sm font-medium text-text-muted">Material</p>
                  <h2 className="mt-1 text-2xl font-semibold text-text-default">{selectedMaterial.title}</h2>
                </div>
                <RichTextViewer content={selectedMaterial.content} />
              </Card>
            ) : view === 'survey' && selectedSurvey ? (
              <StudentSurveyPanel
                surveyId={selectedSurvey.id}
                onBack={() => navigate({ surveyId: null })}
                onCompleted={() => {
                  setSurveys((current) =>
                    current.map((survey) =>
                      survey.id === selectedSurvey.id
                        ? {
                            ...survey,
                            student_status: getStudentSurveyStatus(survey, true),
                          }
                        : survey
                    )
                  )
                }}
              />
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
        showFooterClose={false}
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
