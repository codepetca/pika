'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { canActivateQuiz, canEditQuizQuestions } from '@/lib/quizzes'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { QuizQuestionEditor } from '@/components/QuizQuestionEditor'
import { QuizResultsView } from '@/components/QuizResultsView'
import { QuizIndividualResponses } from '@/components/QuizIndividualResponses'
import type { QuizQuestion, QuizWithStats, QuizResultsAggregate } from '@/types'

interface Props {
  quiz: QuizWithStats
  classroomId: string
  onQuizUpdate: () => void
}

export function QuizDetailPanel({ quiz, classroomId, onQuizUpdate }: Props) {
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
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}`, {
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

  const loadQuizDetails = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}`)
      const data = await res.json()
      setQuestions(data.questions || [])

      if (hasResponses) {
        const resultsRes = await fetch(`/api/teacher/quizzes/${quiz.id}/results`)
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
  }, [quiz.id, hasResponses])

  useEffect(() => {
    loadQuizDetails()
  }, [loadQuizDetails])

  async function handleAddQuestion() {
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text: 'New question',
          options: ['Option 1', 'Option 2'],
        }),
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

            {questions.map((question, index) => (
              <QuizQuestionEditor
                key={question.id}
                quizId={quiz.id}
                question={question}
                questionNumber={index + 1}
                isEditable={isEditable}
                onUpdated={handleQuestionUpdated}
              />
            ))}

            {questions.length === 0 && (
              <p className="text-sm text-text-muted py-4 text-center">
                No questions yet. Add one to get started.
              </p>
            )}

            {isEditable && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddQuestion}
                className="w-full gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Add Question
              </Button>
            )}

            {quiz.status === 'draft' && !activation.valid && (
              <p className="text-sm text-warning">{activation.error}</p>
            )}
          </div>
        ) : viewMode === 'preview' ? (
          <QuizPreview questions={questions} />
        ) : (
          <div className="space-y-6">
            <QuizResultsView results={results} />
            {hasResponses && (
              <div className="pt-4 border-t border-border">
                <QuizIndividualResponses quizId={quiz.id} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Read-only preview of the quiz as students see it */
function QuizPreview({ questions }: { questions: QuizQuestion[] }) {
  const [selected, setSelected] = useState<Record<string, number>>({})

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
          </p>
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
        </div>
      ))}
    </div>
  )
}
