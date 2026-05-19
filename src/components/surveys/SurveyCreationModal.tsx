'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AssessmentSetupCheckbox } from '@/components/assessment/AssessmentSetupForm'
import { CreationModalShell, CreationModalTopRow } from '@/components/creation/CreationModalShell'
import { Button } from '@/ui'
import type { Survey } from '@/types'

interface SurveyCreationModalProps {
  isOpen: boolean
  classroomId: string
  onClose: () => void
  onSuccess: (survey: Survey) => void
}

export function SurveyCreationModal({
  isOpen,
  classroomId,
  onClose,
  onSuccess,
}: SurveyCreationModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setTitle('')
    setShowResults(true)
    setDynamicResponses(false)
    setError('')

    setTimeout(() => {
      titleInputRef.current?.focus()
    }, 100)
  }, [isOpen])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch('/api/teacher/surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroomId,
          title: title.trim(),
          show_results: showResults,
          dynamic_responses: dynamicResponses,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to create survey')
      onSuccess(data.survey as Survey)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create survey')
    } finally {
      setSaving(false)
    }
  }

  return (
    <CreationModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="New Survey"
      titleId="survey-create-modal-title"
      closeLabel="Close survey modal"
      closeDisabled={saving}
      maxWidth="!max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <CreationModalTopRow
          title={title}
          titlePlaceholder="Enter survey title"
          titleError={error}
          titleDisabled={saving}
          titleInputRef={titleInputRef}
          onTitleChange={setTitle}
          actions={(
            <Button
              type="submit"
              variant="primary"
              className="w-[5.75rem] justify-center font-semibold"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Create'}
            </Button>
          )}
        />

        <div className="max-w-xl space-y-3">
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
      </form>
    </CreationModalShell>
  )
}
