'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { calculateAssessmentCourseWeight } from '@/lib/gradebook'
import type { GradebookAssessmentColumn, GradebookCategory } from '@/types'
import { Button, Card, ContentDialog, FormField, Input, Select } from '@/ui'

type CategoryDraft = GradebookCategory

function nextCategoryId(): string {
  return globalThis.crypto.randomUUID()
}

function normalizeCategories(categories: CategoryDraft[]): CategoryDraft[] {
  return categories.map((category, position) => ({ ...category, position }))
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
}

export function GradebookEditorDialog({
  isOpen,
  categories,
  isSaving,
  error,
  onClose,
  onSave,
}: {
  isOpen: boolean
  categories: GradebookCategory[]
  isSaving: boolean
  error?: string
  onClose: () => void
  onSave: (categories: GradebookCategory[]) => void | Promise<void>
}) {
  const [drafts, setDrafts] = useState<CategoryDraft[]>(categories)

  useEffect(() => {
    if (isOpen) setDrafts(categories)
  }, [categories, isOpen])

  const total = drafts.reduce((sum, category) => sum + Number(category.percentage || 0), 0)
  const roundedTotal = Math.round(total * 100) / 100
  const names = drafts.map((category) => category.name.trim().toLocaleLowerCase())
  const namesAreUnique = new Set(names).size === names.length
  const valid = drafts.length > 0
    && drafts.every((category) => (
      category.name.trim().length > 0
      && category.name.trim().length <= 80
      && Number.isFinite(category.percentage)
      && category.percentage >= 0
      && category.percentage <= 100
      && hasAtMostTwoDecimalPlaces(category.percentage)
      && Number.isInteger(category.default_assessment_weight)
      && category.default_assessment_weight >= 1
      && category.default_assessment_weight <= 999
    ))
    && namesAreUnique
    && drafts.filter((category) => category.is_default).length === 1
    && Math.abs(total - 100) <= 0.001

  function updateCategory(id: string, changes: Partial<CategoryDraft>) {
    setDrafts((current) => current.map((category) => (
      category.id === id ? { ...category, ...changes } : category
    )))
  }

  function setDefault(id: string) {
    setDrafts((current) => current.map((category) => ({
      ...category,
      is_default: category.id === id,
    })))
  }

  function deleteCategory(id: string) {
    setDrafts((current) => {
      if (current.length <= 1) return current
      const removed = current.find((category) => category.id === id)
      const remaining = current.filter((category) => category.id !== id)
      if (removed?.is_default && remaining[0]) remaining[0] = { ...remaining[0], is_default: true }
      return normalizeCategories(remaining)
    })
  }

  function moveCategory(id: string, direction: -1 | 1) {
    setDrafts((current) => {
      const index = current.findIndex((category) => category.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const reordered = [...current]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, moved)
      return normalizeCategories(reordered)
    })
  }

  function addCategory() {
    setDrafts((current) => normalizeCategories([
      ...current,
      {
        id: nextCategoryId(),
        name: '',
        percentage: 0,
        default_assessment_weight: 10,
        position: current.length,
        is_default: current.length === 0,
      },
    ]))
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit gradebook"
      subtitle="Categories determine the course grade. Assessment weights apply within each category."
      maxWidth="max-w-3xl"
      showFooterClose={false}
    >
      <div className="space-y-3">
        {drafts.map((category, index) => (
          <Card key={category.id} tone="muted" padding="sm">
            <div className="grid gap-3 md:grid-cols-4 md:items-end">
              <FormField label="Category name">
                <Input
                  value={category.name}
                  maxLength={80}
                  onChange={(event) => updateCategory(category.id, { name: event.target.value })}
                  placeholder="Category"
                />
              </FormField>
              <FormField label="Course %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={Number.isFinite(category.percentage) ? category.percentage : ''}
                  onChange={(event) => updateCategory(category.id, {
                    percentage: event.target.value === '' ? Number.NaN : Number(event.target.value),
                  })}
                />
              </FormField>
              <FormField label="Default item weight">
                <Input
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  value={Number.isFinite(category.default_assessment_weight) ? category.default_assessment_weight : ''}
                  onChange={(event) => updateCategory(category.id, {
                    default_assessment_weight: event.target.value === '' ? Number.NaN : Number(event.target.value),
                  })}
                />
              </FormField>
              <div className="flex min-h-control items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${category.name || 'category'} up`}
                  disabled={index === 0}
                  onClick={() => moveCategory(category.id, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${category.name || 'category'} down`}
                  disabled={index === drafts.length - 1}
                  onClick={() => moveCategory(category.id, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant={category.is_default ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={category.is_default}
                  onClick={() => setDefault(category.id)}
                >
                  {category.is_default ? 'Default' : 'Make default'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${category.name || 'category'}`}
                  disabled={drafts.length <= 1}
                  onClick={() => deleteCategory(category.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </Card>
        ))}

        <p className="text-sm text-text-muted">
          Deleting a category leaves its assessments Uncategorized.
        </p>

        <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="secondary" size="sm" onClick={addCategory}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add category
          </Button>
          <div className="text-sm tabular-nums text-text-muted">
            Total: <span className={Math.abs(total - 100) <= 0.001 ? 'text-success' : 'text-danger'}>{roundedTotal}%</span>
          </div>
        </div>

        {!namesAreUnique ? <p role="alert" className="text-sm text-danger">Category names must be unique.</p> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" disabled={isSaving} onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant="primary"
            loading={isSaving}
            disabled={!valid || isSaving}
            onClick={() => void onSave(normalizeCategories(drafts))}
          >
            Save gradebook
          </Button>
        </div>
      </div>
    </ContentDialog>
  )
}

export function GradebookAssessmentDialog({
  isOpen,
  assessment,
  assessments,
  categories,
  isSaving,
  error,
  onClose,
  onSave,
}: {
  isOpen: boolean
  assessment: GradebookAssessmentColumn | null
  assessments: GradebookAssessmentColumn[]
  categories: GradebookCategory[]
  isSaving: boolean
  error?: string
  onClose: () => void
  onSave: (categoryId: string | null, weight: number) => void | Promise<void>
}) {
  const [categoryId, setCategoryId] = useState<string>('')
  const [weight, setWeight] = useState(10)

  useEffect(() => {
    if (!isOpen || !assessment) return
    setCategoryId(assessment.category_id ?? '')
    setWeight(assessment.weight)
  }, [assessment, isOpen])

  const selectedCategory = categories.find((category) => category.id === categoryId) || null
  const exactCourseWeight = useMemo(() => {
    if (
      !assessment
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
  }, [assessment, assessments, selectedCategory, weight])

  const validWeight = Number.isInteger(weight) && weight >= 1 && weight <= 999

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={onClose}
      title={assessment?.title ?? 'Assessment details'}
      subtitle={assessment ? `${assessment.code} · ${assessment.assessment_type === 'assignment' ? 'Assignment' : 'Test'}` : undefined}
      showFooterClose={false}
    >
      {assessment ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Category">
              <Select
                value={categoryId}
                onChange={(event) => {
                  const nextCategoryId = event.target.value
                  setCategoryId(nextCategoryId)
                  const nextCategory = categories.find((category) => category.id === nextCategoryId)
                  if (nextCategory) setWeight(nextCategory.default_assessment_weight)
                }}
                options={[
                  { value: '', label: 'Uncategorized' },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
            </FormField>
            <FormField label="Weight in category">
              <Input
                type="number"
                min={1}
                max={999}
                step={1}
                value={Number.isFinite(weight) ? weight : ''}
                onChange={(event) => setWeight(
                  event.target.value === '' ? Number.NaN : Number(event.target.value),
                )}
              />
            </FormField>
          </div>

          <Card tone="muted" padding="sm">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Category course weight</dt>
                <dd className="font-medium text-text-default">{selectedCategory ? `${selectedCategory.percentage}%` : 'Not counted'}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Exact course weight</dt>
                <dd className="font-medium text-text-default">{exactCourseWeight == null ? 'Not counted' : `${exactCourseWeight}%`}</dd>
              </div>
            </dl>
          </Card>

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" disabled={isSaving} onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              loading={isSaving}
              disabled={!validWeight || isSaving}
              onClick={() => void onSave(categoryId || null, weight)}
            >
              Save assessment
            </Button>
          </div>
        </div>
      ) : null}
    </ContentDialog>
  )
}
