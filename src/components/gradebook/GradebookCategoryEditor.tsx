'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, Circle, GripVertical, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GradebookCategory } from '@/types'
import { Button, ContentDialog, FormField, IconButton, Input, cn } from '@/ui'
import { GRADEBOOK_NUMBER_INPUT_CLASS } from '@/lib/gradebook-display'
import {
  canDeleteGradebookCategory,
  convertGradebookPercentagesToHalfSteps,
  createGradebookCategoryDrafts,
  deleteGradebookCategory,
  isGradebookPercentageIncrement,
  normalizeGradebookCategoryDrafts,
  redistributeGradebookPercentage,
  reorderGradebookCategories,
  type GradebookCategoryEditorDraft,
} from '@/lib/gradebook-category-editor'

function formatPercentage(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '')
}

function percentageInputsFor(categories: GradebookCategoryEditorDraft[]): Record<string, string> {
  return Object.fromEntries(categories.map((category) => [category.id, formatPercentage(category.percentage)]))
}

function categoryLabel(category: GradebookCategoryEditorDraft, index: number): string {
  return category.name.trim() || `Category ${index + 1}`
}

type EditorState = {
  drafts: GradebookCategoryEditorDraft[]
  percentageInputs: Record<string, string>
}

type SortableCategoryRowProps = {
  category: GradebookCategoryEditorDraft
  index: number
  totalCategories: number
  percentageInput: string
  onNameChange: (id: string, name: string) => void
  onPercentageChange: (id: string, value: string) => void
  onPercentageBlur: (id: string) => void
  onToggleLock: (id: string) => void
  onSetDefault: (id: string) => void
  onDelete: (id: string) => void
  deleteDisabled: boolean
  legacyPercentages: boolean
}

function SortableCategoryRow({
  category,
  index,
  totalCategories,
  percentageInput,
  onNameChange,
  onPercentageChange,
  onPercentageBlur,
  onToggleLock,
  onSetDefault,
  onDelete,
  deleteDisabled,
  legacyPercentages,
}: SortableCategoryRowProps) {
  const label = categoryLabel(category, index)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: totalCategories < 2,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <tr ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-floating shadow-elevated')}>
      <td className="rounded-l-card border-y border-l border-border bg-surface-2 px-1 py-2">
        <IconButton
          ref={setActivatorNodeRef}
          icon={GripVertical}
          label={`Drag to reorder ${label}`}
          variant="ghost"
          disabled={totalCategories < 2}
          className={cn(totalCategories > 1 && 'cursor-grab touch-none active:cursor-grabbing')}
          {...attributes}
          {...listeners}
        />
      </td>
      <td className="border-y border-border bg-surface-2 px-2 py-2">
        <FormField label={`Category name for ${label}`} hideLabel collapseHiddenLabel>
          <Input
            className="w-48"
            value={category.name}
            maxLength={80}
            placeholder="Category name"
            onChange={(event) => onNameChange(category.id, event.target.value)}
          />
        </FormField>
      </td>
      <td className="border-y border-border bg-surface-2 px-2 py-2">
        <div className="flex items-center">
          <FormField
            label={`Course percentage for ${label}`}
            hideLabel
            collapseHiddenLabel
            className="w-auto"
          >
            <Input
              className={cn(
                'w-28 rounded-r-none tabular-nums', GRADEBOOK_NUMBER_INPUT_CLASS,
                category.percentageLocked && 'border-warning bg-warning-bg text-warning disabled:bg-warning-bg',
              )}
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={percentageInput}
              disabled={category.percentageLocked || legacyPercentages}
              onChange={(event) => onPercentageChange(category.id, event.target.value)}
              onBlur={() => onPercentageBlur(category.id)}
            />
          </FormField>
          <IconButton
            icon={category.percentageLocked ? Lock : Unlock}
            label={`${category.percentageLocked ? 'Unlock' : 'Lock'} ${label} course percentage`}
            variant="surface"
            className={cn(
              '-ml-px rounded-l-none',
              category.percentageLocked && 'border-warning bg-warning-bg text-warning hover:bg-warning-bg focus-visible:ring-warning',
            )}
            aria-pressed={category.percentageLocked}
            disabled={legacyPercentages}
            onClick={() => onToggleLock(category.id)}
          />
        </div>
      </td>
      <td className="border-y border-border bg-surface-2 px-2 py-2 text-center">
        <IconButton
          icon={category.is_default ? Check : Circle}
          label={category.is_default ? `${label} is the default category` : `Make ${label} the default category`}
          variant={category.is_default ? 'primary' : 'ghost'}
          aria-pressed={category.is_default}
          onClick={() => onSetDefault(category.id)}
        />
      </td>
      <td className="rounded-r-card border-y border-r border-border bg-surface-2 px-1 py-2 text-center">
        <IconButton
          icon={Trash2}
          label={deleteDisabled ? `Unlock another category before deleting ${label}` : `Delete ${label}`}
          variant="ghost"
          className="text-danger"
          disabled={deleteDisabled}
          onClick={() => onDelete(category.id)}
        />
      </td>
    </tr>
  )
}

export function GradebookCategoryEditor({
  isOpen,
  categories,
  onClose,
  onSave,
  isSaving = false,
  error,
  createCategoryId = () => globalThis.crypto.randomUUID(),
}: {
  isOpen: boolean
  categories: GradebookCategory[]
  onClose: () => void
  onSave: (categories: GradebookCategory[]) => void | Promise<void>
  isSaving?: boolean
  error?: string
  createCategoryId?: () => string
}) {
  const [editor, setEditor] = useState<EditorState>(() => {
    const drafts = createGradebookCategoryDrafts(categories)
    return { drafts, percentageInputs: percentageInputsFor(drafts) }
  })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (!isOpen) return
    const drafts = createGradebookCategoryDrafts(categories)
    setEditor({ drafts, percentageInputs: percentageInputsFor(drafts) })
  }, [categories, isOpen])

  const names = editor.drafts.map((category) => category.name.trim().toLocaleLowerCase())
  const legacyPercentages = editor.drafts.some((category) => !isGradebookPercentageIncrement(category.percentage))
  const namesAreUnique = new Set(names).size === names.length
  const percentageInputsAreValid = editor.drafts.every((category) => {
    const rawValue = editor.percentageInputs[category.id] ?? ''
    const value = Number(rawValue)
    return rawValue.trim() !== ''
      && Number.isFinite(value)
      && value >= 0
      && value <= 100
      && (isGradebookPercentageIncrement(value) || legacyPercentages)
      && Math.abs(value - category.percentage) < 0.001
  })
  const valid = editor.drafts.length > 0
    && editor.drafts.every((category) => (
      category.name.trim().length > 0
      && !category.name.trim().toLocaleLowerCase().startsWith('__pika_replacing__')
      && category.name.trim().length <= 80
      && Number.isInteger(category.default_assessment_weight)
      && category.default_assessment_weight >= 1
      && category.default_assessment_weight <= 999
    ))
    && namesAreUnique
    && percentageInputsAreValid
    && editor.drafts.filter((category) => category.is_default).length === 1
    && Math.abs(editor.drafts.reduce((sum, category) => sum + category.percentage, 0) - 100) <= 0.001
  const sortableIds = useMemo(() => editor.drafts.map((category) => category.id), [editor.drafts])

  function updateDraft(id: string, changes: Partial<GradebookCategoryEditorDraft>) {
    setEditor((current) => ({
      ...current,
      drafts: current.drafts.map((category) => category.id === id ? { ...category, ...changes } : category),
    }))
  }

  function updatePercentage(id: string, rawValue: string) {
    setEditor((current) => {
      const rawIsValid = /^\d{0,3}(?:\.\d{0,2})?$/.test(rawValue)
      const requestedPercentage = Number(rawValue)
      if (
        !rawValue
        || !rawIsValid
        || !Number.isFinite(requestedPercentage)
        || requestedPercentage > 100
        || !isGradebookPercentageIncrement(requestedPercentage)
      ) {
        return {
          ...current,
          percentageInputs: { ...current.percentageInputs, [id]: rawValue },
        }
      }

      const drafts = redistributeGradebookPercentage(current.drafts, id, requestedPercentage)
      const edited = drafts.find((category) => category.id === id)
      const editedValue = edited && Math.abs(edited.percentage - requestedPercentage) <= 0.001
        ? rawValue
        : formatPercentage(edited?.percentage ?? requestedPercentage)

      return {
        drafts,
        percentageInputs: Object.fromEntries(drafts.map((category) => [
          category.id,
          category.id === id ? editedValue : formatPercentage(category.percentage),
        ])),
      }
    })
  }

  function normalizePercentageInput(id: string) {
    setEditor((current) => {
      const category = current.drafts.find((candidate) => candidate.id === id)
      if (!category) return current
      return {
        ...current,
        percentageInputs: {
          ...current.percentageInputs,
          [id]: formatPercentage(category.percentage),
        },
      }
    })
  }

  function addCategory() {
    if (isSaving || editor.drafts.length >= 20) return
    const id = createCategoryId()
    setEditor((current) => {
      const firstCategory = current.drafts.length === 0
      const drafts = normalizeGradebookCategoryDrafts([
        ...current.drafts,
        {
          id,
          name: '',
          percentage: firstCategory ? 100 : 0,
          default_assessment_weight: 10,
          position: current.drafts.length,
          is_default: firstCategory,
          percentageLocked: false,
        },
      ])
      return { drafts, percentageInputs: percentageInputsFor(drafts) }
    })
  }

  function removeCategory(id: string) {
    setEditor((current) => {
      const drafts = deleteGradebookCategory(current.drafts, id)
      return { drafts, percentageInputs: percentageInputsFor(drafts) }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isSaving) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    setEditor((current) => ({
      ...current,
      drafts: reorderGradebookCategories(current.drafts, String(active.id), String(over.id)),
    }))
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={isSaving ? () => undefined : onClose}
      title="Edit categories"
      maxWidth="lg:max-w-5xl"
      showFooterClose={false}
    >
      <fieldset disabled={isSaving} className="min-w-0 space-y-4">
        <div className="overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <table className="w-full min-w-max border-separate border-spacing-y-2 text-left">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th scope="col" className="px-1"><span className="sr-only">Reorder</span></th>
                  <th scope="col" className="px-2 py-1">Category name</th>
                  <th scope="col" className="px-2 py-1">Course %</th>
                  <th scope="col" className="px-2 py-1 text-center">Default</th>
                  <th scope="col" className="px-1 py-1 text-center">
                    <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <tbody>
                  {editor.drafts.map((category, index) => (
                    <SortableCategoryRow
                      key={category.id}
                      category={category}
                      index={index}
                      totalCategories={editor.drafts.length}
                      percentageInput={editor.percentageInputs[category.id] ?? ''}
                      onNameChange={(id, name) => updateDraft(id, { name })}
                      onPercentageChange={updatePercentage}
                      onPercentageBlur={normalizePercentageInput}
                      onToggleLock={(id) => {
                        const current = editor.drafts.find((candidate) => candidate.id === id)
                        if (current) updateDraft(id, { percentageLocked: !current.percentageLocked })
                      }}
                      onSetDefault={(id) => setEditor((current) => ({
                        ...current,
                        drafts: current.drafts.map((candidate) => ({
                          ...candidate,
                          is_default: candidate.id === id,
                        })),
                      }))}
                      onDelete={removeCategory}
                      deleteDisabled={!canDeleteGradebookCategory(editor.drafts, category.id)}
                      legacyPercentages={legacyPercentages}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>

        {legacyPercentages ? (
          <div className="space-y-2 text-sm text-text-muted">
            <p>These saved percentages use smaller increments. Convert them to 0.5% steps before editing percentages. Names and defaults can still be saved unchanged.</p>
            <Button type="button" variant="secondary" onClick={() => setEditor((current) => {
              const drafts = convertGradebookPercentagesToHalfSteps(current.drafts)
              return { drafts, percentageInputs: percentageInputsFor(drafts) }
            })}>Convert to 0.5% steps</Button>
          </div>
        ) : null}
        {!namesAreUnique ? <p role="alert" className="text-sm text-danger">Category names must be unique.</p> : null}

        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="secondary" size="sm" disabled={isSaving || editor.drafts.length >= 20} onClick={addCategory}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add category
          </Button>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              loading={isSaving}
              disabled={!valid || isSaving}
              onClick={() => onSave(normalizeGradebookCategoryDrafts(editor.drafts).map(({ percentageLocked: _locked, ...category }) => category))}
            >
              Save categories
            </Button>
          </div>
        </div>
      </fieldset>
    </ContentDialog>
  )
}
