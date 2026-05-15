'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code, Plus, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { QuizModal } from '@/components/QuizModal'
import { QuizCard } from '@/components/QuizCard'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import { TeacherWorkItemList } from '@/components/teacher-work-surface/TeacherWorkItemList'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { Button, DialogPanel, EmptyState, Tooltip } from '@/ui'
import type {
  AssessmentEditorSummaryUpdate,
  Classroom,
  Quiz,
  QuizAssessmentType,
  QuizWithStats,
} from '@/types'

type UpdateSearchOptions = {
  replace?: boolean
}

type UpdateSearchParamsFn = (
  updater: (params: URLSearchParams) => void,
  options?: UpdateSearchOptions,
) => void

interface Props {
  classroom: Classroom
  assessmentType?: QuizAssessmentType
  selectedQuizId?: string | null
  updateSearchParams?: UpdateSearchParamsFn
  onSelectQuiz?: (quiz: QuizWithStats | null) => void
  onRequestDelete?: () => void
}

export function TeacherQuizzesTab({
  classroom,
  selectedQuizId: selectedQuizIdProp,
  updateSearchParams,
  onSelectQuiz,
  onRequestDelete,
}: Props) {
  const apiBasePath = '/api/teacher/quizzes'
  const isReadOnly = !!classroom.archived_at

  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [internalSelectedQuizId, setInternalSelectedQuizId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [quizEditModalView, setQuizEditModalView] = useState<'edit' | 'markdown'>('edit')
  const [hasPendingMarkdownImport, setHasPendingMarkdownImport] = useState(false)
  const [pendingCreatedQuizId, setPendingCreatedQuizId] = useState<string | null>(null)
  const [selectedQuizDraftSummary, setSelectedQuizDraftSummary] =
    useState<AssessmentEditorSummaryUpdate | null>(null)

  const selectedQuizId =
    selectedQuizIdProp !== undefined ? selectedQuizIdProp : internalSelectedQuizId

  const selectedQuiz = useMemo(
    () => quizzes.find((quiz) => quiz.id === selectedQuizId) ?? null,
    [quizzes, selectedQuizId],
  )

  const selectedQuizWorkspace = useMemo(() => {
    if (!selectedQuiz) return null
    if (!selectedQuizDraftSummary) return selectedQuiz

    return {
      ...selectedQuiz,
      title: selectedQuizDraftSummary.title,
      show_results: selectedQuizDraftSummary.show_results,
      stats: {
        ...selectedQuiz.stats,
        questions_count: selectedQuizDraftSummary.questions_count,
      },
    }
  }, [selectedQuiz, selectedQuizDraftSummary])

  const applyQuizSummaryPatch = useCallback((quizId: string, update: AssessmentEditorSummaryUpdate) => {
    setQuizzes((prev) =>
      prev.map((quiz) => {
        if (quiz.id !== quizId) return quiz

        return {
          ...quiz,
          title: typeof update.title === 'string' ? update.title : quiz.title,
          show_results: typeof update.show_results === 'boolean' ? update.show_results : quiz.show_results,
          stats: {
            ...quiz.stats,
            questions_count:
              typeof update.questions_count === 'number' ? update.questions_count : quiz.stats.questions_count,
          },
        }
      }),
    )
  }, [])

  const navigateQuizWorkspace = useCallback((
    nextQuizId: string | null,
    options?: UpdateSearchOptions,
  ) => {
    setInternalSelectedQuizId(nextQuizId)

    updateSearchParams?.((params) => {
      params.set('tab', 'quizzes')
      if (nextQuizId) {
        params.set('quizId', nextQuizId)
      } else {
        params.delete('quizId')
      }
      params.delete('testId')
      params.delete('testMode')
      params.delete('testStudentId')
    }, options)
  }, [updateSearchParams])

  const clearQuizWorkspace = useCallback((options?: UpdateSearchOptions) => {
    navigateQuizWorkspace(null, options)
  }, [navigateQuizWorkspace])

  const loadQuizzes = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ classroom_id: classroom.id })
      const response = await fetch(`${apiBasePath}?${query.toString()}`)
      const data = await response.json()
      setQuizzes(data.quizzes || [])
    } catch (error) {
      console.error('Error loading quizzes:', error)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    void loadQuizzes()
  }, [loadQuizzes])

  useEffect(() => {
    function handleQuizzesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (!detail || detail.classroomId !== classroom.id) return
      void loadQuizzes()
    }

    window.addEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleQuizzesUpdated)
    return () => window.removeEventListener(TEACHER_QUIZZES_UPDATED_EVENT, handleQuizzesUpdated)
  }, [classroom.id, loadQuizzes])

  useEffect(() => {
    onSelectQuiz?.(selectedQuizWorkspace)
  }, [onSelectQuiz, selectedQuizWorkspace])

  useEffect(() => {
    if (!selectedQuizId || loading) return
    if (quizzes.some((quiz) => quiz.id === selectedQuizId)) return

    clearQuizWorkspace({ replace: true })
  }, [clearQuizWorkspace, loading, quizzes, selectedQuizId])

  useEffect(() => {
    setSelectedQuizDraftSummary(null)
  }, [selectedQuizId])

  useEffect(() => {
    if (!pendingCreatedQuizId) return
    if (!quizzes.some((quiz) => quiz.id === pendingCreatedQuizId)) return

    navigateQuizWorkspace(pendingCreatedQuizId)
    setQuizEditModalView('edit')
    setHasPendingMarkdownImport(false)
    setShowEditModal(true)
    setPendingCreatedQuizId(null)
  }, [navigateQuizWorkspace, pendingCreatedQuizId, quizzes])

  function handleCardSelect(quiz: QuizWithStats) {
    navigateQuizWorkspace(quiz.id)
  }

  function closeEditModal() {
    setShowEditModal(false)
    setQuizEditModalView('edit')
    setHasPendingMarkdownImport(false)
  }

  function handleNewQuiz() {
    setShowModal(true)
  }

  function handleQuizCreated(quiz: Quiz) {
    setShowModal(false)
    setPendingCreatedQuizId(quiz.id)
    window.dispatchEvent(
      new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } }),
    )
  }

  const primaryContent = selectedQuizWorkspace ? (
    <TeacherWorkSurfaceActionBar
      center={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setQuizEditModalView('edit')
              setHasPendingMarkdownImport(false)
              setShowEditModal(true)
            }}
            disabled={isReadOnly}
          >
            Edit Quiz
          </Button>
          {onRequestDelete ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={onRequestDelete}
              disabled={isReadOnly}
            >
              <Trash2 className="h-4 w-4" />
              Delete Quiz
            </Button>
          ) : null}
        </div>
      }
      centerPlacement="floating"
    />
  ) : (
    <TeacherWorkSurfaceActionBar
      center={
        <Tooltip content="Create a new quiz">
          <Button
            onClick={handleNewQuiz}
            variant="primary"
            size="sm"
            className="gap-1.5"
            disabled={isReadOnly}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New
          </Button>
        </Tooltip>
      }
      centerPlacement="floating"
    />
  )

  const summaryContent = loading ? (
    <div className="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : quizzes.length === 0 ? (
    <EmptyState
      title="No quizzes yet"
      description="Create a quiz to get started."
      tone="muted"
      className="mx-auto w-full max-w-3xl"
    />
  ) : (
    <TeacherWorkItemList>
      {quizzes.map((quiz) => (
        <QuizCard
          key={quiz.id}
          quiz={quiz}
          apiBasePath={apiBasePath}
          isSelected={selectedQuizId === quiz.id}
          isReadOnly={isReadOnly}
          onSelect={() => handleCardSelect(quiz)}
          onQuizUpdate={() => {
            void loadQuizzes()
          }}
        />
      ))}
    </TeacherWorkItemList>
  )

  const workspaceContent = selectedQuizWorkspace ? (
    <QuizDetailPanel
      quiz={selectedQuizWorkspace}
      classroomId={classroom.id}
      apiBasePath={apiBasePath}
      onDraftSummaryChange={setSelectedQuizDraftSummary}
      onQuizUpdate={(update) => {
        if (update) {
          setSelectedQuizDraftSummary(update)
          applyQuizSummaryPatch(selectedQuizWorkspace.id, update)
          return
        }
        void loadQuizzes()
      }}
      onRequestDelete={onRequestDelete}
      showInlineDeleteAction={false}
    />
  ) : (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  )

  return (
    <>
      <TeacherWorkSurfaceShell
        state={selectedQuizId ? 'workspace' : 'summary'}
        primary={primaryContent}
        summary={summaryContent}
        workspace={workspaceContent}
        workspaceFrame="standalone"
        workspaceFrameClassName="min-h-[360px] border-0 bg-page"
      />

      <QuizModal
        isOpen={showModal}
        classroomId={classroom.id}
        assessmentType="quiz"
        apiBasePath={apiBasePath}
        quiz={null}
        onClose={() => setShowModal(false)}
        onSuccess={handleQuizCreated}
      />

      <DialogPanel
        isOpen={showEditModal && !!selectedQuizWorkspace}
        onClose={closeEditModal}
        ariaLabelledBy="quiz-edit-title"
        maxWidth="max-w-6xl"
        className="h-[85vh] overflow-hidden p-0"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 id="quiz-edit-title" className="min-w-0 basis-full truncate text-base font-semibold text-text-default sm:basis-auto sm:flex-1">
            {selectedQuizWorkspace ? `Edit ${selectedQuizWorkspace.title}` : 'Edit quiz'}
          </h2>
          <Tooltip content="Markdown view">
            <Button
              type="button"
              variant={quizEditModalView === 'markdown' ? 'subtle' : 'secondary'}
              size="sm"
              aria-pressed={quizEditModalView === 'markdown'}
              className="gap-1.5"
              onClick={() => {
                setQuizEditModalView((current) => (current === 'markdown' ? 'edit' : 'markdown'))
              }}
            >
              <Code className="h-4 w-4" aria-hidden="true" />
              <span>Code</span>
            </Button>
          </Tooltip>
          {hasPendingMarkdownImport ? (
            <span className="text-xs font-medium text-warning">Markdown edits not applied</span>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={closeEditModal}
          >
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedQuizWorkspace ? (
            <QuizDetailPanel
              quiz={selectedQuizWorkspace}
              classroomId={classroom.id}
              apiBasePath={apiBasePath}
              onDraftSummaryChange={setSelectedQuizDraftSummary}
              onQuizUpdate={(update) => {
                if (update) {
                  setSelectedQuizDraftSummary(update)
                  applyQuizSummaryPatch(selectedQuizWorkspace.id, update)
                  return
                }
                void loadQuizzes()
              }}
              onPendingMarkdownImportChange={setHasPendingMarkdownImport}
              showInlineDeleteAction={false}
              assessmentQuestionLayout={quizEditModalView === 'markdown' ? 'markdown-only' : 'editor-only'}
              showPreviewButton={false}
              showResultsTab={false}
            />
          ) : null}
        </div>
      </DialogPanel>
    </>
  )
}
