import type { GradebookAssessmentCell, GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'

export type ScoreDisplayMode = 'percent' | 'raw'
export type GradebookIdentityColumn = 'first_name' | 'last_name' | 'id'
export type GradebookSummaryKind = 'average' | 'median'

export const getGradebookStudentRowId = (studentId: string) => `gradebook-student-row-${studentId}`

export function formatPercent(value: number | null): string {
  if (value == null) return '—'
  return `${value.toFixed(1)}%`
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function formatCompactPercent(value: number | null): string {
  if (value == null) return '—'
  const rounded = round2(value)
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`
}

export function getGradePercentTextClass(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) return 'text-text-muted'
  if (percent < 50) return 'text-danger'
  if (percent < 70) return 'text-warning'
  return 'text-text-default'
}

export function getAssessmentCellPercent(cell: GradebookAssessmentCell | null): number | null {
  if (!cell?.is_graded) return null
  if (cell.percent != null) return cell.percent
  if (cell.earned != null && cell.possible > 0) return (cell.earned / cell.possible) * 100
  return null
}

export function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatTorontoDateShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Toronto',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function getStudentName(student: GradebookStudentSummary): string {
  return `${student.student_first_name || ''} ${student.student_last_name || ''}`.trim() || student.student_email
}

export function getStudentDisplayId(student: GradebookStudentSummary): string {
  return student.student_number?.trim() || student.student_email.split('@')[0] || student.student_id
}

export function getValidEmailList(emails: string[]): string[] {
  return [...new Set(emails.map((email) => email.trim()).filter((email) => email.includes('@')))]
}

export function getStudentIdentityValue(student: GradebookStudentSummary, column: GradebookIdentityColumn): string {
  if (column === 'first_name') return student.student_first_name || '—'
  if (column === 'last_name') return student.student_last_name || '—'
  return getStudentDisplayId(student)
}

export function getAssessmentColumnKey(column: GradebookAssessmentColumn): string {
  return `${column.assessment_type}:${column.assessment_id}`
}

export function getAssessmentCell(
  student: GradebookStudentSummary,
  column: GradebookAssessmentColumn
): GradebookAssessmentCell | null {
  return (
    student.assessment_scores?.find(
      (cell) =>
        cell.assessment_id === column.assessment_id &&
        cell.assessment_type === column.assessment_type
    ) || null
  )
}

export function average(values: number[]): number | null {
  if (!values.length) return null
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return round2(sorted[middle])
  return round2((sorted[middle - 1] + sorted[middle]) / 2)
}

export function formatAssessmentScore(cell: GradebookAssessmentCell | null, displayMode: ScoreDisplayMode): string {
  if (!cell?.is_graded) return '—'
  if (displayMode === 'raw') {
    if (cell.earned == null) return '—'
    return `${formatPoints(cell.earned)}/${formatPoints(cell.possible)}`
  }
  return formatCompactPercent(cell.percent)
}

export function formatAssessmentRawScore(cell: GradebookAssessmentCell | null, possible: number): string {
  if (!cell?.is_graded || cell.earned == null) return `—/${formatPoints(possible)}`
  return `${formatPoints(cell.earned)}/${formatPoints(cell.possible || possible)}`
}

export function formatAssessmentTypeLabel(type: GradebookAssessmentColumn['assessment_type']): string {
  if (type === 'assignment') return 'Assignment'
  return 'Test'
}

export function getAssessmentMeta(column: GradebookAssessmentColumn): string {
  const meta = []
  if (column.due_at) meta.push(`Due ${formatTorontoDateShort(column.due_at)}`)
  if (column.status) meta.push(column.status.charAt(0).toUpperCase() + column.status.slice(1))
  if (column.is_draft) meta.push('Draft')
  if (!column.include_in_final) meta.push('Excluded')
  if (!meta.length) meta.push(formatAssessmentTypeLabel(column.assessment_type))
  return meta.join(' | ')
}

export function getColumnStats(
  students: GradebookStudentSummary[],
  column: GradebookAssessmentColumn,
) {
  const gradedCells = students
    .map((student) => getAssessmentCell(student, column))
    .filter((cell): cell is GradebookAssessmentCell => Boolean(cell?.is_graded))

  const percentValues = gradedCells
    .map((cell) => cell.percent)
    .filter((value): value is number => value != null)
  const earnedValues = gradedCells
    .map((cell) => cell.earned)
    .filter((value): value is number => value != null)

  return {
    averagePercent: average(percentValues),
    medianPercent: median(percentValues),
    averageEarned: average(earnedValues),
    medianEarned: median(earnedValues),
  }
}

export function formatColumnStat(
  stats: ReturnType<typeof getColumnStats>,
  column: GradebookAssessmentColumn,
  stat: 'average' | 'median',
  displayMode: ScoreDisplayMode,
): string {
  if (displayMode === 'raw') {
    const earned = stat === 'average' ? stats.averageEarned : stats.medianEarned
    return earned == null ? '—' : `${formatPoints(earned)}/${formatPoints(column.possible)}`
  }

  return formatCompactPercent(stat === 'average' ? stats.averagePercent : stats.medianPercent)
}
