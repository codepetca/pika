'use client'

import { useState, useRef, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Input } from '@/ui'
import type { QuizQuestion } from '@/types'

const MAX_QUIZ_OPTIONS = 6

interface Props {
  quizId: string
  question: QuizQuestion
  questionNumber: number
  isEditable: boolean
  onUpdated: () => void
}

export function QuizQuestionEditor({ quizId, question, questionNumber, isEditable, onUpdated }: Props) {
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
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const newOptionRef = useRef<HTMLInputElement>(null)
  const justAddedOption = useRef(false)

  // Sync local state when question prop changes (e.g. after save/reorder)
  useEffect(() => {
    setText(question.question_text)
    setOptions(question.options)
  }, [question.question_text, question.options])

  // Focus newly added option
  useEffect(() => {
    if (justAddedOption.current && newOptionRef.current) {
      newOptionRef.current.focus()
      justAddedOption.current = false
    }
  })

  async function handleSave(currentText: string, currentOptions: string[]) {
    // Filter out empty options that were just added
    const cleanedOptions = currentOptions.filter((o) => o.trim())

    if (!currentText.trim()) return
    if (cleanedOptions.length < 2) return

    // Check if anything actually changed
    if (
      currentText.trim() === question.question_text &&
      cleanedOptions.length === question.options.length &&
      cleanedOptions.every((o, i) => o === question.options[i])
    ) {
      // If options were cleaned (empty removed), update local state
      if (cleanedOptions.length !== currentOptions.length) {
        setOptions(cleanedOptions)
      }
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/quizzes/${quizId}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: currentText.trim(), options: cleanedOptions }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update question')
      }
      onUpdated()
    } catch (err: any) {
      setError(err.message || 'Failed to update question')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/quizzes/${quizId}/questions/${question.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete question')
      }
      onUpdated()
    } catch (err: any) {
      setError(err.message || 'Failed to delete question')
    } finally {
      setDeleting(false)
    }
  }

  function handleAddOption() {
    const newOptions = [...options, '']
    setOptions(newOptions)
    justAddedOption.current = true
    setFocusedField(newOptions.length - 1)
  }

  function handleOptionChange(index: number, value: string) {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  function handleTextBlur() {
    setFocusedField(null)
    handleSave(text, options)
  }

  function handleOptionBlur(index: number) {
    setFocusedField(null)
    const opt = options[index]
    // If the option is empty and was newly added (beyond original count), remove it
    if (!opt.trim() && index >= question.options.length) {
      const newOptions = options.filter((_, i) => i !== index)
      setOptions(newOptions)
      // Don't save — just discard the empty new option
      return
    }
    handleSave(text, options)
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
              disabled={saving}
              className="text-sm"
              autoFocus
            />
          ) : (
            <p
              className={`text-sm text-text-default ${isEditable ? 'cursor-text hover:bg-surface-2 rounded px-1 -mx-1' : ''}`}
              onClick={isEditable ? () => setFocusedField('text') : undefined}
            >
              {text}
            </p>
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
                    disabled={saving}
                    className="flex-1 text-sm"
                    autoFocus
                  />
                ) : (
                  <span
                    className={`text-sm text-text-muted flex-1 ${isEditable ? 'cursor-text hover:bg-surface-2 rounded px-1 -mx-1' : ''}`}
                    onClick={isEditable ? () => setFocusedField(index) : undefined}
                  >
                    {option || <span className="italic text-text-disabled">Empty option</span>}
                  </span>
                )}
              </div>
            ))}
          </div>

          {isEditable && options.length < MAX_QUIZ_OPTIONS && (
            <button
              type="button"
              onClick={handleAddOption}
              disabled={saving}
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
            onClick={handleDelete}
            disabled={deleting}
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
