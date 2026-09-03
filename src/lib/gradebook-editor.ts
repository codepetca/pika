import type { GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'
import { calculateAssessmentCourseWeight } from './gradebook'
import { getAssessmentColumnKey } from './gradebook-display'
import { formatAssessmentScore, formatPercent, getAssessmentCell, type GradebookSummaryKind, type ScoreDisplayMode } from './gradebook-display'

export interface GradebookDisplayPreferences {
  scoreDisplayMode: ScoreDisplayMode
  summaryKind: GradebookSummaryKind
  lastNameFirst: boolean
  showStudentIds: boolean
  showWeights: boolean
  keepKeyColumnsVisible: boolean
}

export const DEFAULT_GRADEBOOK_PREFERENCES: GradebookDisplayPreferences = {
  scoreDisplayMode: 'percent', summaryKind: 'average', lastNameFirst: false,
  showStudentIds: false, showWeights: false, keepKeyColumnsVisible: true,
}

export function normalizeGradebookPreferences(value: unknown): GradebookDisplayPreferences {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result = { ...DEFAULT_GRADEBOOK_PREFERENCES }
  if (saved.scoreDisplayMode === 'raw') result.scoreDisplayMode = 'raw'
  if (saved.summaryKind === 'median') result.summaryKind = 'median'
  for (const key of ['lastNameFirst', 'showStudentIds', 'showWeights', 'keepKeyColumnsVisible'] as const) {
    if (typeof saved[key] === 'boolean') result[key] = saved[key]
  }
  return result
}

export function isValidGradebookWeight(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 999
}

export function editedAssessmentCourseWeight(
  assessment: GradebookAssessmentColumn,
  assessments: GradebookAssessmentColumn[],
  categoryId: string | null,
  percentage: number | null,
  weight: number,
): number | null {
  if (!categoryId || percentage == null || !isValidGradebookWeight(weight)
    || !assessment.include_in_final || assessment.is_draft || assessment.status === 'draft') return null
  const otherWeights = assessments.filter((candidate) => candidate.include_in_final
    && !candidate.is_draft && candidate.status !== 'draft'
    && candidate.category_id === categoryId
    && getAssessmentColumnKey(candidate) !== getAssessmentColumnKey(assessment)).map((candidate) => candidate.weight)
  return calculateAssessmentCourseWeight({ categoryPercentage: percentage, assessmentWeight: weight, categoryAssessmentWeights: [...otherWeights, weight] })
}

export function gradebookCourseWeightPreviews(columns: GradebookAssessmentColumn[], drafts: Record<string, string>) {
  const previewColumns = columns.map((column) => {
    const weight = Number(drafts[getAssessmentColumnKey(column)])
    return isValidGradebookWeight(weight) ? { ...column, weight } : column
  })
  return Object.fromEntries(previewColumns.map((column) => [getAssessmentColumnKey(column), editedAssessmentCourseWeight(
    column, previewColumns, column.category_id ?? null, column.category_percentage ?? null, column.weight,
  )]))
}

function csvCell(value: string): string {
  // Neutralize formula-like text when a teacher opens the export in a spreadsheet.
  const text = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value
  return `"${text.replaceAll('"', '""')}"`
}

export function buildGradebookCsv(students: GradebookStudentSummary[], columns: GradebookAssessmentColumn[], displayMode: ScoreDisplayMode): string {
  return [
    ['First', 'Last', 'ID', 'Email', ...columns.map((column) => column.title), 'Final'],
    ...students.map((student) => [
      student.student_first_name ?? '', student.student_last_name ?? '',
      student.student_number ?? '', student.student_email,
      ...columns.map((column) => formatAssessmentScore(getAssessmentCell(student, column), displayMode)),
      formatPercent(student.final_percent),
    ]),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadGradebookCsv(students: GradebookStudentSummary[], columns: GradebookAssessmentColumn[], displayMode: ScoreDisplayMode) {
  const url = URL.createObjectURL(new Blob([buildGradebookCsv(students, columns, displayMode)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'gradebook.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
