'use client'

import { ChevronDown, Dumbbell, MoreVertical, RotateCcw } from 'lucide-react'
import { Button, FormField, IconButton, Select } from '@/ui'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceActionCluster, TeacherWorkSurfaceIconMenuButton, TeacherWorkSurfaceMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { ScoreDisplayMode } from '@/lib/gradebook-display'

import type { GradebookDisplayPreferences } from '@/lib/gradebook-editor'
export type { GradebookDisplayPreferences } from '@/lib/gradebook-editor'

export function GradebookScoreDisplayToggle({
  value,
  onChange,
}: {
  value: ScoreDisplayMode
  onChange: (value: ScoreDisplayMode) => void
}) {
  const label = value === 'percent' ? '%' : 'x/y'
  const nextLabel = value === 'percent' ? 'x/y' : '%'

  return (
    <div role="group" aria-label="Score display">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-w-control px-3 font-semibold tabular-nums"
        aria-label={`Score display: ${label}. Switch to ${nextLabel}`}
        onClick={() => onChange(value === 'percent' ? 'raw' : 'percent')}
      >
        {label}
      </Button>
    </div>
  )
}

export function GradebookToolbar({ preferences, onChange, selectedCount, isReadOnly, classAverage = '—', classMedian = '—', mobileStudentOptions = [], mobileStudentId = '', onMobileStudentChange = () => {}, hasManualChanges = false, undoingManualChanges = false, onUndoManualChanges, onEditCategories, onCopyEmails, onCopySecondaryEmails, onExport }: {
  preferences: GradebookDisplayPreferences
  onChange: (changes: Partial<GradebookDisplayPreferences>) => void
  selectedCount: number
  isReadOnly: boolean
  classAverage?: string
  classMedian?: string
  mobileStudentOptions?: Array<{ value: string; label: string }>
  mobileStudentId?: string
  onMobileStudentChange?: (studentId: string) => void
  hasManualChanges?: boolean
  undoingManualChanges?: boolean
  onUndoManualChanges?: () => void
  onEditCategories: () => void
  onCopyEmails: () => void
  onCopySecondaryEmails?: () => void
  onExport: () => void
}) {
  return <TeacherWorkSurfaceContextBar ariaLabel="Gradebook controls" primaryClassName="max-w-44 sm:max-w-none"
    context={<>
      <span className="hidden whitespace-nowrap lg:inline" aria-label={`Class Average ${classAverage} · Median ${classMedian}`}>
        Class Average <strong className="font-semibold tabular-nums text-text-default">{classAverage}</strong>
        <span aria-hidden="true"> · </span>
        Median <strong className="font-semibold tabular-nums text-text-default">{classMedian}</strong>
      </span>
      <FormField label="Student" hideLabel collapseHiddenLabel className="w-32 lg:hidden">
        <Select
          value={mobileStudentId}
          options={mobileStudentOptions}
          placeholder="Select student"
          className="min-h-8 py-1 text-sm"
          onChange={(event) => onMobileStudentChange(event.target.value)}
        />
      </FormField>
    </>}
    primary={<TeacherWorkSurfaceActionCluster className="max-w-full justify-start">
      <div className="hidden lg:block"><TeacherWorkSurfaceMenuButton
        buttonProps={{ 'aria-label': selectedCount ? `${selectedCount} selected` : 'Student Actions' }}
        label={<span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span>{selectedCount ? `${selectedCount} selected` : 'Student Actions'}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </span>}
        items={[
          { id: 'copy-emails', label: 'Copy emails', onSelect: onCopyEmails },
          { id: 'copy-secondary-emails', label: 'Copy email 2', disabled: !onCopySecondaryEmails, onSelect: () => onCopySecondaryEmails?.() },
        ]}
        disabled={!selectedCount} variant={selectedCount ? 'primary' : 'secondary'}
        menuAriaLabel="Student actions" menuAlign="start"
      /></div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto sm:overflow-visible" data-testid="gradebook-display-controls">
        <GradebookScoreDisplayToggle value={preferences.scoreDisplayMode} onChange={(scoreDisplayMode) => onChange({ scoreDisplayMode })} />
        <span className="hidden lg:inline-flex"><IconButton icon={Dumbbell} label="Show weights" variant={preferences.showWeights ? 'subtle' : 'ghost'} aria-pressed={preferences.showWeights} onClick={() => onChange({ showWeights: !preferences.showWeights })} /></span>
      </div>
    </TeacherWorkSurfaceActionCluster>}
    actions={<div className="hidden lg:block"><TeacherWorkSurfaceIconMenuButton ariaLabel="Gradebook more actions" tooltip="More actions" icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />} menuPlacement="down" menuAlign="end" items={[
      { id: 'edit-categories', label: 'Edit categories', disabled: isReadOnly, onSelect: onEditCategories },
      { id: 'name-order', label: preferences.lastNameFirst ? 'Show first name in column 1' : 'Show last name in column 1', onSelect: () => onChange({ lastNameFirst: !preferences.lastNameFirst }) },
      { id: 'student-ids', label: 'Show student IDs', checked: preferences.showStudentIds, onSelect: () => onChange({ showStudentIds: !preferences.showStudentIds }) },
      { id: 'sticky-columns', label: 'Keep key columns visible', checked: preferences.keepKeyColumnsVisible, onSelect: () => onChange({ keepKeyColumnsVisible: !preferences.keepKeyColumnsVisible }) },
      ...(hasManualChanges ? [{ id: 'undo-overrides', label: 'Undo all overrides', icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />, disabled: isReadOnly || undoingManualChanges || !onUndoManualChanges, dividerBefore: true, onSelect: () => onUndoManualChanges?.() }] : []),
      { id: 'export', label: 'Export gradebook', onSelect: onExport },
    ]} /></div>}
  />
}
