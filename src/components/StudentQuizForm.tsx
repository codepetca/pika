'use client'

import { useState } from 'react'
import { Button, ConfirmDialog } from '@/ui'
import type { QuizQuestion } from '@/types'

interface Props {
  quizId: string
  questions: QuizQuestion[]
  apiBasePath?: string
  onSubmitted: () => void
}

export function StudentQuizForm({
  quizId,
  questions,
  apiBasePath = '/api/student/quizzes',
  onSubmitted,
}: Props) {
  const [responses, setResponses] = useState<Record<string, number>>({})
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const allAnswered = questions.every((q) => responses[q.id] !== undefined)

  function handleOptionSelect(questionId: string, optionIndex: number) {
    setResponses((prev) => ({ ...prev, [questionId]: optionIndex }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(`${apiBasePath}/${quizId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit response')
      }
      onSubmitted()
    } catch (err: any) {
      setError(err.message || 'Failed to submit response')
    } finally {
      setSubmitting(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className="mt-4 space-y-6">
      {questions.map((question, index) => (
        <div key={question.id} className="space-y-2">
          <p className="font-medium text-text-default">
            {index + 1}. {question.question_text}
          </p>
          <div className="space-y-2">
            {question.options.map((option, optionIndex) => {
              const isSelected = responses[question.id] === optionIndex

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
                    name={`question-${question.id}`}
                    checked={isSelected}
                    onChange={() => handleOptionSelect(question.id, optionIndex)}
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

      {error && (
        <div className="p-3 bg-danger-bg text-danger text-sm rounded-lg">{error}</div>
      )}

      <div className="pt-4">
        <Button
          onClick={() => setShowConfirm(true)}
          disabled={!allAnswered || submitting}
          className="w-full"
        >
          Submit
        </Button>
        {!allAnswered && (
          <p className="text-sm text-text-muted text-center mt-2">
            Answer all questions to submit
          </p>
        )}
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
        title="Submit your answers?"
        description="You cannot change your answers after submitting."
        confirmLabel={submitting ? 'Submitting...' : 'Submit'}
        cancelLabel="Cancel"
        isConfirmDisabled={submitting}
        isCancelDisabled={submitting}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleSubmit}
      />
    </div>
  )
}
