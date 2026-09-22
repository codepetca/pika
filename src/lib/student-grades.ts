import { calculateCategorizedFinalPercent } from '@/lib/gradebook'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export type StudentGradeKind = 'Classwork' | 'Test' | 'Gradebook item'

export interface StudentGradeItem {
  id: string
  kind: StudentGradeKind
  title: string
  earned: number
  possible: number
  percent: number
  included: boolean
  href: string | null
}

export interface StudentGradesResponse {
  currentPercent: number | null
  items: StudentGradeItem[]
}

export interface StudentGradeCalculationItem extends StudentGradeItem {
  categoryId: string | null
  weight: number
  returnedAt: string
}

export function buildStudentGradesResponse(input: {
  categories: Array<{ id: string; percentage: number }>
  items: StudentGradeCalculationItem[]
}): StudentGradesResponse {
  const currentPercent = calculateCategorizedFinalPercent({
    categories: input.categories,
    items: input.items
      .filter((item) => item.included)
      .map((item) => ({
        earned: item.earned,
        possible: item.possible,
        weight: item.weight,
        categoryId: item.categoryId,
      })),
  }).finalPercent

  const items = [...input.items]
    .sort((a, b) => (
      b.returnedAt.localeCompare(a.returnedAt)
      || a.title.localeCompare(b.title)
      || a.id.localeCompare(b.id)
    ))
    .map(({ categoryId: _categoryId, weight: _weight, returnedAt: _returnedAt, ...item }) => ({
      ...item,
      earned: round2(item.earned),
      possible: round2(item.possible),
      percent: round2(item.percent),
    }))

  return { currentPercent, items }
}
