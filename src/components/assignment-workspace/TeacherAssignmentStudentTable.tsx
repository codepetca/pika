'use client'

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { AssignmentArtifactsCell } from '@/components/AssignmentArtifactsCell'
import {
  AssessmentStatusIndicator,
  getAssignmentWorkStatusDisplay,
  type AssessmentWorkStatusDisplay,
} from '@/components/AssessmentStatusIndicator'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  TableCard,
} from '@/components/DataTable'
import { Spinner } from '@/components/Spinner'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip } from '@/ui'
import {
  hasDraftSavedGrade,
} from '@/lib/assignments'
import type { AssignmentStatus } from '@/types'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'
import type { SortDirection } from '@/lib/table-sort'

export interface TeacherAssignmentStudentRow {
  student_id: string
  student_email: string
  student_first_name: string | null
  student_last_name: string | null
  status: AssignmentStatus
  student_updated_at?: string | null
  artifacts: AssignmentArtifact[]
  doc: {
    is_submitted?: boolean | null
    submitted_at?: string | null
    updated_at?: string | null
    score_completion?: number | null
    score_thinking?: number | null
    score_workflow?: number | null
    graded_at?: string | null
    returned_at?: string | null
    teacher_cleared_at?: string | null
    feedback_returned_at?: string | null
  } | null
}

interface TeacherAssignmentStudentTableProps {
  rows: TeacherAssignmentStudentRow[]
  selectedStudentId: string | null
  onSelectStudent: (studentId: string) => void
  onDeselectStudent: () => void
  tableRef?: Ref<HTMLDivElement>
  selectedIds: Set<string>
  onToggleSelect: (studentId: string) => void
  onToggleSelectAll: () => void
  allSelected: boolean
  sortColumn: 'first' | 'last' | 'status'
  sortDirection: SortDirection
  onToggleSort: (column: 'first' | 'last' | 'status') => void
  dueAtMs: number
  density: 'tight' | 'compact'
  loading: boolean
  error: string
  emptyMessage?: string
  busyOverlay?: ReactNode
}

type ResizableColumnKey = 'first' | 'last' | 'status' | 'grade'

type ColumnWidths = Record<ResizableColumnKey, number>

const COLUMN_LIMITS: Record<ResizableColumnKey, { defaultWidth: number; min: number; max: number }> = {
  first: { defaultWidth: 72, min: 58, max: 160 },
  last: { defaultWidth: 72, min: 58, max: 160 },
  status: { defaultWidth: 78, min: 70, max: 110 },
  grade: { defaultWidth: 62, min: 56, max: 88 },
}

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  first: COLUMN_LIMITS.first.defaultWidth,
  last: COLUMN_LIMITS.last.defaultWidth,
  status: COLUMN_LIMITS.status.defaultWidth,
  grade: COLUMN_LIMITS.grade.defaultWidth,
}

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer border-l-2 border-l-primary bg-surface-selected shadow-sm'
  }
  return 'cursor-pointer hover:bg-surface-hover'
}

function clampColumnWidth(column: ResizableColumnKey, width: number): number {
  const limits = COLUMN_LIMITS[column]
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)))
}

function getColumnStyle(width: number): CSSProperties {
  return { width: `${width}px`, maxWidth: `${width}px` }
}

function ResizeHandle({
  column,
  label,
  width,
  onResize,
}: {
  column: ResizableColumnKey
  label: string
  width: number
  onResize: (column: ResizableColumnKey, width: number) => void
}) {
  function handlePointerDown(event: PointerEvent<HTMLSpanElement>) {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      onResize(column, startWidth + moveEvent.clientX - startX)
    }

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    onResize(column, width + (event.key === 'ArrowRight' ? 8 : -8))
  }

  return (
    <span
      role="separator"
      aria-label={`Resize ${label} column`}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className="absolute inset-y-1 right-0 z-10 w-2 cursor-col-resize rounded-sm outline-none transition-colors hover:bg-border-strong focus:bg-primary"
    />
  )
}

function ResizableSortableHeaderCell({
  column,
  label,
  isActive,
  direction,
  onSort,
  width,
  onResize,
}: {
  column: ResizableColumnKey
  label: string
  isActive: boolean
  direction: SortDirection
  onSort: () => void
  width: number
  onResize: (column: ResizableColumnKey, width: number) => void
}) {
  const Icon = direction === 'asc' ? ChevronUp : ChevronDown
  const ariaSort = isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <DataTableHeaderCell
      className="relative !p-0"
      style={getColumnStyle(width)}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={onSort}
        className="relative flex w-full items-center py-2 pl-1.5 pr-4 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Icon
          className={[
            'pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 shrink-0 text-text-muted',
            isActive ? '' : 'opacity-0',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>
      <ResizeHandle column={column} label={label} width={width} onResize={onResize} />
    </DataTableHeaderCell>
  )
}

function ResizableHeaderCell({
  column,
  label,
  width,
  onResize,
}: {
  column: ResizableColumnKey
  label: string
  width: number
  onResize: (column: ResizableColumnKey, width: number) => void
}) {
  return (
    <DataTableHeaderCell
      className="relative !py-2 !pl-1.5 !pr-3"
      style={getColumnStyle(width)}
    >
      <span className="block truncate">{label}</span>
      <ResizeHandle column={column} label={label} width={width} onResize={onResize} />
    </DataTableHeaderCell>
  )
}

function StatusIcon({ display }: { display: AssessmentWorkStatusDisplay }) {
  const icon = <AssessmentStatusIndicator display={display} showLabel={false} />

  if (display.shortLabel) {
    return (
      <span
        className={[
          'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-[11px] font-semibold leading-none',
          display.chipClassName,
        ].filter(Boolean).join(' ')}
        data-testid="assignment-status-resubmitted-chip"
      >
        {icon}
        <span>{display.shortLabel}</span>
      </span>
    )
  }

  return icon
}

export function TeacherAssignmentStudentTable({
  rows,
  selectedStudentId,
  onSelectStudent,
  onDeselectStudent,
  tableRef,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  sortColumn,
  sortDirection,
  onToggleSort,
  dueAtMs,
  density,
  loading,
  error,
  emptyMessage = 'No students enrolled',
  busyOverlay,
}: TeacherAssignmentStudentTableProps) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(DEFAULT_COLUMN_WIDTHS)

  function handleColumnResize(column: ResizableColumnKey, width: number) {
    setColumnWidths((current) => ({
      ...current,
      [column]: clampColumnWidth(column, width),
    }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KeyboardNavigableTable
        ref={tableRef}
        rowKeys={rows.map((student) => student.student_id)}
        selectedKey={selectedStudentId}
        onSelectKey={onSelectStudent}
        onDeselect={onDeselectStudent}
      >
        <TableCard chrome="flush">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-danger">
              {error}
            </div>
          ) : (
            <div className="relative">
              {busyOverlay}
              <DataTable density={density} className="table-fixed">
                <colgroup>
                  <col style={{ width: '40px' }} />
                  <col style={{ width: `${columnWidths.first}px` }} />
                  <col style={{ width: `${columnWidths.last}px` }} />
                  <col style={{ width: `${columnWidths.status}px` }} />
                  <col style={{ width: `${columnWidths.grade}px` }} />
                  <col />
                </colgroup>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell className="w-10 !px-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={onToggleSelectAll}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        aria-label="Select all students"
                      />
                    </DataTableHeaderCell>
                    <ResizableSortableHeaderCell
                      column="first"
                      label="First"
                      isActive={sortColumn === 'first'}
                      direction={sortDirection}
                      onSort={() => onToggleSort('first')}
                      width={columnWidths.first}
                      onResize={handleColumnResize}
                    />
                    <ResizableSortableHeaderCell
                      column="last"
                      label="Last"
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onSort={() => onToggleSort('last')}
                      width={columnWidths.last}
                      onResize={handleColumnResize}
                    />
                    <ResizableSortableHeaderCell
                      column="status"
                      label="Status"
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onSort={() => onToggleSort('status')}
                      width={columnWidths.status}
                      onResize={handleColumnResize}
                    />
                    <ResizableHeaderCell
                      column="grade"
                      label="Grade"
                      width={columnWidths.grade}
                      onResize={handleColumnResize}
                    />
                    <DataTableHeaderCell className="whitespace-nowrap !px-1.5 !py-2">
                      <span className="block truncate">Artifacts</span>
                    </DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((student) => {
                    const isSelected = selectedStudentId === student.student_id
                    const totalScore =
                      student.doc?.score_completion != null &&
                      student.doc?.score_thinking != null &&
                      student.doc?.score_workflow != null
                        ? student.doc.score_completion + student.doc.score_thinking + student.doc.score_workflow
                        : null
                    const hasDraftGrade = hasDraftSavedGrade(student.doc ? {
                      graded_at: student.doc.graded_at ?? null,
                      score_completion: student.doc.score_completion ?? null,
                      score_thinking: student.doc.score_thinking ?? null,
                      score_workflow: student.doc.score_workflow ?? null,
                    } : null)
                    const wasLate = !!(
                      student.doc?.submitted_at &&
                      dueAtMs &&
                      new Date(student.doc.submitted_at).getTime() > dueAtMs
                    )
                    const statusDisplay = getAssignmentWorkStatusDisplay(student.status, {
                      wasLate,
                      hasDraftGrade,
                    })
                    const statusLabel = statusDisplay.label

                    return (
                      <DataTableRow
                        key={student.student_id}
                        className={getRowClassName(isSelected)}
                        onClick={() => onSelectStudent(student.student_id)}
                      >
                        <DataTableCell className="!px-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(student.student_id)}
                            onChange={() => onToggleSelect(student.student_id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                            aria-label={`Select ${student.student_first_name ?? ''} ${student.student_last_name ?? ''}`}
                          />
                        </DataTableCell>
                        <DataTableCell className="truncate !px-1.5" style={getColumnStyle(columnWidths.first)}>
                          {student.student_first_name ? (
                            <Tooltip content={`${student.student_first_name} ${student.student_last_name ?? ''}`}>
                              <span className="block truncate">{student.student_first_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell className="truncate !px-1.5" style={getColumnStyle(columnWidths.last)}>
                          {student.student_last_name ? (
                            <Tooltip content={student.student_last_name}>
                              <span className="block truncate">{student.student_last_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell align="center" className="!px-1" style={getColumnStyle(columnWidths.status)}>
                          <Tooltip content={statusLabel}>
                            <span className="inline-flex" role="img" aria-label={statusLabel}>
                              <StatusIcon display={statusDisplay} />
                            </span>
                          </Tooltip>
                        </DataTableCell>
                        <DataTableCell align="center" className="whitespace-nowrap !px-1.5 text-text-muted" style={getColumnStyle(columnWidths.grade)}>
                          {totalScore !== null ? `${Math.round((totalScore / 30) * 100)}` : '—'}
                        </DataTableCell>
                        <DataTableCell className="align-top !px-1.5">
                          <AssignmentArtifactsCell
                            artifacts={student.artifacts || []}
                            isCompact={density === 'tight'}
                          />
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                  {rows.length === 0 && (
                    <EmptyStateRow colSpan={6} message={emptyMessage} />
                  )}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </TableCard>
      </KeyboardNavigableTable>
    </div>
  )
}
