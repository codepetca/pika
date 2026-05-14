'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AssessmentSetupDialog } from '@/components/assessment/AssessmentSetupDialog'
import { AssessmentSetupCheckbox, AssessmentSetupForm } from '@/components/assessment/AssessmentSetupForm'
import type { Survey } from '@/types'

interface SurveyModalProps {
  isOpen: boolean
  classroomId: string
  survey?: Survey | null
  onClose: () => void
  onSuccess: (survey: Survey) => void
}

export function SurveyModal({
  isOpen,
  classroomId,
  survey,
  onClose,
  onSuccess,
}: SurveyModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEditMode = !!survey

  useEffect(() => {
    if (!isOpen) return
    setTitle(survey?.title ?? '')
    setShowResults(survey?.show_results ?? true)
    setDynamicResponses(survey?.dynamic_responses ?? false)
    setError('')

    setTimeout(() => {
      titleInputRef.current?.focus()
      if (survey) titleInputRef.current?.select()
    }, 100)
  }, [isOpen, survey])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch(
        isEditMode ? `/api/teacher/surveys/${survey.id}` : '/api/teacher/surveys',
        {
          method: isEditMode ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroomId,
            title: title.trim(),
            show_results: showResults,
            dynamic_responses: dynamicResponses,
          }),
        }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save survey')
      onSuccess(data.survey)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save survey')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AssessmentSetupDialog
      isOpen={isOpen}
      onClose={onClose}
      isCompact={isEditMode}
      compactMaxWidth="max-w-md"
      title={isEditMode ? 'Edit Survey' : 'New Survey'}
      titleId="survey-modal-title"
      closeLabel="Close survey modal"
      closeDisabled={saving}
    >
      <AssessmentSetupForm
        isCompact={isEditMode}
        title={title}
        titlePlaceholder="Enter survey title"
        titleError={error}
        titleInputRef={titleInputRef}
        saving={saving}
        submitLabel={isEditMode ? 'Save' : 'Create'}
        onTitleChange={setTitle}
        onCancel={onClose}
        onSubmit={handleSubmit}
      >
        <div className="space-y-3">
          <AssessmentSetupCheckbox
            checked={showResults}
            disabled={saving}
            onChange={setShowResults}
          >
            Show class results to students after they respond
          </AssessmentSetupCheckbox>

          <AssessmentSetupCheckbox
            checked={dynamicResponses}
            disabled={saving}
            onChange={setDynamicResponses}
          >
            Dynamic responses: students can update answers while open
          </AssessmentSetupCheckbox>
        </div>
      </AssessmentSetupForm>
    </AssessmentSetupDialog>
  )
}
