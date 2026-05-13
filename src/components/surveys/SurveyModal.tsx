'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AssessmentSetupDialog } from '@/components/assessment/AssessmentSetupDialog'
import { Button, FormField, Input } from '@/ui'
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
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Enter survey title"
            disabled={saving}
          />
        </FormField>

        <div className={isEditMode ? 'space-y-3' : 'rounded-lg border border-border bg-surface-2 p-4'}>
          <div className="space-y-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={showResults}
                onChange={(event) => setShowResults(event.target.checked)}
                disabled={saving}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-text-default">Show class results to students after they respond</span>
            </label>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={dynamicResponses}
                onChange={(event) => setDynamicResponses(event.target.checked)}
                disabled={saving}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-text-default">Dynamic responses: students can update answers while open</span>
            </label>
          </div>
        </div>

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
