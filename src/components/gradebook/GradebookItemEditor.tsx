'use client'

import { useEffect, useState } from 'react'
import type { GradebookAssessmentColumn, GradebookCategory } from '@/types'
import { Button, ConfirmDialog, ContentDialog, FormField, Input, Select } from '@/ui'
import { GRADEBOOK_NUMBER_INPUT_CLASS } from '@/lib/gradebook-display'
import { isValidGradebookWeight } from '@/lib/gradebook-editor'

export interface GradebookItemDetails {
  title: string
  points_possible: number
  gradebook_category_id: string | null
  gradebook_weight: number
  include_in_final: boolean
}

export function GradebookItemEditor({
  isOpen, item, categories, onClose, onSave, onDelete,
  isSaving = false, error,
}: {
  isOpen: boolean
  item: GradebookAssessmentColumn | null
  categories: GradebookCategory[]
  onClose: () => void
  onSave: (details: GradebookItemDetails) => void | Promise<void>
  onDelete?: () => void | Promise<void>
  isSaving?: boolean
  error?: string
}) {
  const [title, setTitle] = useState('')
  const [possible, setPossible] = useState('100')
  const [categoryId, setCategoryId] = useState('')
  const [weight, setWeight] = useState('10')
  const [included, setIncluded] = useState(true)
  const [confirmation, setConfirmation] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const defaultCategory = categories.find((category) => category.is_default)
    setTitle(item?.title ?? '')
    setPossible(String(item?.possible ?? 100))
    setCategoryId(item ? item.category_id ?? '' : defaultCategory?.id ?? '')
    setWeight(String(item?.weight ?? defaultCategory?.default_assessment_weight ?? 10))
    setIncluded(item?.include_in_final ?? true)
    setConfirmation(false)
  }, [isOpen, item, categories])

  const points = Number(possible)
  const pointsValid = possible.trim() !== '' && Number.isFinite(points) && points >= 0.1 && points <= 999999.9
    && Math.abs(points * 10 - Math.round(points * 10)) < 0.000001
  const weightValid = weight.trim() !== '' && isValidGradebookWeight(Number(weight))
  const valid = title.trim().length > 0 && title.trim().length <= 200 && pointsValid && weightValid

  return <>
    <ContentDialog
      isOpen={isOpen}
      onClose={isSaving ? () => undefined : onClose}
      title={item ? 'Edit item' : 'Add other assessment'}
      maxWidth="sm:max-w-md"
      showFooterClose={false}
    >
      <form onSubmit={(event) => {
        event.preventDefault()
        if (valid && !isSaving) void onSave({
          title: title.trim(),
          points_possible: points,
          gradebook_category_id: categoryId || null,
          gradebook_weight: Number(weight),
          include_in_final: included,
        })
      }}>
        <fieldset disabled={isSaving} className="min-w-0 space-y-3">
          {!item ? <p className="text-sm text-text-muted">Classwork and Tests appear in Gradebook automatically. Add an assessment here only if it is recorded outside Classwork or Tests.</p> : null}
          <FormField label="Assessment title" required>
            <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
          </FormField>
          <FormField
            label="Points possible"
            required
            error={pointsValid ? undefined : 'Enter a positive number in increments of 0.1.'}
          >
            <Input
              type="number" min={0.1} max={999999.9} step="0.1"
              value={possible} className={GRADEBOOK_NUMBER_INPUT_CLASS}
              onChange={(event) => setPossible(event.target.value)}
            />
          </FormField>
          <FormField label="Category">
            <Select
              value={categoryId}
              onChange={(event) => {
                const nextId = event.target.value
                setCategoryId(nextId)
                const selected = categories.find((category) => category.id === nextId)
                if (selected) setWeight(String(selected.default_assessment_weight))
              }}
              options={[
                { value: '', label: 'None' },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
          </FormField>
          <FormField label="Category weight" error={weightValid ? undefined : 'Enter a whole number from 0 to 999.'}>
            <Input
              type="number" min={0} max={999} step={1}
              value={weight} className={GRADEBOOK_NUMBER_INPUT_CLASS}
              onChange={(event) => setWeight(event.target.value)}
            />
          </FormField>
          <FormField label="Include in final grade">
            <Select
              value={included ? 'yes' : 'no'}
              onChange={(event) => setIncluded(event.target.value === 'yes')}
              options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
            />
          </FormField>
          <p className="text-xs text-text-muted">
            Marks are visible to students as soon as you save them.
          </p>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {item ? (
              <Button type="button" variant="danger" className="mr-auto" onClick={() => setConfirmation(true)}>
                Delete item
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={isSaving} disabled={!valid || isSaving}>
              {item ? 'Save item' : 'Add other assessment'}
            </Button>
          </div>
        </fieldset>
      </form>
    </ContentDialog>
    <ConfirmDialog
      isOpen={isOpen && confirmation}
      title="Delete item?"
      description={`“${item?.title}” and all its student marks will be permanently deleted. This cannot be undone.`}
      confirmLabel="Delete item"
      confirmVariant="danger"
      errorMessage={error}
      isCancelDisabled={isSaving}
      isConfirmDisabled={isSaving}
      onCancel={() => { if (!isSaving) setConfirmation(false) }}
      onConfirm={() => {
        if (isSaving) return
        return onDelete?.()
      }}
    />
  </>
}
