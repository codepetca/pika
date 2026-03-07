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
  question: QuizQuestion
  questionNumber: number
  isEditable: boolean
  onChange: (question: QuizQuestion, options?: { force?: boolean }) => void
  onDelete: (questionId: string) => void
}

type LocalQuestionState = {
  question_type: TestQuestionType
  question_text: string
  options: string[]
  correct_option: number
  points: string
  response_monospace: boolean
  answer_key: string
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
    answer_key:
      questionType === 'open_response' && typeof question.answer_key === 'string'
        ? question.answer_key
        : '',
  }
}

function normalizeForComparison(state: LocalQuestionState) {
  return {
    ...state,
    question_text: state.question_text.trim(),
    options: state.options.map((option) => option.trim()),
    points: Number(state.points),
    answer_key: state.answer_key.trim(),
  }
}

export function TestQuestionEditor({
  question,
  questionNumber,
  isEditable,
  onChange,
  onDelete,
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
  const [error, setError] = useState('')
  const [isAnswerSectionOpen, setIsAnswerSectionOpen] = useState(false)
  const codeToggleId = `question-${question.id}-code-toggle`

  useEffect(() => {
    setState(toLocalState(question))
    setError('')
    setIsAnswerSectionOpen(false)
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

  function handleSave(options?: { force?: boolean }) {
    if (!isEditable) return

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
      const nextOptions = state.options.map((option) => option.trim())
      if (nextOptions.length < 2) {
        setError('At least 2 options are required')
        return
      }
      if (nextOptions.length > MAX_QUIZ_OPTIONS) {
        setError(`Maximum ${MAX_QUIZ_OPTIONS} options allowed`)
        return
      }
      if (nextOptions.some((option) => !option)) {
        setError('Options cannot be empty')
        return
      }
      if (!Number.isInteger(state.correct_option) || state.correct_option < 0 || state.correct_option >= nextOptions.length) {
        setError('Select a correct option')
        return
      }

      setError('')
      onChange(
        {
          ...question,
          question_type: 'multiple_choice',
          question_text: questionText,
          options: nextOptions,
          correct_option: state.correct_option,
          answer_key: null,
          points,
          response_monospace: false,
        },
        { force: options?.force === true }
      )
      return
    }

    setError('')
    onChange(
      {
        ...question,
        question_type: 'open_response',
        question_text: questionText,
        options: [],
        correct_option: null,
        answer_key: state.answer_key.trim() ? state.answer_key.trim() : null,
        points,
        response_monospace: state.response_monospace,
      },
      { force: options?.force === true }
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`border border-border rounded-lg p-3 bg-surface ${isDragging ? 'shadow-xl scale-[1.02] z-50 border-primary opacity-90' : ''}`}
    >
      <div className="grid gap-2 md:grid-cols-[16px_24px_minmax(0,1fr)_112px] md:gap-x-0">
        <div className="flex items-center justify-start md:self-center">
          {isEditable ? (
            <button
              type="button"
              className="p-0 touch-none text-text-muted hover:text-text-default cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : (
            <GripVertical className="h-4 w-4 text-text-muted" aria-hidden="true" />
          )}
        </div>

        <div className="flex items-start justify-start pt-1">
          <span className="text-sm font-medium text-text-muted">Q{questionNumber}</span>
        </div>

        <div className="space-y-3 md:ml-2">
          {isEditable ? (
            <>
              <textarea
                value={state.question_text}
                onChange={(event) => updateState({ question_text: event.target.value })}
                onBlur={() => handleSave()}
                placeholder="Question prompt"
                rows={3}
                className="w-full min-h-[88px] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
              />

              {state.question_type === 'multiple_choice' ? (
                <div className="space-y-2">
                  {state.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-option-${question.id}`}
                        checked={state.correct_option === index}
                        onChange={() => {
                          updateState({ correct_option: index })
                          setTimeout(() => handleSave(), 0)
                        }}
                        className="h-4 w-4"
                      />
                      <Input
                        type="text"
                        value={option}
                        onChange={(event) => updateOption(index, event.target.value)}
                        onBlur={() => handleSave()}
                        placeholder={`Option ${String.fromCharCode(65 + index)}`}
                        className="flex-1"
                      />
                      {state.options.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            removeOption(index)
                            setTimeout(() => handleSave(), 0)
                          }}
                          className="p-1 text-text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {state.options.length < MAX_QUIZ_OPTIONS && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={addOption}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Option
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setIsAnswerSectionOpen((prev) => !prev)}
                    className="w-full text-left text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-default"
                  >
                    {isAnswerSectionOpen
                      ? 'Hide Answer Key'
                      : state.answer_key.trim()
                      ? 'Answer Key Added'
                      : 'Add Answer Key'}
                  </button>
                  {isAnswerSectionOpen ? (
                    <textarea
                      value={state.answer_key}
                      onChange={(event) => updateState({ answer_key: event.target.value })}
                      onBlur={() => handleSave()}
                      placeholder="Enter an optional answer key for AI-assisted grading..."
                      rows={4}
                      className="w-full min-h-[96px] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  ) : null}
                </div>
              )}
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

        {isEditable ? (
          <div className="w-full min-w-0 space-y-2 rounded-md border border-border bg-surface-2 p-2.5 md:self-start">
            <div className="grid min-w-0 grid-cols-[1fr_52px] items-center gap-2">
              <label className="text-[11px] font-medium uppercase tracking-wide leading-none text-text-muted">
                Points
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={state.points}
                onChange={(event) => updateState({ points: event.target.value })}
                onBlur={() => handleSave()}
                className="h-8 min-w-0 w-full px-2 text-sm"
              />
            </div>

            {state.question_type === 'open_response' ? (
              <div className="grid min-w-0 grid-cols-[1fr_52px] items-center gap-2">
                <label htmlFor={codeToggleId} className="text-[11px] font-medium uppercase tracking-wide leading-none text-text-muted">
                  Code
                </label>
                <div className="flex h-8 items-center justify-start">
                  <input
                    id={codeToggleId}
                    type="checkbox"
                    checked={state.response_monospace}
                    onChange={(event) => {
                      updateState({ response_monospace: event.target.checked })
                      setTimeout(() => handleSave(), 0)
                    }}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-2 pt-1">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => handleSave({ force: true })}
                disabled={!isDirty}
                className="w-full min-w-0 px-2"
              >
                Save
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => onDelete(question.id)}
                className="w-full min-w-0 px-2"
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div />
        )}
      </div>

      {error && <p className="text-sm text-danger pl-7 mt-2">{error}</p>}
    </div>
  )
}
