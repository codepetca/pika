'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, DialogPanel, FormField, Input } from '@/ui'
import type { Quiz } from '@/types'

interface QuizModalProps {
  isOpen: boolean
  classroomId: string
  quiz?: Quiz | null
  onClose: () => void
  onSuccess: (quiz: Quiz) => void
}

export function QuizModal({ isOpen, classroomId, quiz, onClose, onSuccess }: QuizModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEditMode = !!quiz

  useEffect(() => {
    if (!isOpen) return

    if (quiz) {
      setTitle(quiz.title)
      setShowResults(quiz.show_results)
    } else {
      setTitle('')
      setShowResults(false)
    }
    setError('')

    setTimeout(() => {
      titleInputRef.current?.focus()
      if (quiz) {
        titleInputRef.current?.select()
      }
    }, 100)
  }, [isOpen, quiz])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      if (isEditMode) {
        const response = await fetch(`/api/teacher/quizzes/${quiz.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), show_results: showResults }),
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to update quiz')
        }
        onSuccess(data.quiz)
      } else {
        const response = await fetch('/api/teacher/quizzes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classroom_id: classroomId, title: title.trim() }),
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to create quiz')
        }
        onSuccess(data.quiz)
      }
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="w-[min(90vw,28rem)]"
      className="p-6"
    >
      <h2 id="quiz-modal-title" className="text-xl font-bold text-text-default mb-4 flex-shrink-0">
        {isEditMode ? 'Edit Quiz' : 'New Quiz'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4 flex-1 min-h-0 overflow-y-auto">
        <FormField label="Title" error={error}>
          <Input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter quiz title"
            disabled={saving}
          />
        </FormField>

        {isEditMode && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showResults}
              onChange={(e) => setShowResults(e.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-default">Show results to students after responding</span>
          </label>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={saving}>
            {saving ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </DialogPanel>
  )
}
