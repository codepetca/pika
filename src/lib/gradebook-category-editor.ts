import type { GradebookCategory } from '@/types'

const PERCENTAGE_SCALE = 100
const PERCENTAGE_INCREMENT = 0.5

export type GradebookCategoryEditorDraft = GradebookCategory & {
  percentageLocked: boolean
}

function toPercentageUnits(value: number): number {
  return Math.round(value * PERCENTAGE_SCALE)
}

function fromPercentageUnits(value: number): number {
  return value / PERCENTAGE_SCALE
}

export function isGradebookPercentageIncrement(value: number): boolean {
  return Number.isFinite(value)
    && Math.abs(value / PERCENTAGE_INCREMENT - Math.round(value / PERCENTAGE_INCREMENT)) < 0.000001
}

export function createGradebookCategoryDrafts(
  categories: GradebookCategory[],
): GradebookCategoryEditorDraft[] {
  return categories.map((category, position) => ({
    ...category,
    position,
    percentageLocked: false,
  }))
}

/** Explicit opt-in conversion of legacy hundredth-percent shares, preserving 100%. */
export function convertGradebookPercentagesToHalfSteps(
  categories: GradebookCategoryEditorDraft[],
): GradebookCategoryEditorDraft[] {
  const units = categories.map((category) => Math.floor(category.percentage * 2))
  const remainderOrder = categories.map((category, index) => ({
    index, remainder: category.percentage * 2 - units[index],
  })).sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  const missing = 200 - units.reduce((sum, value) => sum + value, 0)
  for (const { index } of remainderOrder.slice(0, missing)) units[index] += 1
  return categories.map((category, index) => ({ ...category, percentage: units[index] / 2, percentageLocked: false }))
}

export function normalizeGradebookCategoryDrafts(
  categories: GradebookCategoryEditorDraft[],
): GradebookCategoryEditorDraft[] {
  return categories.map((category, position) => ({ ...category, position }))
}

export function redistributeGradebookPercentage(
  categories: GradebookCategoryEditorDraft[],
  editedId: string,
  requestedPercentage: number,
): GradebookCategoryEditorDraft[] {
  if (!isGradebookPercentageIncrement(requestedPercentage)) return categories

  const editedIndex = categories.findIndex((category) => category.id === editedId)
  if (editedIndex === -1) return categories
  if (categories[editedIndex].percentageLocked) return categories

  const currentUnits = toPercentageUnits(categories[editedIndex].percentage)
  const requestedUnits = Math.min(
    toPercentageUnits(100),
    Math.max(0, toPercentageUnits(requestedPercentage)),
  )
  const delta = requestedUnits - currentUnits
  if (delta === 0) return categories

  const adjustableIndexes = categories.flatMap((category, index) => (
    category.id !== editedId && !category.percentageLocked ? [index] : []
  ))
  if (adjustableIndexes.length === 0) return categories

  const nextUnits = categories.map((category) => toPercentageUnits(category.percentage))

  if (delta > 0) {
    const availableUnits = adjustableIndexes.reduce((sum, index) => sum + nextUnits[index], 0)
    const appliedDelta = Math.min(delta, availableUnits)
    if (appliedDelta === 0) return categories

    nextUnits[editedIndex] += appliedDelta
    let remainingDelta = appliedDelta
    for (const index of adjustableIndexes) {
      const reduction = Math.min(nextUnits[index], remainingDelta)
      nextUnits[index] -= reduction
      remainingDelta -= reduction
      if (remainingDelta === 0) break
    }
  } else {
    nextUnits[editedIndex] = requestedUnits
    nextUnits[adjustableIndexes[0]] += Math.abs(delta)
  }

  return categories.map((category, index) => ({
    ...category,
    percentage: fromPercentageUnits(nextUnits[index]),
  }))
}

export function canDeleteGradebookCategory(
  categories: GradebookCategoryEditorDraft[],
  categoryId: string,
): boolean {
  const category = categories.find((candidate) => candidate.id === categoryId)
  if (!category) return false
  if (categories.length === 1) return true
  if (toPercentageUnits(category.percentage) === 0) return true
  return categories.some((candidate) => candidate.id !== categoryId && !candidate.percentageLocked)
}

export function deleteGradebookCategory(
  categories: GradebookCategoryEditorDraft[],
  categoryId: string,
): GradebookCategoryEditorDraft[] {
  if (!canDeleteGradebookCategory(categories, categoryId)) return categories

  const removed = categories.find((category) => category.id === categoryId)
  if (!removed) return categories

  const remaining = categories.filter((category) => category.id !== categoryId)
  if (remaining.length === 0) return []

  const recipientIndex = remaining.findIndex((category) => !category.percentageLocked)
  if (recipientIndex >= 0) {
    remaining[recipientIndex] = {
      ...remaining[recipientIndex],
      percentage: fromPercentageUnits(
        toPercentageUnits(remaining[recipientIndex].percentage)
          + toPercentageUnits(removed.percentage),
      ),
    }
  }

  if (removed.is_default) {
    remaining[0] = { ...remaining[0], is_default: true }
  }

  return normalizeGradebookCategoryDrafts(remaining)
}

export function reorderGradebookCategories(
  categories: GradebookCategoryEditorDraft[],
  activeId: string,
  overId: string,
): GradebookCategoryEditorDraft[] {
  const oldIndex = categories.findIndex((category) => category.id === activeId)
  const newIndex = categories.findIndex((category) => category.id === overId)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return categories

  const reordered = [...categories]
  const [moved] = reordered.splice(oldIndex, 1)
  reordered.splice(newIndex, 0, moved)
  return normalizeGradebookCategoryDrafts(reordered)
}
