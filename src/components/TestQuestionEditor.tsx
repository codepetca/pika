'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button, Input } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import {
  defaultPointsForQuestionType,
} from '@/lib/test-questions'
import { MAX_QUIZ_OPTIONS } from '@/lib/quizzes'
import type { QuizQuestion, TestQuestionType } from '@/types'

interface Props {
  testId: string
  apiBasePath?: string
  question: QuizQuestion
  questionNumber: number
  isEditable: boolean
  onUpdated: () => void
}

type LocalQuestionState = {
  question_type: TestQuestionType
  question_text: string
  options: string[]
  correct_option: number
  points: string
  response_monospace: boolean
}

function toLocalState(question: QuizQuestion): LocalQuestionState {
  const questionType = question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
  return {
    question_type: questionType,
    question_text: question.question_text ?? '',
    options: Array.isArray(question.options) ? question.options : ['Option 1', 'Option 2'],
    correct_option:
      typeof question.correct_option === 'number' && Number.isInteger(question.correct_option) && question.correct_option >= 0
        ? question.correct_option
        : 0,
    points: String(question.points ?? defaultPointsForQuestionType(questionType)),
    response_monospace: questionType === 'open_response' && question.response_monospace === true,
  }
}

function normalizeForComparison(state: LocalQuestionState) {
  return {
    ...state,
    question_text: state.question_text.trim(),
    options: state.options.map((option) => option.trim()),
    points: Number(state.points),
  }
}

export function TestQuestionEditor({
  testId,
  apiBasePath = '/api/teacher/tests',
  question,
  questionNumber,
  isEditable,
  onUpdated,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id, disabled: !isEditable })

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  const [state, setState] = useState<LocalQuestionState>(() => toLocalState(question))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setState(toLocalState(question))
    setError('')
  }, [question])

  const isDirty = useMemo(() => {
    const current = normalizeForComparison(state)
    const baseline = normalizeForComparison(toLocalState(question))
    return JSON.stringify(current) !== JSON.stringify(baseline)
  }, [question, state])

  function updateState(partial: Partial<LocalQuestionState>) {
    setState((prev) => ({ ...prev, ...partial }))
  }

  function updateOption(index: number, value: string) {
    setState((prev) => {
      const options = [...prev.options]
      options[index] = value
      return { ...prev, options }
    })
  }

  function addOption() {
    setState((prev) => ({ ...prev, options: [...prev.options, `Option ${prev.options.length + 1}`] }))
  }

  function removeOption(index: number) {
    setState((prev) => {
      const options = prev.options.filter((_, optionIndex) => optionIndex !== index)
      const nextCorrect = Math.min(prev.correct_option, Math.max(0, options.length - 1))
      return { ...prev, options, correct_option: nextCorrect }
    })
  }

  async function handleSave() {
    if (!isEditable || saving) return

    const questionText = state.question_text.trim()
    if (!questionText) {
      setError('Question text is required')
      return
    }

    const points = Number(state.points)
    if (!Number.isFinite(points) || points <= 0) {
      setError('Points must be greater than 0')
      return
    }

    if (state.question_type === 'multiple_choice') {
      const options = state.options.map((option) => option.trim())
      if (options.length < 2) {
        setError('At least 2 options are required')
        return
      }
      if (options.length > MAX_QUIZ_OPTIONS) {
        setError(`Maximum ${MAX_QUIZ_OPTIONS} options allowed`)
        return
      }
      if (options.some((option) => !option)) {
        setError('Options cannot be empty')
        return
      }
      if (!Number.isInteger(state.correct_option) || state.correct_option < 0 || state.correct_option >= options.length) {
        setError('Select a correct option')
        return
      }
    }

    setSaving(true)
    setError('')

    try {
      const payload =
        state.question_type === 'open_response'
          ? {
              question_type: 'open_response',
              question_text: questionText,
              points,
              response_monospace: state.response_monospace,
            }
          : {
              question_type: 'multiple_choice',
              question_text: questionText,
              options: state.options.map((option) => option.trim()),
              correct_option: state.correct_option,
              points,
              response_monospace: false,
            }

      const res = await fetch(`${apiBasePath}/${testId}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update question')
      }
      onUpdated()
    } catch (saveError: any) {
      setError(saveError.message || 'Failed to update question')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEditable || deleting) return
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`${apiBasePath}/${testId}/questions/${question.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete question')
      }
      onUpdated()
    } catch (deleteError: any) {
      setError(deleteError.message || 'Failed to delete question')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`border border-border rounded-lg p-3 bg-surface ${isDragging ? 'shadow-xl scale-[1.02] z-50 border-primary opacity-90' : ''}`}
    >
      <div className="flex items-start gap-2">
        {isEditable && (
          <button
            type="button"
            className="p-0 touch-none text-text-muted hover:text-text-default cursor-grab active:cursor-grabbing mt-0.5"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <span className="text-sm font-medium text-text-muted mt-2">Q{questionNumber}.</span>

        <div className="flex-1 space-y-3">
          {isEditable ? (
            <>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_max-content] md:items-start">
                <textarea
                  value={state.question_text}
                  onChange={(event) => updateState({ question_text: event.target.value })}
                  placeholder="Question prompt"
                  disabled={saving}
                  rows={3}
                  className="w-full min-h-[88px] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                />
                <div className="w-[7ch] space-y-1">
                  <label className="block text-[11px] leading-none text-text-muted">Points</label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.25"
                    value={state.points}
                    onChange={(event) => updateState({ points: event.target.value })}
                    disabled={saving}
                    className="h-9 w-full px-2 text-sm"
                  />
                </div>
              </div>

              {state.question_type === 'multiple_choice' ? (
                <div className="space-y-2">
                  {state.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-option-${question.id}`}
                        checked={state.correct_option === index}
                        onChange={() => updateState({ correct_option: index })}
                        className="h-4 w-4"
                      />
                      <Input
                        type="text"
                        value={option}
                        onChange={(event) => updateOption(index, event.target.value)}
                        placeholder={`Option ${String.fromCharCode(65 + index)}`}
                        disabled={saving}
                        className="flex-1"
                      />
                      {state.options.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeOption(index)}
                          disabled={saving}
                          className="p-1 text-text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {state.options.length < MAX_QUIZ_OPTIONS && (
                    <Button type="button" variant="secondary" size="sm" onClick={addOption} disabled={saving} className="gap-1.5">
                      <Plus className="h-4 w-4" />
                      Add option
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={state.response_monospace}
                      onChange={(event) => updateState({ response_monospace: event.target.checked })}
                      disabled={saving}
                      className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                    />
                    Monospace input
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={deleting || saving}>
                    {deleting ? 'Deleting...' : 'Delete'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <QuestionMarkdown content={state.question_text} />
              <p className="text-xs text-text-muted">
                {state.question_type === 'open_response' ? 'Open response' : 'Multiple choice'} · {state.points} pts
              </p>
              {state.question_type === 'multiple_choice' ? (
                <ul className="space-y-1">
                  {state.options.map((option, index) => (
                    <li key={index} className="text-sm text-text-muted">
                      {String.fromCharCode(65 + index)}. {option}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-danger pl-7 mt-2">{error}</p>}
    </div>
  )
}
