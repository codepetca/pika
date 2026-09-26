'use client'

import { useState } from 'react'
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
    earned: i === 0 ? 20.6 : 80.5 + index, possible: 100,
    percent: i === 0 ? 20.6 : 80.5 + index, is_graded: true,
    is_manual_override: i === 1,
  })),
}))
const noop = () => {}

/** Deterministic evidence using the production toolbar and table owners. */
export function GradebookCompactPattern() {
  const [preferences, setPreferences] = useState({ ...DEFAULT_GRADEBOOK_PREFERENCES, showWeights: true })
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({})
  return <div className="space-y-3" data-testid="gradebook-compact-pattern">
    <GradebookToolbar preferences={preferences} onChange={(changes) => setPreferences((value) => ({ ...value, ...changes }))}
      selectedCount={0} isReadOnly={false} onEditCategories={noop} onCopyEmails={noop} onExport={noop}
      studentGradesVisible={false} onStudentGradesVisibilityChange={noop} />
    <div className="h-96">
      <GradebookTable students={students} columns={columns} displayMode={preferences.scoreDisplayMode}
        ultraCompact={preferences.ultraCompact} lastNameFirst={preferences.lastNameFirst}
        showStudentIds={preferences.showStudentIds} showWeights={preferences.showWeights}
        keepKeyColumnsVisible={preferences.keepKeyColumnsVisible}
        columnWidths={{ first_name: 96, last_name: 96, id: 80, final: 88 }} onColumnWidthChange={noop}
        weightDrafts={weightDrafts} savingKeys={new Set()} isReadOnly={false}
        onWeightDraftChange={(column, value) => setWeightDrafts((drafts) => ({ ...drafts, [`${column.assessment_type}:${column.assessment_id}`]: value }))}
        onWeightCommit={noop} onAssessmentOpen={noop} onScoreOpen={noop} onFinalScoreOpen={noop}
        selectedIds={new Set()} allSelected={false} someSelected={false} toggleSelect={noop} toggleSelectAll={noop}
        selectedStudentId={null} onStudentSelect={noop} onStudentDeselect={noop}
        sortColumn="first_name" sortDirection="asc" onSort={noop} />
    </div>
  </div>
}
