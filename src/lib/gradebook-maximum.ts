import type { GradebookAssessmentCell, GradebookAssessmentColumn } from '@/types'
import { getAssessmentColumnKey, round2 } from '@/lib/gradebook-display'

export type MaximumChangeMode = 'keep_marks' | 'preserve_percentages'
export interface GradebookMaximumState {
  assessment_type: GradebookAssessmentColumn['assessment_type']
  assessment_id: string
  maximum: number | null
  score_scale: number
}

export function applyMaximumToCell(cell: GradebookAssessmentCell, state?: GradebookMaximumState): void {
  if (!state) return
  const sourcePossible = cell.possible
  const sourcePercent = cell.percent
  cell.possible = state.maximum ?? sourcePossible
  if (cell.earned != null) cell.earned = cell.earned * state.score_scale
  if (cell.calculated_earned != null) cell.calculated_earned = cell.calculated_earned * state.score_scale
  cell.percent = cell.is_graded && cell.earned != null && cell.possible > 0 ? round2(sourcePercent != null ? sourcePercent * state.score_scale * sourcePossible / cell.possible : cell.earned / cell.possible * 100) : null
}

export function applyMaximumToColumn(column: GradebookAssessmentColumn, state?: GradebookMaximumState) {
  column.source_possible = column.possible
  column.maximum_scale = state?.score_scale ?? 1
  if (state?.maximum != null) {
    column.possible = state.maximum
    column.is_maximum_override = true
  }
}

/** Mirrors the atomic maximum writer for deterministic Pattern Lab evidence. */
export function previewMaximumChange(column: GradebookAssessmentColumn, maximum: number, mode: MaximumChangeMode): GradebookMaximumState {
  return { assessment_type: column.assessment_type, assessment_id: column.assessment_id,
    maximum, score_scale: (column.maximum_scale ?? 1) * (mode === 'preserve_percentages' ? maximum / column.possible : 1) }
}

export function maximumStateMap(states: GradebookMaximumState[]) {
  return new Map(states.map((state) => [getAssessmentColumnKey(state), state]))
}
