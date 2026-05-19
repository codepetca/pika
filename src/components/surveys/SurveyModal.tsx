'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AssessmentSetupDialog } from '@/components/assessment/AssessmentSetupDialog'
import { AssessmentSetupCheckbox, AssessmentSetupForm } from '@/components/assessment/AssessmentSetupForm'
import type { Survey } from '@/types'

interface SurveyModalProps {
  isOpen: boolean
  survey: Survey
  onClose: () => void
  onSuccess: (survey: Survey) => void
}

export function SurveyModal({
  isOpen,
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

  useEffect(() => {
    if (!isOpen) return
    setTitle(survey.title)
    setShowResults(survey.show_results)
    setDynamicResponses(survey.dynamic_responses)
    setError('')

    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
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
      const response = await fetch(`/api/teacher/surveys/${survey.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          show_results: showResults,
          dynamic_responses: dynamicResponses,
        }),
      })
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
      isCompact
      compactMaxWidth="max-w-md"
      title="Edit Survey"
      titleId="survey-modal-title"
      closeLabel="Close survey modal"
      closeDisabled={saving}
    >
      <AssessmentSetupForm
        isCompact
        title={title}
        titlePlaceholder="Enter survey title"
        titleError={error}
        titleInputRef={titleInputRef}
        saving={saving}
        submitLabel="Save"
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
            Show class results to students
          </AssessmentSetupCheckbox>

          <AssessmentSetupCheckbox
            checked={dynamicResponses}
            disabled={saving}
            onChange={setDynamicResponses}
          >
            Allow students to update answers while open
          </AssessmentSetupCheckbox>
        </div>
      </AssessmentSetupForm>
    </AssessmentSetupDialog>
  )
}
