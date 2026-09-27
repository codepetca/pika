'use client'

import { useState } from 'react'
import { Button } from '@/ui'
import { GradebookScoreDialog } from '@/components/gradebook/GradebookScoreDialog'
import { applyMaximumToCell, applyMaximumToColumn, previewMaximumChange, type GradebookMaximumState, type MaximumChangeMode } from '@/lib/gradebook-maximum'
import { calculateCategorizedFinalPercent } from '@/lib/gradebook'
import { getAssessmentColumnKey } from '@/lib/gradebook-display'
import { GradebookTable } from '@/components/gradebook/GradebookTable'
import { GradebookToolbar } from '@/components/gradebook/GradebookToolbar'
import { DEFAULT_GRADEBOOK_PREFERENCES } from '@/lib/gradebook-editor'
import type { GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'

const columns: GradebookAssessmentColumn[] = Array.from({ length: 12 }, (_, index) => ({
  assessment_id: String(index), assessment_type: index % 2 ? 'test' : 'assignment',
  code: `${index % 2 ? 'T' : 'A'}${Math.floor(index / 2) + 1}`,
  title: `${index % 2 ? 'Unit test' : 'Research assignment'} ${Math.floor(index / 2) + 1}`,
  possible: 100, weight: 10, include_in_final: true,
  category_id: 'term', category_name: index === 0 ? 'Term Work' : 'Term', category_percentage: 100,
}))
const students: GradebookStudentSummary[] = ['Avery', 'Grace', 'Lucas'].map((name, index) => ({
  student_id: String(index), student_email: `${name.toLowerCase()}@example.test`,
  student_first_name: name, student_last_name: ['Chen', 'Hopper', 'Tremblay'][index],
  student_number: `100${index}`, final_percent: 81.7 + index,
  assignments_earned: null, assignments_possible: null, assignments_percent: null,
  tests_earned: null, tests_possible: null, tests_percent: null,
  assessment_scores: columns.map((column, i) => ({
    assessment_id: column.assessment_id, assessment_type: column.assessment_type,
    earned: i === 0 ? 20.6 : i === 1 ? 110.5 + index : 80.5 + index, possible: 100,
    percent: i === 0 ? 20.6 : i === 1 ? 110.5 + index : 80.5 + index, is_graded: true,
    is_manual_override: i === 1,
  })),
}))
const noop = () => {}

/** Deterministic evidence using the production toolbar and table owners. */
export function GradebookCompactPattern() {
  const [preferences, setPreferences] = useState({ ...DEFAULT_GRADEBOOK_PREFERENCES, showWeights: true })
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({})
  const [maximumEditsEnabled, setMaximumEditsEnabled] = useState(true)
  const [maximums, setMaximums] = useState<Record<string, GradebookMaximumState>>({})
  const [maximumTarget, setMaximumTarget] = useState<GradebookAssessmentColumn | null>(null)
  const displayedColumns = columns.map((column) => {
    const result = { ...column }
    applyMaximumToColumn(result, maximums[getAssessmentColumnKey(column)])
    return result
  })
  const displayedStudents = students.map((student) => {
    const cells = student.assessment_scores?.map((cell) => {
      const result = { ...cell }
      applyMaximumToCell(result, maximums[getAssessmentColumnKey(cell)])
      return result
    }) ?? []
    const calculation = calculateCategorizedFinalPercent({ categories: [{ id: 'term', percentage: 100 }],
      items: cells.filter((cell) => cell.earned != null).map((cell) => ({ earned: cell.earned!, possible: cell.possible, weight: 10, categoryId: 'term' })) })
    return { ...student, assessment_scores: cells, final_percent: calculation.finalPercent }
  })
  function saveMaximum(maximum: number, mode: MaximumChangeMode = 'keep_marks') {
    if (!maximumTarget) return
    setMaximums((values) => ({ ...values, [getAssessmentColumnKey(maximumTarget)]: previewMaximumChange(maximumTarget, maximum, mode) }))
    setMaximumTarget(null)
  }
  return <div className="space-y-3" data-testid="gradebook-compact-pattern">
    <GradebookToolbar preferences={preferences} onChange={(changes) => setPreferences((value) => ({ ...value, ...changes }))}
      selectedCount={0} isReadOnly={false} onEditCategories={noop} onCopyEmails={noop} onExport={noop}
      studentGradesVisible={false} onStudentGradesVisibilityChange={noop} />
    <Button variant="secondary" aria-pressed={!maximumEditsEnabled} onClick={() => setMaximumEditsEnabled((enabled) => !enabled)}>Pause maximum changes (fixture)</Button>
    <div className="h-96">
      <GradebookTable students={displayedStudents} columns={displayedColumns} displayMode={preferences.scoreDisplayMode}
        ultraCompact={preferences.ultraCompact} lastNameFirst={preferences.lastNameFirst}
        showStudentIds={preferences.showStudentIds} showWeights={preferences.showWeights}
        keepKeyColumnsVisible={preferences.keepKeyColumnsVisible}
        columnWidths={{ first_name: 96, last_name: 96, id: 80, final: 88 }} onColumnWidthChange={noop}
        weightDrafts={weightDrafts} savingKeys={new Set()} isReadOnly={false}
        onWeightDraftChange={(column, value) => setWeightDrafts((drafts) => ({ ...drafts, [`${column.assessment_type}:${column.assessment_id}`]: value }))}
        onWeightCommit={noop} onAssessmentOpen={noop} maximumEditsEnabled={maximumEditsEnabled} onMaxMarkOpen={setMaximumTarget} onScoreOpen={noop} onFinalScoreOpen={noop}
        selectedIds={new Set()} allSelected={false} someSelected={false} toggleSelect={noop} toggleSelectAll={noop}
        selectedStudentId={null} onStudentSelect={noop} onStudentDeselect={noop}
        sortColumn="first_name" sortDirection="asc" onSort={noop} />
    </div>
    <GradebookScoreDialog isOpen={Boolean(maximumTarget)} student={null} maximumChangesDisabled={!maximumEditsEnabled}
      target={maximumTarget ? { kind: 'maximum', title: maximumTarget.title, value: maximumTarget.possible,
        isOverride: maximumTarget.is_maximum_override, undoValue: maximumTarget.source_possible } : null}
      isSaving={false} onClose={() => setMaximumTarget(null)} onSave={saveMaximum}
      onUndo={() => {
        if (!maximumTarget) return false
        setMaximums((values) => { const next = { ...values }; delete next[getAssessmentColumnKey(maximumTarget)]; return next })
        setMaximumTarget({ ...maximumTarget, possible: maximumTarget.source_possible ?? maximumTarget.possible, is_maximum_override: false, maximum_scale: 1 })
        return true
      }} />
  </div>
}
