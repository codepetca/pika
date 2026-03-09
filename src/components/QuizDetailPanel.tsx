'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Check, Plus, X } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { canEditQuizQuestions } from '@/lib/quizzes'
import { QuizQuestionEditor } from '@/components/QuizQuestionEditor'
import { TestQuestionEditor } from '@/components/TestQuestionEditor'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'
import { QuizResultsView } from '@/components/QuizResultsView'
import { QuizIndividualResponses } from '@/components/QuizIndividualResponses'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { DEFAULT_MULTIPLE_CHOICE_POINTS, DEFAULT_OPEN_RESPONSE_POINTS } from '@/lib/test-questions'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { useDraftMode } from '@/hooks/useDraftMode'
import type {
  QuizQuestion,
  QuizWithStats,
  QuizResultsAggregate,
  TestDocument,
} from '@/types'

interface Props {
  quiz: QuizWithStats
  classroomId: string
  apiBasePath?: string
  onQuizUpdate: () => void
  onRequestDelete?: () => void
}

export function QuizDetailPanel({
  quiz,
  classroomId,
  apiBasePath = '/api/teacher/quizzes',
  onQuizUpdate,
  onRequestDelete,
}: Props) {
  void classroomId
  const isTestsView = quiz.assessment_type === 'test' || apiBasePath.includes('/tests')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [documents, setDocuments] = useState<TestDocument[]>(
    () => normalizeTestDocuments((quiz as { documents?: unknown }).documents)
  )
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'questions' | 'documents' | 'preview' | 'results'>('questions')
  const [error, setError] = useState('')

  // titleInputRef stays in the component — it's bound directly to the JSX <input>
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Draft autosave logic extracted to a hook
  const {
    editTitle,
    setEditTitle,
    isEditingTitle,
    setIsEditingTitle,
    savingTitle,
    saveStatus,
    conflictDraft,
    pendingDraftRef,
    applyServerDraft,
    saveDraft,
    scheduleSave,
    scheduleAutosave,
    handleTitleSave,
  } = useDraftMode({
    quizId: quiz.id,
    quizTitle: quiz.title,
    showResults: quiz.show_results,
    apiBasePath,
    onUpdate: onQuizUpdate,
    onError: setError,
    onQuestionsChange: setQuestions,
  })

  const normalizeQuestionPositions = useCallback((nextQuestions: QuizQuestion[]): QuizQuestion[] => {
    return nextQuestions.map((question, index) => ({ ...question, position: index }))
  }, [])

  useEffect(() => {
    setDocuments(normalizeTestDocuments((quiz as { documents?: unknown }).documents))
  }, [quiz])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [isEditingTitle])

  const hasResponses = quiz.stats.responded > 0
  const isEditable = canEditQuizQuestions(quiz, hasResponses)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )


  const loadQuizDetails = useCallback(async () => {
    setLoading(true)
    try {
      const draftRes = await fetch(`${apiBasePath}/${quiz.id}/draft`)
      const draftData = await draftRes.json()
      if (!draftRes.ok) {
        throw new Error(draftData.error || 'Failed to load assessment draft')
      }

      const normalizedDraft = draftData?.draft?.content
        ? draftData.draft
        : {
            version: 1,
            content: {
              title: quiz.title,
              show_results: quiz.show_results,
              questions: Array.isArray(draftData?.questions) ? draftData.questions : [],
            },
          }

      applyServerDraft(normalizedDraft)

      if (isTestsView) {
        const detailRes = await fetch(`${apiBasePath}/${quiz.id}`)
        if (detailRes?.ok) {
          const detailData = await detailRes.json()
          setDocuments(normalizeTestDocuments(detailData?.quiz?.documents))
        }
      }

      if (hasResponses) {
        const resultsRes = await fetch(`${apiBasePath}/${quiz.id}/results`)
        const resultsData = await resultsRes.json()
        setResults(resultsData.results || [])
      } else {
        setResults(null)
      }
    } catch (err: any) {
      console.error('Error loading quiz details:', err)
      setError(err?.message || 'Failed to load assessment details')
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, applyServerDraft, hasResponses, isTestsView, quiz.id, quiz.show_results, quiz.title])

  useEffect(() => {
    loadQuizDetails()
  }, [loadQuizDetails])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !isEditable) return

      const oldIndex = questions.findIndex((q) => q.id === active.id)
      const newIndex = questions.findIndex((q) => q.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = normalizeQuestionPositions(arrayMove(questions, oldIndex, newIndex))
      setQuestions(reordered)

      scheduleAutosave({
        title: editTitle,
        show_results: quiz.show_results,
        questions: reordered,
      })
    },
    [editTitle, isEditable, normalizeQuestionPositions, questions, quiz.show_results, scheduleAutosave]
  )

  function handleTitleCancel() {
    const fallbackTitle = pendingDraftRef.current?.title || quiz.title
    setEditTitle(fallbackTitle)
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleTitleSave(questions)
    if (e.key === 'Escape') handleTitleCancel()
  }

  function handleAddQuestion(questionType: 'multiple_choice' | 'open_response' = 'multiple_choice') {
    if (!isEditable) return

    const nextQuestion: QuizQuestion = isTestsView
      ? questionType === 'open_response'
        ? {
            id: crypto.randomUUID(),
            quiz_id: quiz.id,
            question_type: 'open_response',
            question_text: '',
            options: [],
            correct_option: null,
            answer_key: null,
            points: DEFAULT_OPEN_RESPONSE_POINTS,
            response_max_chars: 5000,
            response_monospace: false,
            position: questions.length,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : {
            id: crypto.randomUUID(),
            quiz_id: quiz.id,
            question_type: 'multiple_choice',
            question_text: '',
            options: ['Option 1', 'Option 2'],
            correct_option: 0,
            answer_key: null,
            points: DEFAULT_MULTIPLE_CHOICE_POINTS,
            response_max_chars: 5000,
            response_monospace: false,
            position: questions.length,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
      : {
          id: crypto.randomUUID(),
          quiz_id: quiz.id,
          question_text: 'New question',
          options: ['Option 1', 'Option 2'],
          position: questions.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

    const nextQuestions = normalizeQuestionPositions([...questions, nextQuestion])
    setQuestions(nextQuestions)

    scheduleAutosave({
      title: editTitle,
      show_results: quiz.show_results,
      questions: nextQuestions,
    })
  }

  function handleQuestionChange(updatedQuestion: QuizQuestion, options?: { force?: boolean }) {
    const nextQuestions = normalizeQuestionPositions(
      questions.map((question) =>
        question.id === updatedQuestion.id ? { ...updatedQuestion } : question
      )
    )
    setQuestions(nextQuestions)

    const nextDraft = {
      title: editTitle,
      show_results: quiz.show_results,
      questions: nextQuestions,
    }

    if (options?.force) {
      scheduleSave(nextDraft, { force: true })
      return
    }

    scheduleAutosave(nextDraft)
  }

  function handleQuestionDelete(questionId: string) {
    const nextQuestions = normalizeQuestionPositions(
      questions.filter((question) => question.id !== questionId)
    )
    setQuestions(nextQuestions)

    scheduleAutosave({
      title: editTitle,
      show_results: quiz.show_results,
      questions: nextQuestions,
    })
  }

  function handleConflictReload() {
    if (!conflictDraft) return
    applyServerDraft({
      version: conflictDraft.version,
      content: conflictDraft.content,
    })
  }

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => setViewMode('questions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'questions'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default'
          }`}
        >
          Questions ({questions.length})
        </button>
        {isTestsView && (
          <button
            type="button"
            onClick={() => setViewMode('documents')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              viewMode === 'documents'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-default'
            }`}
          >
            Documents ({documents.length})
          </button>
        )}
        <button
          type="button"
          onClick={() => setViewMode('preview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'preview'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default'
          }`}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setViewMode('results')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            viewMode === 'results'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default'
          }`}
        >
          Results ({quiz.stats.responded})
        </button>
        {isTestsView && onRequestDelete ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onRequestDelete}
            className="ml-auto mr-3 h-8 self-center px-3 font-semibold"
          >
            Delete Test
          </Button>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="p-2 bg-danger-bg text-danger text-sm rounded mb-4">{error}</div>
        )}
        {conflictDraft && (
          <div className="p-2 border border-warning rounded bg-warning-bg text-warning text-sm mb-4 flex items-center justify-between gap-2">
            <span>Draft conflict detected. Load the latest saved draft before continuing.</span>
            <Button size="sm" variant="secondary" onClick={handleConflictReload}>
              Load Latest
            </Button>
          </div>
        )}

        {viewMode === 'questions' ? (
          <div className="space-y-3">
            {/* Inline editable title */}
            {isEditingTitle ? (
              <div className="flex items-center gap-1">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={() => void handleTitleSave(questions)}
                  disabled={savingTitle}
                  className="flex-1 text-lg font-semibold text-text-default bg-transparent border-b-2 border-primary outline-none py-0.5"
                />
                <Tooltip content="Save">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 text-success"
                    onClick={() => void handleTitleSave(questions)}
                    disabled={savingTitle}
                    aria-label="Save title"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </Tooltip>
                <Tooltip content="Cancel">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1"
                    onClick={handleTitleCancel}
                    disabled={savingTitle}
                    aria-label="Cancel editing"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <h3
                className="text-lg font-semibold text-text-default cursor-pointer hover:text-primary transition-colors"
                onClick={() => setIsEditingTitle(true)}
                title="Click to rename"
              >
                {editTitle}
              </h3>
            )}
            <div className="text-xs text-text-muted">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={questions.map((q) => q.id)}
                strategy={verticalListSortingStrategy}
              >
                {questions.map((question, index) => (
                  isTestsView ? (
                    <TestQuestionEditor
                      key={question.id}
                      question={question}
                      questionNumber={index + 1}
                      isEditable={isEditable}
                      onChange={handleQuestionChange}
                      onDelete={handleQuestionDelete}
                    />
                  ) : (
                    <QuizQuestionEditor
                      key={question.id}
                      question={question}
                      questionNumber={index + 1}
                      isEditable={isEditable}
                      onChange={handleQuestionChange}
                      onDelete={handleQuestionDelete}
                    />
                  )
                ))}
              </SortableContext>
            </DndContext>

            {isEditable && (
              isTestsView ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleAddQuestion('multiple_choice')}
                    className="w-full gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add MC Question
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleAddQuestion('open_response')}
                    className="w-full gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add Open Question
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAddQuestion('multiple_choice')}
                  className="w-full gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Question
                </Button>
              )
            )}

          </div>
        ) : viewMode === 'documents' && isTestsView ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-text-default">Documents</h3>
            <TestDocumentsEditor
              testId={quiz.id}
              documents={documents}
              apiBasePath={apiBasePath}
              isEditable={isEditable}
              onUpdated={loadQuizDetails}
            />
          </div>
        ) : viewMode === 'preview' ? (
          <QuizPreview questions={questions} isTestsView={isTestsView} />
        ) : (
          <div className="space-y-6">
            {!isTestsView && <QuizResultsView results={results} />}
            {isTestsView && (
              <div>
                <h4 className="text-sm font-semibold text-text-default mb-2">Multiple-choice distribution</h4>
                <QuizResultsView results={results} />
              </div>
            )}
            {hasResponses && !isTestsView && (
              <div className="pt-4 border-t border-border">
                <QuizIndividualResponses
                  quizId={quiz.id}
                  apiBasePath={apiBasePath}
                  assessmentType={isTestsView ? 'test' : 'quiz'}
                  onUpdated={loadQuizDetails}
                />
              </div>
            )}
            {hasResponses && isTestsView && (
              <p className="pt-4 text-xs text-text-muted border-t border-border">
                Use Grading mode to review individual student responses.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Read-only preview of the quiz as students see it */
function QuizPreview({ questions, isTestsView }: { questions: QuizQuestion[]; isTestsView: boolean }) {
  const [selected, setSelected] = useState<Record<string, number | string>>({})

  if (questions.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4 text-center">
        No questions to preview.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {!isTestsView && (
        <p className="text-xs text-text-muted italic">
          This is how students will see the quiz. Selections are not saved.
        </p>
      )}
      {questions.map((question, index) => (
        <div key={question.id} className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Q{index + 1}
              {isTestsView && (
                <span className="ml-1 font-normal normal-case tracking-normal">
                  ({question.points ?? (question.question_type === 'open_response' ? DEFAULT_OPEN_RESPONSE_POINTS : DEFAULT_MULTIPLE_CHOICE_POINTS)} pts)
                </span>
              )}
            </p>
            <QuestionMarkdown content={question.question_text} />
          </div>
          {question.question_type === 'open_response' ? (
            <div className="space-y-2">
              <textarea
                value={typeof selected[question.id] === 'string' ? (selected[question.id] as string) : ''}
                onChange={(event) => setSelected((prev) => ({ ...prev, [question.id]: event.target.value }))}
                maxLength={question.response_max_chars ?? 5000}
                className={`w-full min-h-[120px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary ${
                  question.response_monospace ? 'font-mono leading-6' : ''
                }`}
                style={question.response_monospace ? { tabSize: 4 } : undefined}
                placeholder="Student enters response here"
              />
            </div>
          ) : (
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => {
                const isSelected = selected[question.id] === optionIndex
                return (
                  <label
                    key={optionIndex}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`preview-${question.id}`}
                      checked={isSelected}
                      onChange={() => setSelected((prev) => ({ ...prev, [question.id]: optionIndex }))}
                      className="sr-only"
                    />
                    <span
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-primary' : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </span>
                    <span className="text-text-default">{option}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
