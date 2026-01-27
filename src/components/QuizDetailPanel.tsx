'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Play, Square, Eye, EyeOff } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { getQuizStatusLabel, getQuizStatusBadgeClass, canActivateQuiz } from '@/lib/quizzes'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { QuizQuestionEditor } from '@/components/QuizQuestionEditor'
import { QuizResultsView } from '@/components/QuizResultsView'
import type { Quiz, QuizQuestion, QuizWithStats, QuizResultsAggregate } from '@/types'

interface Props {
  quiz: QuizWithStats
  classroomId: string
  onQuizUpdate: () => void
  onDelete: () => void
}

export function QuizDetailPanel({ quiz, classroomId, onQuizUpdate, onDelete }: Props) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [responders, setResponders] = useState<{ student_id: string; name: string | null; email: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [viewMode, setViewMode] = useState<'questions' | 'results'>('questions')
  const [error, setError] = useState('')

  const loadQuizDetails = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}`)
      const data = await res.json()
      setQuestions(data.questions || [])

      // Also load results if quiz has responses
      if (quiz.stats.responded > 0) {
        const resultsRes = await fetch(`/api/teacher/quizzes/${quiz.id}/results`)
        const resultsData = await resultsRes.json()
        setResults(resultsData.results || [])
        setResponders(resultsData.responders || [])
      } else {
        setResults(null)
        setResponders([])
      }
    } catch (err) {
      console.error('Error loading quiz details:', err)
    } finally {
      setLoading(false)
    }
  }, [quiz.id, quiz.stats.responded])

  useEffect(() => {
    loadQuizDetails()
  }, [loadQuizDetails])

  async function handleStatusChange(newStatus: 'active' | 'closed') {
    setUpdating(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update quiz')
      }
      onQuizUpdate()
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId } })
      )
    } catch (err: any) {
      setError(err.message || 'Failed to update quiz')
    } finally {
      setUpdating(false)
      setShowActivateConfirm(false)
      setShowCloseConfirm(false)
    }
  }

  async function handleToggleShowResults() {
    setUpdating(true)
    try {
      const res = await fetch(`/api/teacher/quizzes/${quiz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_results: !quiz.show_results }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update quiz')
      }
      onQuizUpdate()
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId } })
      )
    } catch (err: any) {
      setError(err.message || 'Failed to update quiz')
    } finally {
      setUpdating(false)
    }
  }

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
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-default">{quiz.title}</h3>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getQuizStatusBadgeClass(quiz.status)}`}
          >
            {getQuizStatusLabel(quiz.status)}
          </span>
          <span className="text-sm text-text-muted">
            {quiz.stats.responded}/{quiz.stats.total_students} responded
          </span>
        </div>
      </div>

      {error && (
        <div className="p-2 bg-danger-bg text-danger text-sm rounded">{error}</div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {quiz.status === 'draft' && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowActivateConfirm(true)}
            disabled={!activation.valid || updating}
            className="gap-1.5"
          >
            <Play className="h-4 w-4" />
            Activate
          </Button>
        )}
        {quiz.status === 'active' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowCloseConfirm(true)}
            disabled={updating}
            className="gap-1.5"
          >
            <Square className="h-4 w-4" />
            Close
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleShowResults}
          disabled={updating}
          className="gap-1.5"
        >
          {quiz.show_results ? (
            <>
              <EyeOff className="h-4 w-4" />
              Hide Results
            </>
          ) : (
            <>
              <Eye className="h-4 w-4" />
              Show Results
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={updating}
          className="gap-1.5 text-danger hover:bg-danger-bg"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* View Toggle */}
      {quiz.stats.responded > 0 && (
        <div className="flex border-b border-border">
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
      )}

      {/* Content */}
      {viewMode === 'questions' ? (
        <div className="space-y-3">
          {questions.map((question, index) => (
            <QuizQuestionEditor
              key={question.id}
              quizId={quiz.id}
              question={question}
              questionNumber={index + 1}
              isEditable={quiz.status === 'draft'}
              onUpdated={handleQuestionUpdated}
            />
          ))}

          {questions.length === 0 && (
            <p className="text-sm text-text-muted py-4 text-center">
              No questions yet. Add one to get started.
            </p>
          )}

          {quiz.status === 'draft' && (
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
      ) : (
        <QuizResultsView results={results} responders={responders} />
      )}

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showActivateConfirm}
        title="Activate quiz?"
        description="Once activated, students will be able to respond. You won't be able to add or modify questions."
        confirmLabel={updating ? 'Activating...' : 'Activate'}
        cancelLabel="Cancel"
        isConfirmDisabled={updating}
        isCancelDisabled={updating}
        onCancel={() => setShowActivateConfirm(false)}
        onConfirm={() => handleStatusChange('active')}
      />

      <ConfirmDialog
        isOpen={showCloseConfirm}
        title="Close quiz?"
        description="Students will no longer be able to respond. Students who haven't responded won't be able to see this quiz."
        confirmLabel={updating ? 'Closing...' : 'Close'}
        cancelLabel="Cancel"
        isConfirmDisabled={updating}
        isCancelDisabled={updating}
        onCancel={() => setShowCloseConfirm(false)}
        onConfirm={() => handleStatusChange('closed')}
      />
    </div>
  )
}
