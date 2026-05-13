'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button, DialogPanel, FormField, Input } from '@/ui'
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
    <DialogPanel
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-md"
      className="p-6"
      ariaLabelledBy="survey-modal-title"
    >
      <div className="mb-4 flex items-start gap-3">
        <h2 id="survey-modal-title" className="min-w-0 flex-1 truncate text-xl font-bold text-text-default">
          {isEditMode ? 'Edit Survey' : 'New Survey'}
        </h2>
        <Button
          type="button"
          variant="surface"
          size="sm"
          className="h-10 w-10 flex-shrink-0 px-0"
          onClick={onClose}
          disabled={saving}
          aria-label="Close survey modal"
          title="Close"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
