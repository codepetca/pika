'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button, DialogPanel, FormField, Input } from '@/ui'
import type { Quiz, QuizAssessmentType } from '@/types'

interface QuizModalProps {
  isOpen: boolean
  classroomId: string
  assessmentType?: QuizAssessmentType
  apiBasePath?: string
  quiz?: Quiz | null
  onClose: () => void
  onSuccess: (quiz: Quiz) => void
}

export function QuizModal({
  isOpen,
  classroomId,
  assessmentType = 'quiz',
  apiBasePath = '/api/teacher/quizzes',
  quiz,
  onClose,
  onSuccess,
}: QuizModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEditMode = !!quiz
  const isTest = (quiz?.assessment_type ?? assessmentType) === 'test'
  const assessmentLabel = isTest ? 'Test' : 'Quiz'
  const fullViewportPanelClass =
    '!h-[calc(100dvh-0.5rem)] !max-h-[calc(100dvh-0.5rem)] !w-[calc(100vw-0.5rem)] !max-w-[calc(100vw-0.5rem)] overflow-hidden p-0 sm:!h-[calc(100dvh-1rem)] sm:!max-h-[calc(100dvh-1rem)] sm:!w-[calc(100vw-1rem)] sm:!max-w-[calc(100vw-1rem)]'

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
        const response = await fetch(`${apiBasePath}/${quiz.id}`, {
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
        const response = await fetch(apiBasePath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroomId,
            title: title.trim(),
            assessment_type: assessmentType,
          }),
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
      maxWidth={isEditMode ? 'max-w-xs' : 'max-w-none'}
      className={isEditMode ? 'p-6' : fullViewportPanelClass}
      viewportPaddingClassName={isEditMode ? undefined : 'p-1 sm:p-2'}
      ariaLabelledBy="quiz-modal-title"
    >
      <div className={isEditMode ? '' : 'flex min-h-0 flex-1 flex-col'}>
        <div className={isEditMode ? 'mb-4 flex flex-shrink-0 items-start gap-3' : 'flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3'}>
          <h2 id="quiz-modal-title" className="min-w-0 flex-1 truncate text-xl font-bold text-text-default">
            {isEditMode ? `Edit ${assessmentLabel}` : `New ${assessmentLabel}`}
          </h2>
          <Button
            type="button"
            variant="surface"
            size="sm"
            className="h-10 w-10 flex-shrink-0 px-0"
            onClick={onClose}
            disabled={saving}
            aria-label={`Close ${assessmentLabel.toLowerCase()} modal`}
            title="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className={isEditMode ? 'space-y-4 flex-1 min-h-0 overflow-y-auto' : 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'}>
          <FormField label="Title" error={error}>
            <Input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Enter ${assessmentLabel.toLowerCase()} title`}
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

          <div className={isEditMode ? 'flex gap-3 pt-2' : 'mt-auto flex justify-end gap-3 border-t border-border pt-4'}>
            <Button
              type="button"
              variant="secondary"
              className={isEditMode ? 'flex-1' : 'min-w-28'}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className={isEditMode ? 'flex-1' : 'min-w-28'} disabled={saving}>
              {saving ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </DialogPanel>
  )
}
