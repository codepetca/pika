'use client'

import { useState } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Button, ConfirmDialog, Input } from '@/ui'
import type { QuizQuestion } from '@/types'

interface Props {
  quizId: string
  question: QuizQuestion
  questionNumber: number
  isEditable: boolean
  onUpdated: () => void
}

export function QuizQuestionEditor({ quizId, question, questionNumber, isEditable, onUpdated }: Props) {
  const [text, setText] = useState(question.question_text)
  const [options, setOptions] = useState<string[]>(question.options)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!text.trim()) {
      setError('Question text is required')
      return
    }
    if (options.length < 2) {
      setError('At least 2 options required')
      return
    }
    if (options.some((o) => !o.trim())) {
      setError('Options cannot be empty')
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/quizzes/${quizId}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: text.trim(), options }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update question')
      }
      setIsEditing(false)
      onUpdated()
    } catch (err: any) {
      setError(err.message || 'Failed to update question')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
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
      setShowDeleteConfirm(false)
    }
  }

  function handleAddOption() {
    setOptions([...options, ''])
  }

  function handleRemoveOption(index: number) {
    if (options.length <= 2) return
    setOptions(options.filter((_, i) => i !== index))
  }

  function handleOptionChange(index: number, value: string) {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  function handleCancel() {
    setText(question.question_text)
    setOptions(question.options)
    setIsEditing(false)
    setError('')
  }

  if (isEditing && isEditable) {
    return (
      <div className="border border-border rounded-lg p-3 space-y-3 bg-surface-2">
        <div className="flex items-start gap-2">
          <span className="text-sm font-medium text-text-muted mt-2">Q{questionNumber}.</span>
          <div className="flex-1">
            <Input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter question"
              disabled={saving}
              className="text-sm"
            />
          </div>
        </div>

        <div className="pl-7 space-y-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full border border-border flex items-center justify-center text-xs text-text-muted">
                {String.fromCharCode(65 + index)}
              </span>
              <Input
                type="text"
                value={option}
                onChange={(e) => handleOptionChange(index, e.target.value)}
                placeholder={`Option ${String.fromCharCode(65 + index)}`}
                disabled={saving}
                className="flex-1 text-sm"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => handleRemoveOption(index)}
                  disabled={saving}
                  className="p-1 text-text-muted hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          {options.length < 6 && (
            <button
              type="button"
              onClick={handleAddOption}
              disabled={saving}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="h-4 w-4" />
              Add option
            </button>
          )}
        </div>

        {error && <p className="text-sm text-danger pl-7">{error}</p>}

        <div className="flex gap-2 pl-7">
          <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg p-3 bg-surface">
      <div className="flex items-start gap-2">
        {isEditable && (
          <GripVertical className="h-4 w-4 text-text-muted mt-0.5 cursor-grab" />
        )}
        <span className="text-sm font-medium text-text-muted">Q{questionNumber}.</span>
        <div className="flex-1">
          <p className="text-sm text-text-default">{question.question_text}</p>
          <ul className="mt-2 space-y-1">
            {question.options.map((option, index) => (
              <li key={index} className="flex items-center gap-2 text-sm text-text-muted">
                <span className="w-5 h-5 rounded-full border border-border flex items-center justify-center text-xs">
                  {String.fromCharCode(65 + index)}
                </span>
                {option}
              </li>
            ))}
          </ul>
        </div>
        {isEditable && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="p-1 text-text-muted hover:text-text-default"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1 text-text-muted hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete question?"
        description="This action cannot be undone."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={deleting}
        isCancelDisabled={deleting}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
