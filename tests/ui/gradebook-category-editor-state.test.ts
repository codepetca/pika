import { describe, expect, it } from 'vitest'
import type { GradebookCategory } from '@/types'
import {
  canDeleteGradebookCategory,
  createGradebookCategoryDrafts,
  deleteGradebookCategory,
  isGradebookPercentageIncrement,
  redistributeGradebookPercentage,
  reorderGradebookCategories,
} from '@/app/__ui/gradebook-category-editor-state'

const categories: GradebookCategory[] = [
  { id: 'term', name: 'Term', percentage: 65, default_assessment_weight: 10, position: 0, is_default: true },
  { id: 'attendance', name: 'Attendance', percentage: 10, default_assessment_weight: 10, position: 1, is_default: false },
  { id: 'final', name: 'Final', percentage: 25, default_assessment_weight: 10, position: 2, is_default: false },
]

describe('gradebook category editor state', () => {
  it('accepts only whole or half-point percentages', () => {
    expect(isGradebookPercentageIncrement(10)).toBe(true)
    expect(isGradebookPercentageIncrement(10.5)).toBe(true)
    expect(isGradebookPercentageIncrement(10.25)).toBe(false)
  })

  it('subtracts an increase from unlocked categories in display order', () => {
    const drafts = createGradebookCategoryDrafts(categories)
    const next = redistributeGradebookPercentage(drafts, 'term', 80)

    expect(next.map((category) => category.percentage)).toEqual([80, 0, 20])
  })

  it('protects locked categories during automatic redistribution', () => {
    const drafts = createGradebookCategoryDrafts(categories).map((category) => (
      category.id === 'attendance' ? { ...category, percentageLocked: true } : category
    ))
    const next = redistributeGradebookPercentage(drafts, 'term', 75)

    expect(next.map((category) => category.percentage)).toEqual([75, 10, 15])
  })

  it('does not directly edit a locked category', () => {
    const drafts = createGradebookCategoryDrafts(categories).map((category) => (
      category.id === 'term' ? { ...category, percentageLocked: true } : category
    ))

    expect(redistributeGradebookPercentage(drafts, 'term', 75)).toBe(drafts)
  })

  it('does not redistribute an unsupported percentage increment', () => {
    const drafts = createGradebookCategoryDrafts(categories)

    expect(redistributeGradebookPercentage(drafts, 'term', 65.25)).toBe(drafts)
  })

  it('adds a decrease to the first unlocked category', () => {
    const drafts = createGradebookCategoryDrafts(categories)
    const next = redistributeGradebookPercentage(drafts, 'term', 50)

    expect(next.map((category) => category.percentage)).toEqual([50, 25, 25])
  })

  it('reallocates a deleted percentage and normalizes positions', () => {
    const drafts = createGradebookCategoryDrafts(categories)
    const next = deleteGradebookCategory(drafts, 'term')

    expect(next).toEqual([
      expect.objectContaining({ id: 'attendance', percentage: 75, position: 0, is_default: true }),
      expect.objectContaining({ id: 'final', percentage: 25, position: 1, is_default: false }),
    ])
  })

  it('blocks deletion when every possible recipient is locked', () => {
    const drafts = createGradebookCategoryDrafts(categories).map((category) => (
      category.id === 'term' ? category : { ...category, percentageLocked: true }
    ))

    expect(canDeleteGradebookCategory(drafts, 'term')).toBe(false)
    expect(deleteGradebookCategory(drafts, 'term')).toBe(drafts)
  })

  it('reorders categories through the shared drag result contract', () => {
    const drafts = createGradebookCategoryDrafts(categories)
    const next = reorderGradebookCategories(drafts, 'final', 'term')

    expect(next.map((category) => [category.id, category.position])).toEqual([
      ['final', 0],
      ['term', 1],
      ['attendance', 2],
    ])
  })
})
