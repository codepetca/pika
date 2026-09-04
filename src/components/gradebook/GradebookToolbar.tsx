'use client'

import { ChevronDown, Dumbbell, MoreVertical, Users } from 'lucide-react'
import { Button, IconButton } from '@/ui'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceActionCluster, TeacherWorkSurfaceIconMenuButton, TeacherWorkSurfaceMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { GradebookSummaryKind, ScoreDisplayMode } from '@/lib/gradebook-display'

import type { GradebookDisplayPreferences } from '@/lib/gradebook-editor'
export type { GradebookDisplayPreferences } from '@/lib/gradebook-editor'

export function GradebookDisplayToggleButtons({
  scoreDisplayMode,
  summaryKind,
  onScoreDisplayModeChange,
  onSummaryKindChange,
}: {
  scoreDisplayMode: ScoreDisplayMode
  summaryKind: GradebookSummaryKind
  onScoreDisplayModeChange: (mode: ScoreDisplayMode) => void
  onSummaryKindChange: (kind: GradebookSummaryKind) => void
}) {
  const scoreLabel = scoreDisplayMode === 'percent' ? '%' : 'x/y'
  const nextScoreLabel = scoreDisplayMode === 'percent' ? 'x/y' : '%'
  const summaryLabel = summaryKind === 'average' ? 'AVG' : 'MED'
  const nextSummaryLabel = summaryKind === 'average' ? 'MED' : 'AVG'

  return (
    <>
      <div role="group" aria-label="Score display">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-control px-3 font-semibold tabular-nums"
          aria-label={`Score display: ${scoreLabel}. Switch to ${nextScoreLabel}`}
          onClick={() => onScoreDisplayModeChange(scoreDisplayMode === 'percent' ? 'raw' : 'percent')}
        >
          {scoreLabel}
        </Button>
      </div>
      <div role="group" aria-label="Class summary">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-w-control px-3 font-semibold tabular-nums"
          aria-label={`Class summary: ${summaryLabel}. Switch to ${nextSummaryLabel}`}
          onClick={() => onSummaryKindChange(summaryKind === 'average' ? 'median' : 'average')}
        >
          {summaryLabel}
        </Button>
      </div>
    </>
  )
}

export function GradebookToolbar({ preferences, onChange, selectedCount, isReadOnly, onEditCategories, onCopyEmails, onCopySecondaryEmails, onExport }: {
  preferences: GradebookDisplayPreferences
  onChange: (changes: Partial<GradebookDisplayPreferences>) => void
  selectedCount: number
  isReadOnly: boolean
  onEditCategories: () => void
  onCopyEmails: () => void
  onCopySecondaryEmails?: () => void
  onExport: () => void
}) {
  return <TeacherWorkSurfaceContextBar ariaLabel="Gradebook controls" primaryClassName="max-w-44 sm:max-w-none"
    primary={<TeacherWorkSurfaceActionCluster className="max-w-full justify-start">
      <TeacherWorkSurfaceMenuButton
        buttonProps={{ 'aria-label': selectedCount ? `${selectedCount} selected` : 'Student Actions' }}
        label={<span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="hidden sm:inline">{selectedCount ? `${selectedCount} selected` : 'Student Actions'}</span>
          <span className="sm:hidden" aria-hidden="true">{selectedCount || <Users className="h-4 w-4" />}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </span>}
        items={[
          { id: 'copy-emails', label: 'Copy emails', onSelect: onCopyEmails },
          { id: 'copy-secondary-emails', label: 'Copy email 2', disabled: !onCopySecondaryEmails, onSelect: () => onCopySecondaryEmails?.() },
        ]}
        disabled={!selectedCount} variant={selectedCount ? 'primary' : 'secondary'}
        menuAriaLabel="Student actions" menuAlign="start"
      />
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto sm:overflow-visible" data-testid="gradebook-display-controls">
        <GradebookDisplayToggleButtons
          scoreDisplayMode={preferences.scoreDisplayMode}
          summaryKind={preferences.summaryKind}
          onScoreDisplayModeChange={(scoreDisplayMode) => onChange({ scoreDisplayMode })}
          onSummaryKindChange={(summaryKind) => onChange({ summaryKind })}
        />
        <IconButton icon={Dumbbell} label="Show weights" variant={preferences.showWeights ? 'subtle' : 'ghost'} aria-pressed={preferences.showWeights} onClick={() => onChange({ showWeights: !preferences.showWeights })} />
      </div>
    </TeacherWorkSurfaceActionCluster>}
    actions={<TeacherWorkSurfaceIconMenuButton ariaLabel="Gradebook more actions" tooltip="More actions" icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />} menuPlacement="down" menuAlign="end" items={[
      { id: 'edit-categories', label: 'Edit categories', disabled: isReadOnly, onSelect: onEditCategories },
      { id: 'name-order', label: preferences.lastNameFirst ? 'Show first name in column 1' : 'Show last name in column 1', onSelect: () => onChange({ lastNameFirst: !preferences.lastNameFirst }) },
      { id: 'student-ids', label: 'Show student IDs', checked: preferences.showStudentIds, onSelect: () => onChange({ showStudentIds: !preferences.showStudentIds }) },
      { id: 'sticky-columns', label: 'Keep key columns visible', checked: preferences.keepKeyColumnsVisible, onSelect: () => onChange({ keepKeyColumnsVisible: !preferences.keepKeyColumnsVisible }) },
      { id: 'export', label: 'Export gradebook', onSelect: onExport },
    ]} />}
  />
}
