'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AssessmentSetupDialog } from '@/components/assessment/AssessmentSetupDialog'
import { AssessmentSetupCheckbox, AssessmentSetupForm } from '@/components/assessment/AssessmentSetupForm'
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
      <AssessmentSetupForm
        isCompact={isEditMode}
        title={title}
        titlePlaceholder={`Enter ${assessmentLabel.toLowerCase()} title`}
        titleError={error}
        titleInputRef={titleInputRef}
        saving={saving}
        submitLabel={isEditMode ? 'Save' : 'Create'}
        onTitleChange={setTitle}
        onCancel={onClose}
        onSubmit={handleSubmit}
      >
        {isEditMode && (
          <AssessmentSetupCheckbox
            checked={showResults}
            disabled={saving}
            onChange={setShowResults}
          >
            Show results to students after responding
          </AssessmentSetupCheckbox>
        )}
      </AssessmentSetupForm>
    </AssessmentSetupDialog>
  )
}
