import { calculateCategorizedFinalPercent } from '@/lib/gradebook'
import { getAssessmentCell } from '@/lib/gradebook-display'
import type { GradebookAssessmentColumn, GradebookCategory, GradebookStudentSummary } from '@/types'

export interface GradebookStudentReportItem {
  title: string
  kind: 'Classwork' | 'Test' | 'Gradebook item'
  categoryName: string | null
  earned: number
  possible: number
  percent: number
  included: boolean
  isZeroWeight: boolean
}

export interface GradebookStudentReport {
  studentName: string
  currentPercent: number | null
  items: GradebookStudentReportItem[]
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Project only marks already visible to this student; never use the teacher's final override. */
export function buildGradebookStudentReport(input: {
  student: GradebookStudentSummary
  columns: GradebookAssessmentColumn[]
  categories: GradebookCategory[]
}): GradebookStudentReport {
  const categories = new Map(input.categories.map((category) => [category.id, category]))
  const calculationItems: Array<{ earned: number; possible: number; weight: number; categoryId: string | null }> = []
  const items: GradebookStudentReportItem[] = []

  for (const column of input.columns) {
    if (column.is_draft || column.status === 'draft') continue
    const cell = getAssessmentCell(input.student, column)
    if (!cell?.is_graded || cell.earned == null || !Number.isFinite(cell.earned)
      || cell.earned < 0 || !Number.isFinite(cell.possible) || cell.possible <= 0) continue
    if (column.assessment_type !== 'item' && !cell.returned_at) continue

    const category = column.category_id ? categories.get(column.category_id) : undefined
    const included = column.include_in_final !== false && column.weight > 0
      && Boolean(category && category.percentage > 0)
    // The teacher projection may round earned points while retaining a more
    // precise percentage (for example, rubric scores on a one-point item).
    const percent = cell.percent != null && Number.isFinite(cell.percent)
      ? cell.percent : cell.earned / cell.possible * 100
    if (included) calculationItems.push({ earned: percent, possible: 100, weight: column.weight, categoryId: category!.id })
    items.push({
      title: column.title,
      kind: column.assessment_type === 'assignment' ? 'Classwork' : column.assessment_type === 'test' ? 'Test' : 'Gradebook item',
      categoryName: category?.name ?? null,
      earned: round2(cell.earned),
      possible: round2(cell.possible),
      percent: round2(percent),
      included,
      isZeroWeight: column.weight === 0,
    })
  }

  return {
    studentName: [input.student.student_first_name, input.student.student_last_name].filter(Boolean).join(' ').trim(),
    currentPercent: calculateCategorizedFinalPercent({ categories: input.categories, items: calculationItems }).finalPercent,
    items,
  }
}
