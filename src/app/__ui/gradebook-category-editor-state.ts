import type { GradebookCategory } from '@/types'

export * from '@/lib/gradebook-category-editor'

export function nextGradebookCategoryNumber(categories: GradebookCategory[]): number {
  return categories.reduce((maximum, category) => {
    const suffix = /^pattern-category-(\d+)$/.exec(category.id)
    return suffix ? Math.max(maximum, Number(suffix[1])) : maximum
  }, 0) + 1
}
