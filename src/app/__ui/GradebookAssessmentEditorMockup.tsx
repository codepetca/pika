'use client'

import { useEffect, useMemo, useState } from 'react'
import { calculateAssessmentCourseWeight } from '@/lib/gradebook'
import type { GradebookAssessmentColumn, GradebookCategory } from '@/types'
import { Button, ContentDialog, FormField, Input, Select } from '@/ui'
import { isValidGradebookMockupWeight } from './gradebook-mockup-state'

export function GradebookAssessmentEditorMockup({
  isOpen,
  assessment,
  assessments,
  categories,
  onClose,
  onSave,
}: {
  isOpen: boolean
  assessment: GradebookAssessmentColumn | null
  assessments: GradebookAssessmentColumn[]
  categories: GradebookCategory[]
  onClose: () => void
  onSave: (title: string, categoryId: string | null, weight: number) => void
}) {
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [weight, setWeight] = useState(10)
  const weightIsValid = isValidGradebookMockupWeight(weight)

  useEffect(() => {
    if (!isOpen || !assessment) return
    setTitle(assessment.title)
    setCategoryId(assessment.category_id ?? '')
    setWeight(assessment.weight)
  }, [assessment, isOpen])

  const selectedCategory = categories.find((category) => category.id === categoryId) || null
  const courseWeight = useMemo(() => {
    if (
      !assessment
      || !weightIsValid
      || !selectedCategory
      || !assessment.include_in_final
      || assessment.is_draft
      || assessment.status === 'draft'
    ) return null

    const otherWeights = assessments
      .filter((candidate) => (
        candidate.include_in_final
        && !candidate.is_draft
        && candidate.status !== 'draft'
        && candidate.category_id === selectedCategory.id
        && !(candidate.assessment_id === assessment.assessment_id
          && candidate.assessment_type === assessment.assessment_type)
      ))
      .map((candidate) => candidate.weight)

    return calculateAssessmentCourseWeight({
      categoryPercentage: selectedCategory.percentage,
      assessmentWeight: weight,
      categoryAssessmentWeights: [...otherWeights, weight],
    })
  }, [assessment, assessments, selectedCategory, weight, weightIsValid])

  const normalizedTitle = title.trim()
  const reservedTitles = assessments
    .filter((candidate) => candidate.assessment_id !== assessment?.assessment_id)
    .map((candidate) => candidate.title)
  const titleIsUnique = !reservedTitles.some((candidate) => (
    candidate.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase()
  ))
  const valid = normalizedTitle.length > 0
    && titleIsUnique
    && weightIsValid

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit assessment"
      maxWidth="max-w-md"
      showFooterClose={false}
    >
      {assessment ? (
        <div className="space-y-3">
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

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!valid}
              onClick={() => onSave(normalizedTitle, categoryId || null, weight)}
            >
              Save assessment
            </Button>
          </div>
        </div>
      ) : null}
    </ContentDialog>
  )
}
