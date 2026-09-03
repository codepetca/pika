'use client'

import type { Ref } from 'react'
import type { GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'
import {
  Button, DataTable, DataTableBody, DataTableCell, DataTableHead,
  DataTableHeaderCell, DataTableRow, EmptyStateRow, FormField, Input,
  KeyboardNavigableTable, SortableHeaderCell, TableSelectionCell,
  TableSelectionHeaderCell, Tooltip, cn,
} from '@/ui'
import {
  average, median, formatAssessmentScore, formatColumnStat, formatCompactPercent,
  formatPercent, getAssessmentCell, getAssessmentCellPercent, getAssessmentColumnKey,
  getColumnStats, getGradebookStudentRowId, getGradePercentTextClass,
  getStudentDisplayId, getStudentIdentityValue, getStudentName,
  type GradebookIdentityColumn, type GradebookSummaryKind, type ScoreDisplayMode,
} from '@/lib/gradebook-display'
import { gradebookCourseWeightPreviews, isValidGradebookWeight } from '@/lib/gradebook-editor'

export interface GradebookTableProps {
  students: GradebookStudentSummary[]
  columns: GradebookAssessmentColumn[]
  displayMode: ScoreDisplayMode
  summaryKind: GradebookSummaryKind
  lastNameFirst: boolean
  showStudentIds: boolean
  showWeights: boolean
  keepKeyColumnsVisible: boolean
  columnWidths: Record<GradebookIdentityColumn | 'final', number>
  onColumnWidthChange: (column: GradebookIdentityColumn | 'final', width: number) => void
  weightDrafts: Record<string, string>
  savingKeys: Set<string>
  isReadOnly: boolean
  onWeightDraftChange: (column: GradebookAssessmentColumn, value: string) => void
  onWeightCommit: (column: GradebookAssessmentColumn) => void
  onAssessmentOpen: (column: GradebookAssessmentColumn) => void
  selectedIds: Set<string>
  allSelected: boolean
  someSelected: boolean
  toggleSelect: (id: string) => void
  toggleSelectAll: () => void
  selectedStudentId: string | null
  onStudentSelect: (student: GradebookStudentSummary) => void
  onStudentDeselect: () => void
  sortColumn: GradebookIdentityColumn
  sortDirection: 'asc' | 'desc'
  onSort: (column: GradebookIdentityColumn) => void
  scrollContainerRef?: Ref<HTMLDivElement>
  onScroll?: () => void
}

const SELECTION_WIDTH = 40
const ASSESSMENT_WIDTH = 88

/** Gradebook-only matrix; persistence and calculations remain outside this renderer. */
export function GradebookTable({
  students, columns, displayMode, summaryKind, lastNameFirst, showStudentIds,
  showWeights, keepKeyColumnsVisible: frozen, columnWidths, onColumnWidthChange,
  weightDrafts, savingKeys, isReadOnly, onWeightDraftChange, onWeightCommit,
  onAssessmentOpen, selectedIds, allSelected, someSelected, toggleSelect,
  toggleSelectAll, selectedStudentId, onStudentSelect, onStudentDeselect,
  sortColumn, sortDirection, onSort, scrollContainerRef, onScroll,
}: GradebookTableProps) {
  const names: Array<{ key: GradebookIdentityColumn; label: string }> = lastNameFirst
    ? [{ key: 'last_name', label: 'Last' }, { key: 'first_name', label: 'First' }]
    : [{ key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' }]
  // A flexible spacer keeps Final at the far edge without stretching assessment columns.
  const filler = true
  const minWidth = SELECTION_WIDTH + columnWidths.first_name + columnWidths.last_name
    + (showStudentIds ? columnWidths.id : 0) + columnWidths.final
    + Math.max(1, columns.length) * ASSESSMENT_WIDTH
  const colSpan = 3 + (showStudentIds ? 1 : 0) + columns.length + (filler ? 1 : 0) + 1
  const finalValues = students.map((s) => s.final_percent).filter((v): v is number => v != null)
  const finalSummary = summaryKind === 'average' ? average(finalValues) : median(finalValues)
  const courseWeights = gradebookCourseWeightPreviews(columns, weightDrafts)
  const rowLabelClass = cn('whitespace-normal bg-surface-2 !px-2 text-xs font-medium leading-tight text-text-muted', frozen && 'sticky left-10 border-r border-border-strong')

  return (
    <KeyboardNavigableTable
      ref={scrollContainerRef}
      ariaLabel="Gradebook students"
      rowKeys={students.map((student) => student.student_id)}
      selectedKey={selectedStudentId}
      onSelectKey={(id) => { const student = students.find((s) => s.student_id === id); if (student) onStudentSelect(student) }}
      onDeselect={onStudentDeselect}
      getRowId={getGradebookStudentRowId}
      className="relative isolate h-full min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-surface"
      data-testid="gradebook-student-scroll-pane"
      onScroll={onScroll}
    >
      <div style={{ minWidth }}>
        <DataTable density="tight" className="table-fixed border-separate border-spacing-0">
          <colgroup>
            <col style={{ width: SELECTION_WIDTH }} />
            {names.map(({ key }) => <col key={key} style={{ width: columnWidths[key] }} />)}
            {showStudentIds ? <col style={{ width: columnWidths.id }} /> : null}
            {columns.map((column) => <col key={getAssessmentColumnKey(column)} style={{ width: ASSESSMENT_WIDTH }} />)}
            {filler ? <col /> : null}
            <col style={{ width: columnWidths.final }} />
          </colgroup>
          <DataTableHead sticky>
            <DataTableRow>
              <TableSelectionHeaderCell className={cn('border-b border-border bg-surface-2', frozen && 'sticky left-0 z-sticky-table')} checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} ariaLabel="Select all students" />
              {names.map((column, index) => (
                <SortableHeaderCell
                  key={column.key} label={column.label} isActive={sortColumn === column.key}
                  direction={sortDirection} onClick={() => onSort(column.key)}
                  className={cn('border-b border-border bg-surface-2', frozen && index === 0 && 'sticky left-10 z-sticky-table border-r border-border-strong')}
                  resize={{ value: columnWidths[column.key], min: 72, max: 220, onChange: (width) => onColumnWidthChange(column.key, width) }}
                />
              ))}
              {showStudentIds ? <SortableHeaderCell label="ID" isActive={sortColumn === 'id'} direction={sortDirection} onClick={() => onSort('id')} className="border-b border-border bg-surface-2" /> : null}
              {columns.map((column) => (
                <DataTableHeaderCell key={getAssessmentColumnKey(column)} align="center" className="overflow-hidden whitespace-nowrap border-b border-border bg-surface-2 !px-1">
                  <Tooltip content={`${column.title} · ${column.category_name ?? 'None'}`} side="bottom">
                    <Button type="button" variant="ghost" size="xs" disabled={isReadOnly} onClick={() => onAssessmentOpen(column)} aria-label={`Edit ${column.code}: ${column.title}`} className="w-full overflow-hidden px-1 font-normal text-text-default">
                      <span className="min-w-0 truncate">{column.title}</span>
                    </Button>
                  </Tooltip>
                </DataTableHeaderCell>
              ))}
              {filler ? <DataTableHeaderCell align="center" className="border-b border-border bg-surface-2">{columns.length ? <span className="sr-only">Unused assessment space</span> : 'Assessments'}</DataTableHeaderCell> : null}
              <DataTableHeaderCell align="right" className={cn('border-b border-border bg-surface-2', frozen && 'sticky right-0 z-sticky-table border-l border-border-strong')}>Final</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          {showWeights && columns.length > 0 ? (
            <tbody aria-label="Assessment weights">
              <DataTableRow aria-label="Category weight">
                <DataTableCell className={cn('bg-surface-2', frozen && 'sticky left-0')}>{null}</DataTableCell>
                <DataTableHeaderCell scope="row" align="right" className={rowLabelClass}>Category weight</DataTableHeaderCell>
                <DataTableCell className="bg-surface-2">{null}</DataTableCell>
                {showStudentIds ? <DataTableCell className="bg-surface-2">{null}</DataTableCell> : null}
                {columns.map((column) => {
                  const key = getAssessmentColumnKey(column)
                  const value = weightDrafts[key] ?? String(column.weight)
                  const valid = value.trim() !== '' && isValidGradebookWeight(Number(value))
                  return <DataTableCell key={key} align="center" className="bg-surface-2 !px-1">
                    <FormField label={`Category weight for ${column.title}`} hideLabel collapseHiddenLabel>
                      <Input type="number" min={1} max={999} step={1} value={value} aria-invalid={!valid} disabled={isReadOnly || savingKeys.has(key)}
                        className="px-1 text-center text-sm tabular-nums" title="Enter a whole number from 1 to 999"
                        onChange={(event) => onWeightDraftChange(column, event.target.value)}
                        onBlur={() => onWeightCommit(column)}
                        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                    </FormField>
                  </DataTableCell>
                })}
                {filler ? <DataTableCell className="bg-surface-2">{null}</DataTableCell> : null}
                <DataTableCell className={cn('bg-surface-2', frozen && 'sticky right-0 border-l border-border-strong')}>{null}</DataTableCell>
              </DataTableRow>
              <DataTableRow aria-label="Course weight">
                <DataTableCell className={cn('border-b border-border-strong bg-surface-2', frozen && 'sticky left-0')}>{null}</DataTableCell>
                <DataTableHeaderCell scope="row" align="right" className={cn(rowLabelClass, 'border-b border-border-strong')}>Course weight</DataTableHeaderCell>
                <DataTableCell className="border-b border-border-strong bg-surface-2">{null}</DataTableCell>
                {showStudentIds ? <DataTableCell className="border-b border-border-strong bg-surface-2">{null}</DataTableCell> : null}
                {columns.map((column) => <DataTableCell key={getAssessmentColumnKey(column)} align="center" className="border-b border-border-strong bg-surface-2 text-xs font-medium tabular-nums">
                  <output aria-label={`Course weight for ${column.title}`}>{courseWeights[getAssessmentColumnKey(column)] == null ? '—' : `${courseWeights[getAssessmentColumnKey(column)]}%`}</output>
                </DataTableCell>)}
                {filler ? <DataTableCell className="border-b border-border-strong bg-surface-2">{null}</DataTableCell> : null}
                <DataTableCell className={cn('border-b border-border-strong bg-surface-2', frozen && 'sticky right-0 border-l border-border-strong')}>{null}</DataTableCell>
              </DataTableRow>
            </tbody>
          ) : null}
          <DataTableBody>
            {students.map((student) => {
              const active = selectedStudentId === student.student_id
              const selected = selectedIds.has(student.student_id)
              const surface = active || selected ? 'bg-surface-3' : 'bg-surface group-hover:bg-surface-hover'
              return <DataTableRow key={student.student_id} id={getGradebookStudentRowId(student.student_id)} tabIndex={-1} aria-selected={active}
                className={cn('group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary', active || selected ? 'bg-surface-3' : 'hover:bg-surface-hover')}
                onClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,a,label,select,textarea')) onStudentSelect(student) }}>
                <TableSelectionCell className={cn(frozen && 'sticky left-0', surface)} checked={selected} onChange={() => toggleSelect(student.student_id)} ariaLabel={`Select ${getStudentName(student)}`} />
                {names.map((column, index) => <DataTableCell key={column.key} title={getStudentIdentityValue(student, column.key)} className={cn('truncate whitespace-nowrap', frozen && index === 0 && 'sticky left-10 border-r border-border-strong', frozen && index === 0 && surface)}>{getStudentIdentityValue(student, column.key)}</DataTableCell>)}
                {showStudentIds ? <DataTableCell className="truncate">{getStudentDisplayId(student)}</DataTableCell> : null}
                {columns.map((column) => {
                  const cell = getAssessmentCell(student, column)
                  return <DataTableCell key={getAssessmentColumnKey(column)} align="center" className={cn('whitespace-nowrap tabular-nums', getGradePercentTextClass(getAssessmentCellPercent(cell)))}>{formatAssessmentScore(cell, displayMode)}</DataTableCell>
                })}
                {filler ? <DataTableCell aria-label={columns.length ? undefined : 'No assessments'}>{null}</DataTableCell> : null}
                <DataTableCell align="right" className={cn('whitespace-nowrap font-semibold tabular-nums', getGradePercentTextClass(student.final_percent), frozen && 'sticky right-0 border-l border-border-strong', frozen && surface)}>{formatPercent(student.final_percent)}</DataTableCell>
              </DataTableRow>
            })}
            {!students.length ? <EmptyStateRow colSpan={colSpan} message="No students enrolled yet" /> : null}
          </DataTableBody>
          {students.length > 0 && columns.length > 0 ? (
            <tfoot className="sticky bottom-0 z-sticky-table bg-surface-2" data-testid="gradebook-summary-footer">
              <DataTableRow aria-label={summaryKind === 'average' ? 'Class average' : 'Class median'}>
                <DataTableCell className={cn('border-t border-border-strong bg-surface-2 !px-1 text-center text-xs font-semibold uppercase text-text-muted', frozen && 'sticky left-0 z-sticky-table')}>{summaryKind === 'average' ? 'Avg' : 'Med'}</DataTableCell>
                {names.map((column, index) => <DataTableCell key={column.key} className={cn('border-t border-border-strong bg-surface-2', frozen && index === 0 && 'sticky left-10 z-sticky-table')}>{null}</DataTableCell>)}
                {showStudentIds ? <DataTableCell className="border-t border-border-strong bg-surface-2">{null}</DataTableCell> : null}
                {columns.map((column) => {
                  const stats = getColumnStats(students, column)
                  return <DataTableCell key={getAssessmentColumnKey(column)} align="center" className={cn('whitespace-nowrap border-t border-border-strong bg-surface-2 text-xs tabular-nums', getGradePercentTextClass(summaryKind === 'average' ? stats.averagePercent : stats.medianPercent))}>{formatColumnStat(stats, column, summaryKind, displayMode)}</DataTableCell>
                })}
                {filler ? <DataTableCell className="border-t border-border-strong bg-surface-2">{null}</DataTableCell> : null}
                <DataTableCell align="right" className={cn('border-t border-border-strong bg-surface-2 font-semibold tabular-nums', getGradePercentTextClass(finalSummary), frozen && 'sticky right-0 z-sticky-table')}>{formatCompactPercent(finalSummary)}</DataTableCell>
              </DataTableRow>
            </tfoot>
          ) : null}
        </DataTable>
      </div>
    </KeyboardNavigableTable>
  )
}
