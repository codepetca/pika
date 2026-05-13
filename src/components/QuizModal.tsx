'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AssessmentSetupDialog } from '@/components/assessment/AssessmentSetupDialog'
import { Button, FormField, Input } from '@/ui'
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
    <AssessmentSetupDialog
      isOpen={isOpen}
      onClose={onClose}
      isCompact={isEditMode}
      title={isEditMode ? `Edit ${assessmentLabel}` : `New ${assessmentLabel}`}
      titleId="quiz-modal-title"
      closeLabel={`Close ${assessmentLabel.toLowerCase()} modal`}
      closeDisabled={saving}
    >
      <form
        onSubmit={handleSubmit}
        className={
          isEditMode
            ? 'space-y-4 flex-1 min-h-0 overflow-y-auto'
            : 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'
        }
      >
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
    </AssessmentSetupDialog>
  )
}
