'use client'

import { useEffect, useState } from 'react'
import type { GradebookAssessmentColumn, GradebookCategory } from '@/types'
import { Button, ContentDialog, FormField, Input, Select } from '@/ui'
import { editedAssessmentCourseWeight, isValidGradebookWeight } from '@/lib/gradebook-editor'

export function GradebookAssessmentEditor({
  isOpen,
  assessment,
  assessments,
  categories,
  onClose,
  onSave,
  isSaving = false,
  error,
}: {
  isOpen: boolean
  assessment: GradebookAssessmentColumn | null
  assessments: GradebookAssessmentColumn[]
  categories: GradebookCategory[]
  onClose: () => void
  onSave: (title: string, categoryId: string | null, weight: number) => void | Promise<void>
  isSaving?: boolean
  error?: string
}) {
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [weight, setWeight] = useState(10)
  const weightIsValid = isValidGradebookWeight(weight)

  useEffect(() => {
    if (!isOpen || !assessment) return
    setTitle(assessment.title)
    setCategoryId(assessment.category_id ?? '')
    setWeight(assessment.weight)
  }, [assessment, isOpen])

  const selectedCategory = categories.find((category) => category.id === categoryId) || null
  const courseWeight = assessment ? editedAssessmentCourseWeight(
    assessment, assessments, selectedCategory?.id ?? null, selectedCategory?.percentage ?? null, weight,
  ) : null

  const normalizedTitle = title.trim()
  const reservedTitles = assessments
    .filter((candidate) => candidate.assessment_id !== assessment?.assessment_id || candidate.assessment_type !== assessment?.assessment_type)
    .map((candidate) => candidate.title)
  const titleIsUnique = normalizedTitle === assessment?.title.trim() || !reservedTitles.some((candidate) => (
    candidate.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase()
  ))
  const valid = normalizedTitle.length > 0
    && titleIsUnique
    && weightIsValid

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={isSaving ? () => undefined : onClose}
      title="Edit assessment"
      maxWidth="sm:max-w-md"
      showFooterClose={false}
    >
      {assessment ? (
        <fieldset disabled={isSaving} className="min-w-0 space-y-3">
          <FormField label="Assessment title" required>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>

          <FormField label="Category">
            <Select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              options={[
                { value: '', label: 'None' },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
          </FormField>

          <FormField label="Category weight" error={weightIsValid ? undefined : 'Enter a whole number from 1 to 999.'}>
            <Input
              type="number"
              min={1}
              max={999}
              step={1}
              aria-invalid={!weightIsValid}
              value={Number.isFinite(weight) ? weight : ''}
              onChange={(event) => setWeight(
                event.target.value === '' ? Number.NaN : Number(event.target.value),
              )}
            />
          </FormField>

          <FormField label="Course weight">
            <Input
              value={!weightIsValid ? '—' : courseWeight == null ? 'Not counted' : `${courseWeight}%`}
              readOnly
              className="bg-surface-2 font-medium tabular-nums"
            />
          </FormField>

          {!titleIsUnique ? (
            <p role="alert" className="text-sm text-danger">Assessment titles must be unique.</p>
          ) : null}

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              loading={isSaving}
              disabled={!valid || isSaving}
              onClick={() => onSave(normalizedTitle, categoryId || null, weight)}
            >
              Save assessment
            </Button>
          </div>
        </fieldset>
      ) : null}
    </ContentDialog>
  )
}
