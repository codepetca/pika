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
import { canActivateQuiz, canEditQuizQuestions } from '@/lib/quizzes'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { QuizQuestionEditor } from '@/components/QuizQuestionEditor'
import { TestQuestionEditor } from '@/components/TestQuestionEditor'
import { QuizResultsView } from '@/components/QuizResultsView'
import { QuizIndividualResponses } from '@/components/QuizIndividualResponses'
import { DEFAULT_MULTIPLE_CHOICE_POINTS, DEFAULT_OPEN_RESPONSE_POINTS } from '@/lib/test-questions'
import type { QuizQuestion, QuizWithStats, QuizResultsAggregate } from '@/types'

interface Props {
  quiz: QuizWithStats
  classroomId: string
  apiBasePath?: string
  onQuizUpdate: () => void
}

export function QuizDetailPanel({
  quiz,
  classroomId,
  apiBasePath = '/api/teacher/quizzes',
  onQuizUpdate,
}: Props) {
  const isTestsView = quiz.assessment_type === 'test' || apiBasePath.includes('/tests')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'questions' | 'preview' | 'results'>('questions')
  const [error, setError] = useState('')

  // Inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(quiz.title)
  const [savingTitle, setSavingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Sync editTitle when quiz changes
  useEffect(() => {
    setEditTitle(quiz.title)
    setIsEditingTitle(false)
  }, [quiz.id, quiz.title])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [isEditingTitle])

  async function handleTitleSave() {
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === quiz.title) {
      setEditTitle(quiz.title)
      setIsEditingTitle(false)
      return
    }
    setSavingTitle(true)
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update title')
      }
      setIsEditingTitle(false)
      onQuizUpdate()
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId } })
      )
    } catch (err: any) {
      setError(err.message || 'Failed to update title')
    } finally {
      setSavingTitle(false)
    }
  }

  function handleTitleCancel() {
    setEditTitle(quiz.title)
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleTitleSave()
    if (e.key === 'Escape') handleTitleCancel()
  }

  const hasResponses = quiz.stats.responded > 0
  const isEditable = canEditQuizQuestions(quiz, hasResponses)
  const [isReordering, setIsReordering] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const loadQuizDetails = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}`)
      const data = await res.json()
      setQuestions(data.questions || [])

      if (hasResponses) {
        const resultsRes = await fetch(`${apiBasePath}/${quiz.id}/results`)
        const resultsData = await resultsRes.json()
        setResults(resultsData.results || [])
      } else {
        setResults(null)
      }
    } catch (err) {
      console.error('Error loading quiz details:', err)
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, quiz.id, hasResponses])

  useEffect(() => {
    loadQuizDetails()
  }, [loadQuizDetails])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || isReordering || !isEditable) return

      const oldIndex = questions.findIndex((q) => q.id === active.id)
      const newIndex = questions.findIndex((q) => q.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(questions, oldIndex, newIndex)
      setQuestions(reordered)

      setIsReordering(true)
      try {
        const orderedIds = reordered.map((q) => q.id)
        await fetch(`${apiBasePath}/${quiz.id}/questions/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_ids: orderedIds }),
        })
      } catch (err) {
        console.error('Failed to reorder questions:', err)
        setError('Failed to save question order. Please try again.')
        loadQuizDetails()
      } finally {
        setIsReordering(false)
      }
    },
    [apiBasePath, questions, quiz.id, isReordering, isEditable, loadQuizDetails]
  )

  async function handleAddQuestion(questionType: 'multiple_choice' | 'open_response' = 'multiple_choice') {
    try {
      const createPayload = isTestsView
        ? questionType === 'open_response'
          ? {
              question_type: 'open_response',
              question_text: 'New open response question',
              points: DEFAULT_OPEN_RESPONSE_POINTS,
              response_max_chars: 5000,
            }
          : {
              question_type: 'multiple_choice',
              question_text: 'New multiple-choice question',
              options: ['Option 1', 'Option 2'],
              correct_option: 0,
              points: DEFAULT_MULTIPLE_CHOICE_POINTS,
              response_max_chars: 5000,
            }
        : {
            question_text: 'New question',
            options: ['Option 1', 'Option 2'],
          }

      const res = await fetch(`${apiBasePath}/${quiz.id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add question')
      }
      loadQuizDetails()
      onQuizUpdate()
    } catch (err: any) {
      setError(err.message || 'Failed to add question')
    }
  }

  function handleQuestionUpdated() {
    loadQuizDetails()
    onQuizUpdate()
  }

  const activation = canActivateQuiz(quiz, questions.length)

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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="p-2 bg-danger-bg text-danger text-sm rounded mb-4">{error}</div>
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
                  onBlur={handleTitleSave}
                  disabled={savingTitle}
                  className="flex-1 text-lg font-semibold text-text-default bg-transparent border-b-2 border-primary outline-none py-0.5"
                />
                <Tooltip content="Save">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 text-success"
                    onClick={handleTitleSave}
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
                {quiz.title}
              </h3>
            )}

            {hasResponses && (
              <div className="p-2 bg-warning-bg text-warning text-sm rounded">
                Questions cannot be edited after students have responded.
              </div>
            )}

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
                      testId={quiz.id}
                      apiBasePath={apiBasePath}
                      question={question}
                      questionNumber={index + 1}
                      isEditable={isEditable}
                      onUpdated={handleQuestionUpdated}
                    />
                  ) : (
                    <QuizQuestionEditor
                      key={question.id}
                      quizId={quiz.id}
                      apiBasePath={apiBasePath}
                      question={question}
                      questionNumber={index + 1}
                      isEditable={isEditable}
                      onUpdated={handleQuestionUpdated}
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

            {quiz.status === 'draft' && !activation.valid && (
              <p className="text-sm text-warning">{activation.error}</p>
            )}
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
            {hasResponses && (
              <div className="pt-4 border-t border-border">
                <QuizIndividualResponses
                  quizId={quiz.id}
                  apiBasePath={apiBasePath}
                  assessmentType={isTestsView ? 'test' : 'quiz'}
                  onUpdated={loadQuizDetails}
                />
              </div>
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
      <p className="text-xs text-text-muted italic">
        This is how students will see the quiz. Selections are not saved.
      </p>
      {questions.map((question, index) => (
        <div key={question.id} className="space-y-2">
          <p className="font-medium text-text-default">
            {index + 1}. {question.question_text}
            {isTestsView && (
              <span className="ml-1 text-xs font-normal text-text-muted">
                ({question.points ?? (question.question_type === 'open_response' ? DEFAULT_OPEN_RESPONSE_POINTS : DEFAULT_MULTIPLE_CHOICE_POINTS)} pts)
              </span>
            )}
          </p>
          {question.question_type === 'open_response' ? (
            <div className="space-y-2">
              <textarea
                value={typeof selected[question.id] === 'string' ? (selected[question.id] as string) : ''}
                onChange={(event) => setSelected((prev) => ({ ...prev, [question.id]: event.target.value }))}
                maxLength={question.response_max_chars ?? 5000}
                className="w-full min-h-[120px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Student enters response here"
              />
              <p className="text-xs text-text-muted">
                {(typeof selected[question.id] === 'string' ? (selected[question.id] as string).length : 0)}/{question.response_max_chars ?? 5000} characters
              </p>
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
