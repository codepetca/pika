'use client'

import { useState, useRef, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Input } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { MAX_QUIZ_OPTIONS, validateQuizOptions } from '@/lib/quizzes'
import type { QuizQuestion } from '@/types'

interface Props {
  question: QuizQuestion
  questionNumber: number
  isEditable: boolean
  onChange: (question: QuizQuestion) => void
  onDelete: (questionId: string) => void
}

export function QuizQuestionEditor({
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

  const [text, setText] = useState(question.question_text)
  const [options, setOptions] = useState<string[]>(question.options)
  const [focusedField, setFocusedField] = useState<'text' | number | null>(null)
  const [error, setError] = useState('')

  const newOptionRef = useRef<HTMLInputElement>(null)
  const justAddedOption = useRef(false)

  useEffect(() => {
    setText(question.question_text)
    setOptions(question.options)
    setError('')
  }, [question.question_text, question.options])

  useEffect(() => {
    if (justAddedOption.current && newOptionRef.current) {
      newOptionRef.current.focus()
      justAddedOption.current = false
    }
  })

  function handleCommit(currentText: string, currentOptions: string[]) {
    const trimmedText = currentText.trim()
    if (!trimmedText) {
      setError('Question text is required')
      return
    }

    const cleanedOptions = currentOptions.map((option) => option.trim()).filter(Boolean)
    const optionsValidation = validateQuizOptions(cleanedOptions)
    if (!optionsValidation.valid) {
      setError(optionsValidation.error || 'Invalid options')
      return
    }

    if (
      trimmedText === question.question_text &&
      cleanedOptions.length === question.options.length &&
      cleanedOptions.every((option, index) => option === question.options[index])
    ) {
      if (cleanedOptions.length !== currentOptions.length) {
        setOptions(cleanedOptions)
      }
      setError('')
      return
    }

    setError('')
    setOptions(cleanedOptions)
    onChange({
      ...question,
      question_text: trimmedText,
      options: cleanedOptions,
    })
  }

  function handleAddOption() {
    if (!isEditable || options.length >= MAX_QUIZ_OPTIONS) return
    const nextOptions = [...options, '']
    setOptions(nextOptions)
    justAddedOption.current = true
    setFocusedField(nextOptions.length - 1)
  }

  function handleOptionChange(index: number, value: string) {
    const nextOptions = [...options]
    nextOptions[index] = value
    setOptions(nextOptions)
  }

  function handleTextBlur() {
    setFocusedField(null)
    handleCommit(text, options)
  }

  function handleOptionBlur(index: number) {
    setFocusedField(null)
    const option = options[index]
    if (!option.trim() && index >= question.options.length) {
      setOptions(options.filter((_, optionIndex) => optionIndex !== index))
      return
    }
    handleCommit(text, options)
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
        <span className="text-sm font-medium text-text-muted mt-0.5">Q{questionNumber}.</span>
        <div className="flex-1">
          {isEditable && focusedField === 'text' ? (
            <Input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={handleTextBlur}
              placeholder="Enter question"
              className="text-sm"
              autoFocus
            />
          ) : isEditable ? (
            <p
              className="text-sm text-text-default cursor-text hover:bg-surface-2 rounded px-1 -mx-1"
              onClick={() => setFocusedField('text')}
            >
              {text}
            </p>
          ) : (
            <QuestionMarkdown content={text} />
          )}

          <div className="mt-2 space-y-1">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full border border-border flex items-center justify-center text-xs text-text-muted">
                  {String.fromCharCode(65 + index)}
                </span>
                {isEditable && focusedField === index ? (
                  <Input
                    ref={index === options.length - 1 ? newOptionRef : undefined}
                    type="text"
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    onBlur={() => handleOptionBlur(index)}
                    placeholder={`Option ${String.fromCharCode(65 + index)}`}
                    className="flex-1 text-sm"
                    autoFocus
                  />
                ) : (
                  <span
                    className={`text-sm text-text-muted flex-1 ${isEditable ? 'cursor-text hover:bg-surface-2 rounded px-1 -mx-1' : ''}`}
                    onClick={isEditable ? () => setFocusedField(index) : undefined}
                  >
                    {option || <span className="italic text-text-muted">Empty option</span>}
                  </span>
                )}
              </div>
            ))}
          </div>

          {isEditable && options.length < MAX_QUIZ_OPTIONS && (
            <button
              type="button"
              onClick={handleAddOption}
              className="flex items-center gap-1 text-sm text-primary hover:underline mt-2"
            >
              <Plus className="h-4 w-4" />
              Add option
            </button>
          )}
        </div>

        {isEditable && (
          <button
            type="button"
            onClick={() => onDelete(question.id)}
            className="p-1 text-text-muted hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && <p className="text-sm text-danger pl-7 mt-1">{error}</p>}
    </div>
  )
}
