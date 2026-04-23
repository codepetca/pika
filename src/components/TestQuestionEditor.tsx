'use client'

import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, Copy, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button, Input } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { defaultPointsForQuestionType } from '@/lib/test-questions'
import { MAX_QUIZ_OPTIONS } from '@/lib/quizzes'
import type { QuizQuestion, TestQuestionType } from '@/types'

interface Props {
  question: QuizQuestion
  questionNumber: number
  isEditable: boolean
  onChange: (question: QuizQuestion, options?: { force?: boolean }) => void
  onDelete: (questionId: string) => void
  onDuplicate?: (questionId: string) => void
  variant?: 'card' | 'detail' | 'accordion'
  isExpanded?: boolean
  onToggleExpanded?: () => void
}

type LocalQuestionState = {
  question_type: TestQuestionType
  question_text: string
  options: string[]
  correct_option: number
  points: string
  response_monospace: boolean
  answer_key: string
  sample_solution: string
}

function summarizeHeaderLine(questionText: string | null | undefined): string {
  const firstMeaningfulLine =
    (questionText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''

  const flattened = firstMeaningfulLine.replace(/[#>*_`~-]/g, ' ').replace(/\s+/g, ' ').trim()
  return flattened || 'Untitled question'
}

function toLocalState(question: QuizQuestion): LocalQuestionState {
  const questionType = question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
  return {
    question_type: questionType,
    question_text: question.question_text ?? '',
    options: Array.isArray(question.options) ? question.options : ['Option 1', 'Option 2'],
    correct_option:
      typeof question.correct_option === 'number' &&
      Number.isInteger(question.correct_option) &&
      question.correct_option >= 0
        ? question.correct_option
        : 0,
    points: String(question.points ?? defaultPointsForQuestionType(questionType)),
    response_monospace: questionType === 'open_response' && question.response_monospace === true,
    answer_key:
      questionType === 'open_response' && typeof question.answer_key === 'string'
        ? question.answer_key
        : '',
    sample_solution:
      questionType === 'open_response' && typeof question.sample_solution === 'string'
        ? question.sample_solution
        : '',
  }
}

export function TestQuestionEditor({
  question,
  questionNumber,
  isEditable,
  onChange,
  onDelete,
  onDuplicate,
  variant = 'card',
  isExpanded = true,
  onToggleExpanded,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
    disabled: !isEditable,
  })

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  const [state, setState] = useState<LocalQuestionState>(() => toLocalState(question))
  const [error, setError] = useState('')
  const [isAnswerSectionOpen, setIsAnswerSectionOpen] = useState(variant !== 'card')
  const codeToggleId = `question-${question.id}-code-toggle`
  const toggleLabel = `${isExpanded ? 'Collapse' : 'Expand'} question ${questionNumber}`
  const questionPlaceholder = `Question ${questionNumber}`
  const pointsLabel = `${Number.parseInt(state.points, 10) || question.points || defaultPointsForQuestionType(state.question_type)} pts`
  const collapsedSummary = summarizeHeaderLine(state.question_text)

  useEffect(() => {
    setState(toLocalState(question))
    setError('')
    setIsAnswerSectionOpen(variant !== 'card')
  }, [question, variant])

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
      if (
        !Number.isInteger(state.correct_option) ||
        state.correct_option < 0 ||
        state.correct_option >= nextOptions.length
      ) {
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
          sample_solution: null,
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
        sample_solution: state.sample_solution.trim() ? state.sample_solution.trim() : null,
        points,
        response_monospace: state.response_monospace,
      },
      { force: options?.force === true }
    )
  }

  const multipleChoiceEditor = state.question_type === 'multiple_choice' ? (
    <div
      className={
        variant === 'accordion'
          ? 'space-y-2 border-t border-border bg-surface-2 px-4 py-4'
          : 'space-y-2 rounded-md border border-border bg-surface-2 px-4 py-4'
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Answer Options</p>
      {state.options.map((option, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="radio"
            name={`correct-option-${question.id}`}
            checked={state.correct_option === index}
            disabled={!isEditable}
            onChange={() => {
              updateState({ correct_option: index })
              setTimeout(() => handleSave(), 0)
            }}
            className="h-4 w-4"
          />
          {isEditable ? (
            <Input
              type="text"
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              onBlur={() => handleSave()}
              placeholder={`Option ${String.fromCharCode(65 + index)}`}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default">
              {option}
            </div>
          )}
          {isEditable && state.options.length > 2 ? (
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
          ) : null}
        </div>
      ))}
      {isEditable && state.options.length < MAX_QUIZ_OPTIONS ? (
        <Button type="button" variant="secondary" size="sm" onClick={addOption} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Option
        </Button>
      ) : null}
    </div>
  ) : null

  const openResponseEditor =
    state.question_type === 'open_response' ? (
      <div
        data-testid={`question-${question.id}-answer-section`}
        className={
          variant === 'accordion'
            ? 'border-t border-border bg-surface p-px'
            : 'space-y-3 rounded-md border border-border bg-surface-2 px-4 py-4'
        }
      >
        <div
          className={
            variant === 'accordion'
              ? 'space-y-3 rounded-md bg-surface-2 px-4 py-4'
              : ''
          }
        >
          {variant === 'card' && isEditable ? (
            <button
              type="button"
              onClick={() => setIsAnswerSectionOpen((prev) => !prev)}
              className="w-full text-left text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-default"
            >
              {isAnswerSectionOpen
                ? 'Hide Grading Notes'
                : state.answer_key.trim() || state.sample_solution.trim()
                  ? 'Grading Notes Added'
                  : 'Add Grading Notes'}
            </button>
          ) : (
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Answer Key</p>
          )}

          {variant !== 'card' || isAnswerSectionOpen ? (
            <div className="space-y-3">
              {variant === 'card' && isEditable ? null : (
                <div>
                  {variant !== 'card' ? null : (
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Answer Key</p>
                  )}
                  {isEditable ? (
                    <textarea
                      value={state.answer_key}
                      onChange={(event) => updateState({ answer_key: event.target.value })}
                      onBlur={() => handleSave()}
                      placeholder="Enter an optional answer key for AI-assisted grading..."
                      rows={4}
                      className="w-full min-h-[96px] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  ) : (
                    <div className="min-h-[96px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default whitespace-pre-wrap">
                      {state.answer_key || 'No answer key provided.'}
                    </div>
                  )}
                </div>
              )}

              {variant === 'card' && isEditable ? (
                <>
                  <textarea
                    value={state.answer_key}
                    onChange={(event) => updateState({ answer_key: event.target.value })}
                    onBlur={() => handleSave()}
                    placeholder="Enter an optional answer key for AI-assisted grading..."
                    rows={4}
                    className="w-full min-h-[96px] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <textarea
                    value={state.sample_solution}
                    onChange={(event) => updateState({ sample_solution: event.target.value })}
                    onBlur={() => handleSave()}
                    placeholder="Optional sample solution. Coding sample solutions will be shown to students when the returned test is released."
                    rows={6}
                    className="w-full min-h-[128px] resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm leading-6 text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </>
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sample Solution</p>
                  {isEditable ? (
                    <textarea
                      value={state.sample_solution}
                      onChange={(event) => updateState({ sample_solution: event.target.value })}
                      onBlur={() => handleSave()}
                      placeholder="Optional sample solution. Coding sample solutions will be shown to students when the returned test is released."
                      rows={6}
                      className="w-full min-h-[128px] resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm leading-6 text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  ) : (
                    <div className="min-h-[128px] rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm leading-6 text-text-default whitespace-pre-wrap">
                      {state.sample_solution || 'No sample solution provided.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    ) : null

  if (variant === 'detail' && isEditable) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            <span>Q{questionNumber}</span>
            <span aria-hidden="true">•</span>
            <span>{state.question_type === 'open_response' ? 'Open Response' : 'Multiple Choice'}</span>
          </div>
        </div>

        <textarea
          value={state.question_text}
          onChange={(event) => updateState({ question_text: event.target.value })}
          onBlur={() => handleSave()}
          placeholder={questionPlaceholder}
          rows={5}
          className="w-full min-h-[144px] resize-y rounded-md border border-border bg-surface px-4 py-3 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
        />

        {multipleChoiceEditor}
        {openResponseEditor}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    )
  }

  if (variant === 'accordion') {
    return (
      <div
        ref={setNodeRef}
        style={sortableStyle}
        className={`rounded-lg border border-border bg-surface ${isDragging ? 'z-50 border-primary opacity-90 shadow-xl' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-2 px-3 py-3">
          <div className="flex min-h-8 items-center">
            {isEditable ? (
              <button
                type="button"
                className="cursor-grab touch-none p-0 text-text-muted hover:text-text-default active:cursor-grabbing"
                {...attributes}
                {...listeners}
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            ) : (
              <span className="text-xs font-semibold text-text-muted">Q{questionNumber}</span>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
            aria-label={toggleLabel}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="text-text-muted">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            {isEditable ? (
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Q{questionNumber}</span>
            ) : null}
            {state.question_type === 'multiple_choice' ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                MC
              </span>
            ) : null}
            {!isExpanded ? (
              <span
                data-testid={`question-${question.id}-collapsed-summary`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-text-default"
              >
                {collapsedSummary}
              </span>
            ) : null}
          </button>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {isEditable ? (
              <>
                <label
                  htmlFor={`question-${question.id}-accordion-points`}
                  className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                >
                  <span>Pts</span>
                  <Input
                    id={`question-${question.id}-accordion-points`}
                    type="number"
                    min="1"
                    step="1"
                    value={state.points}
                    aria-label={`Question ${questionNumber} points`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateState({ points: event.target.value })}
                    onBlur={() => handleSave()}
                    className="h-8 w-16 px-2 text-sm"
                  />
                </label>
                {state.question_type === 'open_response' ? (
                  <label
                    htmlFor={`${codeToggleId}-accordion`}
                    className="inline-flex items-center gap-2 text-sm text-text-default"
                  >
                    <input
                      id={`${codeToggleId}-accordion`}
                      type="checkbox"
                      checked={state.response_monospace}
                      aria-label={`Question ${questionNumber} code response`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        updateState({ response_monospace: event.target.checked })
                        setTimeout(() => handleSave(), 0)
                      }}
                      className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                    />
                    <span>Code</span>
                  </label>
                ) : null}
              </>
            ) : (
              <>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {pointsLabel}
                </span>
                {state.question_type === 'open_response' && state.response_monospace ? (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Code
                  </span>
                ) : null}
              </>
            )}

            {isEditable ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Duplicate question ${questionNumber}`}
                  className="h-8 w-8 shrink-0 p-0 text-text-muted hover:text-text-default"
                  onClick={() => onDuplicate?.(question.id)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete question ${questionNumber}`}
                  className="h-8 w-8 shrink-0 p-0 text-text-muted hover:text-danger"
                  onClick={() => onDelete(question.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {isExpanded ? (
          <div className="space-y-0 border-t border-border">
            {isEditable ? (
              <>
                <div className="bg-surface">
                  <textarea
                    value={state.question_text}
                    onChange={(event) => updateState({ question_text: event.target.value })}
                    onBlur={() => handleSave()}
                    placeholder={questionPlaceholder}
                    rows={4}
                    className="block w-full min-h-[112px] resize-y border-0 bg-surface px-4 py-4 text-sm text-text-default placeholder:text-text-muted focus:outline-none focus:ring-0"
                  />
                </div>
                {multipleChoiceEditor}
                {openResponseEditor}
              </>
            ) : (
              <>
                <div className="bg-surface">
                  <QuestionMarkdown content={state.question_text} className="px-4 py-4" />
                </div>
                {multipleChoiceEditor}
                {openResponseEditor}
              </>
            )}

            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`rounded-lg border border-border bg-surface p-3 ${isDragging ? 'z-50 scale-[1.02] border-primary opacity-90 shadow-xl' : ''}`}
    >
      <div className="grid gap-2 md:grid-cols-[16px_24px_minmax(0,1fr)_112px] md:gap-x-0">
        <div className="flex items-center justify-start md:self-center">
          {isEditable ? (
            <button
              type="button"
              className="cursor-grab touch-none p-0 text-text-muted hover:text-text-default active:cursor-grabbing"
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
                placeholder={questionPlaceholder}
                rows={3}
                className="w-full min-h-[88px] resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {multipleChoiceEditor}
              {openResponseEditor}
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
              <label className="text-[11px] font-medium uppercase leading-none tracking-wide text-text-muted">
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
                <label
                  htmlFor={codeToggleId}
                  className="text-[11px] font-medium uppercase leading-none tracking-wide text-text-muted"
                >
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
        ) : (
          <div />
        )}
      </div>

      {error ? <p className="mt-2 pl-7 text-sm text-danger">{error}</p> : null}
    </div>
  )
}
