'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react'
import { ChevronDown, ChevronUp, Copy, Mail, Settings, X } from 'lucide-react'
import type {
  GradebookAssessmentCell,
  GradebookAssessmentColumn,
  Classroom,
  GradebookStudentSummary,
} from '@/types'
import {
  Button,
  Input,
  SegmentedControl,
  SplitButton,
  Tooltip,
  type SegmentedControlOption,
  type SplitButtonOption,
  useAppMessage,
} from '@/ui'
import {
  AssessmentStatusIndicator,
  getGradebookAssessmentStatusDisplay,
} from '@/components/AssessmentStatusIndicator'
import { Spinner } from '@/components/Spinner'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
} from '@/components/DataTable'
import {
  fetchJSONWithCache,
  invalidateCachedJSONMatching,
} from '@/lib/request-cache'
import { applyDirection, compareByNameFields, toggleSort } from '@/lib/table-sort'
import { useStudentSelection } from '@/hooks/useStudentSelection'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'

type GradebookSection = 'grades' | 'settings'
type ScoreDisplayMode = 'percent' | 'raw'
type GradebookSortColumn = 'first_name' | 'last_name' | 'id'
type GradebookIdentityColumn = 'first_name' | 'last_name' | 'id'
type GradebookFixedColumn = GradebookIdentityColumn | 'final'
type GradebookSummaryRow = 'average' | 'median'

interface GradebookPayload {
  assessment_columns?: GradebookAssessmentColumn[]
  students: GradebookStudentSummary[]
}

interface Props {
  classroom: Classroom
  sectionParam?: string | null
  onSectionChange?: (section: GradebookSection) => void
}

const DEFAULT_VISIBLE_COLUMNS: Record<GradebookFixedColumn, boolean> = {
  first_name: true,
  last_name: true,
  id: false,
  final: true,
}
const DEFAULT_VISIBLE_SUMMARY_ROWS: Record<GradebookSummaryRow, boolean> = {
  average: true,
  median: true,
}
const ASSESSMENT_WEIGHT_MIN = 1
const ASSESSMENT_WEIGHT_DEFAULT = 10
const ASSESSMENT_WEIGHT_MAX = 999
const SELECT_COLUMN_WIDTH_CLASS = 'w-10 min-w-10 max-w-10'
const EDIT_LABEL_COLUMN_WIDTH_CLASS = 'w-20 min-w-20 max-w-20'
const SELECT_COLUMN_WIDTH_PX = 40
const EDIT_LABEL_COLUMN_WIDTH_PX = 80
const IDENTITY_COLUMN_RESIZE_STEP = 8
const FINAL_COLUMN_SEPARATOR_CLASS = 'border-l border-border-strong'
const FINAL_COLUMN_DEFAULT_WIDTH = 96
const FINAL_COLUMN_MIN_WIDTH = 80
const FINAL_COLUMN_MAX_WIDTH = 220

const IDENTITY_COLUMN_DEFS: Array<{
  key: GradebookIdentityColumn
  label: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
}> = [
  { key: 'first_name', label: 'First', defaultWidth: 96, minWidth: 72, maxWidth: 220 },
  { key: 'last_name', label: 'Last', defaultWidth: 96, minWidth: 72, maxWidth: 220 },
  { key: 'id', label: 'ID', defaultWidth: 80, minWidth: 64, maxWidth: 180 },
]

const DEFAULT_IDENTITY_COLUMN_WIDTHS = IDENTITY_COLUMN_DEFS.reduce(
  (widths, column) => ({
    ...widths,
    [column.key]: column.defaultWidth,
  }),
  {} as Record<GradebookIdentityColumn, number>,
)

function formatPercent(value: number | null): string {
  if (value == null) return '—'
  return `${value.toFixed(1)}%`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function formatCompactPercent(value: number | null): string {
  if (value == null) return '—'
  const rounded = round2(value)
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`
}

function formatWeightShare(weight: number, total: number): string {
  if (!Number.isFinite(weight) || !Number.isFinite(total) || total <= 0) return '—'
  return formatCompactPercent((weight / total) * 100)
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatTorontoDateShort(iso: string): string {
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

function getStudentName(student: GradebookStudentSummary): string {
  return `${student.student_first_name || ''} ${student.student_last_name || ''}`.trim() || student.student_email
}

function getStudentDisplayId(student: GradebookStudentSummary): string {
  return student.student_number?.trim() || student.student_email.split('@')[0] || student.student_id
}

function getValidEmailList(emails: string[]): string[] {
  return [...new Set(emails.map((email) => email.trim()).filter((email) => email.includes('@')))]
}

function getStudentIdentityValue(student: GradebookStudentSummary, column: GradebookIdentityColumn): string {
  if (column === 'first_name') return student.student_first_name || '—'
  if (column === 'last_name') return student.student_last_name || '—'
  return getStudentDisplayId(student)
}

function getLeadingColumnWidthClass(editMode: boolean): string {
  return editMode ? EDIT_LABEL_COLUMN_WIDTH_CLASS : SELECT_COLUMN_WIDTH_CLASS
}

function getLeadingColumnWidthPx(editMode: boolean): number {
  return editMode ? EDIT_LABEL_COLUMN_WIDTH_PX : SELECT_COLUMN_WIDTH_PX
}

function getIdentityColumnDef(columnKey: GradebookIdentityColumn) {
  return IDENTITY_COLUMN_DEFS.find((column) => column.key === columnKey) || IDENTITY_COLUMN_DEFS[0]
}

function clampIdentityColumnWidth(columnKey: GradebookIdentityColumn, width: number): number {
  const column = getIdentityColumnDef(columnKey)
  return Math.min(column.maxWidth, Math.max(column.minWidth, Math.round(width)))
}

function clampFinalColumnWidth(width: number): number {
  return Math.min(FINAL_COLUMN_MAX_WIDTH, Math.max(FINAL_COLUMN_MIN_WIDTH, Math.round(width)))
}

function getIdentityStickyLeftPx(
  index: number,
  editMode: boolean,
  renderedColumns: Array<(typeof IDENTITY_COLUMN_DEFS)[number]>,
  columnWidths: Record<GradebookIdentityColumn, number>,
): number {
  return renderedColumns.slice(0, index).reduce(
    (left, column) => left + columnWidths[column.key],
    getLeadingColumnWidthPx(editMode),
  )
}

function getIdentityColumnStyle(
  column: (typeof IDENTITY_COLUMN_DEFS)[number],
  index: number,
  editMode: boolean,
  renderedColumns: Array<(typeof IDENTITY_COLUMN_DEFS)[number]>,
  columnWidths: Record<GradebookIdentityColumn, number>,
): CSSProperties {
  const width = columnWidths[column.key]
  return {
    left: `${getIdentityStickyLeftPx(index, editMode, renderedColumns, columnWidths)}px`,
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
  }
}

function getFinalColumnStyle(width: number): CSSProperties {
  return {
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
  }
}

function getIdentityColumnBorderClass(
  index: number,
  editMode: boolean,
  renderedColumns: Array<(typeof IDENTITY_COLUMN_DEFS)[number]>,
): string {
  if (index === renderedColumns.length - 1) return 'border-r border-border-strong'
  return editMode ? 'border-r border-border' : ''
}

function getAssessmentColumnKey(column: GradebookAssessmentColumn): string {
  return `${column.assessment_type}:${column.assessment_id}`
}

function getAssessmentCell(
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

function average(values: number[]): number | null {
  if (!values.length) return null
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return round2(sorted[middle])
  return round2((sorted[middle - 1] + sorted[middle]) / 2)
}

function formatAssessmentScore(cell: GradebookAssessmentCell | null, displayMode: ScoreDisplayMode): string {
  if (!cell?.is_graded) return '—'
  if (displayMode === 'raw') {
    if (cell.earned == null) return '—'
    return `${formatPoints(cell.earned)}/${formatPoints(cell.possible)}`
  }
  return formatCompactPercent(cell.percent)
}

function formatAssessmentRawScore(cell: GradebookAssessmentCell | null, possible: number): string {
  if (!cell?.is_graded || cell.earned == null) return `—/${formatPoints(possible)}`
  return `${formatPoints(cell.earned)}/${formatPoints(cell.possible || possible)}`
}

function formatAssessmentTypeLabel(type: GradebookAssessmentColumn['assessment_type']): string {
  if (type === 'assignment') return 'Assignment'
  if (type === 'quiz') return 'Quiz'
  return 'Test'
}

function getAssessmentMeta(column: GradebookAssessmentColumn): string {
  const meta = []
  if (column.due_at) meta.push(`Due ${formatTorontoDateShort(column.due_at)}`)
  if (column.status) meta.push(column.status.charAt(0).toUpperCase() + column.status.slice(1))
  if (column.is_draft) meta.push('Draft')
  if (!column.include_in_final) meta.push('Excluded')
  if (!meta.length) meta.push(formatAssessmentTypeLabel(column.assessment_type))
  return meta.join(' | ')
}

function getColumnStats(
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

function formatColumnStat(
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

function ColumnHeaderCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="inline-flex items-center justify-center" title={`${checked ? 'Hide' : 'Show'} ${label}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-label={label}
        className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  )
}

function SummaryRowLabel({
  label,
  editMode,
  checked,
  onChange,
}: {
  label: string
  editMode: boolean
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  if (!editMode) {
    return <span>{label}</span>
  }

  return (
    <label
      className="inline-flex items-center gap-1.5"
      title={`${checked ? 'Hide' : 'Show'} ${label} row`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={`${label} row`}
        className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
      />
      <span>{label}</span>
    </label>
  )
}

function StudentAssessmentPanel({
  student,
  columns,
  displayMode,
  onClose,
}: {
  student: GradebookStudentSummary
  columns: GradebookAssessmentColumn[]
  displayMode: ScoreDisplayMode
  onClose: () => void
}) {
  return (
    <aside
      role="region"
      aria-label={`${getStudentName(student)} assessment details`}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex min-h-14 items-start justify-between gap-3 border-b border-border px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-default">
            {getStudentName(student)}
          </h2>
          <div className="mt-0.5 text-xs text-text-muted">
            {getStudentDisplayId(student)}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="rounded-md bg-surface-2 px-2 py-1 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-normal text-text-muted">Final</div>
            <div className="text-sm font-semibold tabular-nums text-text-default">
              {formatPercent(student.final_percent)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close student details"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-hover hover:text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {columns.length ? (
          <div className="divide-y divide-border">
            {columns.map((column) => {
              const cell = getAssessmentCell(student, column)
              const percentScore = cell?.is_graded ? formatCompactPercent(cell.percent) : 'Not graded'
              const rawScore = formatAssessmentRawScore(cell, column.possible)
              const primaryScore = displayMode === 'raw' ? rawScore : percentScore
              const secondaryScore = displayMode === 'raw' ? percentScore : rawScore
              const statusDisplay = getGradebookAssessmentStatusDisplay(cell?.status)
              const key = getAssessmentColumnKey(column)
              return (
                <div key={key} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs font-normal tabular-nums text-text-default">
                          {column.code}
                        </span>
                        <span className="truncate text-sm font-normal text-text-default" title={column.title}>
                          {column.title}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                        {statusDisplay ? (
                          <>
                            <AssessmentStatusIndicator
                              display={statusDisplay}
                              iconClassName="shrink-0"
                            />
                            <span aria-hidden="true">|</span>
                          </>
                        ) : null}
                        <span className="truncate">{getAssessmentMeta(column)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={[
                        'text-sm font-normal tabular-nums',
                        cell?.is_graded ? 'text-text-default' : 'text-text-muted',
                      ].join(' ')}>
                        {primaryScore}
                      </div>
                      <div className="mt-1 text-xs tabular-nums text-text-muted">
                        {secondaryScore}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-6 text-sm text-text-muted">
            No assessments yet.
          </div>
        )}
      </div>
    </aside>
  )
}

function ResizableIdentityHeaderCell({
  column,
  index,
  renderedColumns,
  editMode,
  headerTopClass,
  hidden,
  columnWidths,
  sortColumn,
  sortDirection,
  onSort,
  onColumnWidthChange,
}: {
  column: (typeof IDENTITY_COLUMN_DEFS)[number]
  index: number
  renderedColumns: Array<(typeof IDENTITY_COLUMN_DEFS)[number]>
  editMode: boolean
  headerTopClass: string
  hidden: boolean
  columnWidths: Record<GradebookIdentityColumn, number>
  sortColumn: GradebookSortColumn
  sortDirection: 'asc' | 'desc'
  onSort: (column: GradebookSortColumn) => void
  onColumnWidthChange: (column: GradebookIdentityColumn, width: number) => void
}) {
  const columnWidth = columnWidths[column.key]
  const columnBounds = getIdentityColumnDef(column.key)
  const isActive = sortColumn === column.key
  const ariaSort = isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
  const Icon = sortDirection === 'asc' ? ChevronUp : ChevronDown

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = columnWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const target = event.currentTarget
    if (target.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture can fail in test environments; window listeners still handle the drag.
      }
    }

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (!Number.isFinite(moveEvent.clientX) || !Number.isFinite(startX)) return
      const nextWidth = clampIdentityColumnWidth(column.key, startWidth + moveEvent.clientX - startX)
      onColumnWidthChange(column.key, nextWidth)
    }

    const handleResizeEnd = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handleResizeEnd)
      window.removeEventListener('pointercancel', handleResizeEnd)
      window.removeEventListener('blur', handleResizeEnd)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handleResizeEnd)
    window.addEventListener('pointercancel', handleResizeEnd)
    window.addEventListener('blur', handleResizeEnd)
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? IDENTITY_COLUMN_RESIZE_STEP * 3 : IDENTITY_COLUMN_RESIZE_STEP
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') {
      nextWidth = columnWidth - step
    } else if (event.key === 'ArrowRight') {
      nextWidth = columnWidth + step
    } else if (event.key === 'Home') {
      nextWidth = columnBounds.minWidth
    } else if (event.key === 'End') {
      nextWidth = columnBounds.maxWidth
    }

    if (nextWidth == null) return
    event.preventDefault()
    event.stopPropagation()
    onColumnWidthChange(column.key, clampIdentityColumnWidth(column.key, nextWidth))
  }

  return (
    <DataTableHeaderCell
      aria-label={column.label}
      aria-sort={ariaSort}
      style={getIdentityColumnStyle(column, index, editMode, renderedColumns, columnWidths)}
      className={[
        '!p-0 group relative sticky z-30 bg-surface-2',
        headerTopClass,
        getIdentityColumnBorderClass(index, editMode, renderedColumns),
        hidden ? 'text-text-muted' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className="flex w-full items-center gap-1 overflow-hidden px-3 py-1 pr-5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="truncate">{column.label}</span>
        <Icon
          className={[
            'h-4 w-4 flex-shrink-0',
            isActive ? 'text-text-muted' : 'opacity-0',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Resize ${column.label} column`}
        aria-valuemin={columnBounds.minWidth}
        aria-valuemax={columnBounds.maxWidth}
        aria-valuenow={columnWidth}
        className="absolute inset-y-0 right-0 z-10 flex w-2 translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
      >
        <span
          aria-hidden="true"
          className="h-5 w-px rounded-full bg-border-strong opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
    </DataTableHeaderCell>
  )
}

function ResizableFinalHeaderCell({
  headerTopClass,
  hidden,
  finalColumnWidth,
  onFinalColumnWidthChange,
}: {
  headerTopClass: string
  hidden: boolean
  finalColumnWidth: number
  onFinalColumnWidthChange: (width: number) => void
}) {
  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = finalColumnWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const target = event.currentTarget
    if (target.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture can fail in test environments; window listeners still handle the drag.
      }
    }

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (!Number.isFinite(moveEvent.clientX) || !Number.isFinite(startX)) return
      const nextWidth = clampFinalColumnWidth(startWidth - (moveEvent.clientX - startX))
      onFinalColumnWidthChange(nextWidth)
    }

    const handleResizeEnd = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handleResizeEnd)
      window.removeEventListener('pointercancel', handleResizeEnd)
      window.removeEventListener('blur', handleResizeEnd)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handleResizeEnd)
    window.addEventListener('pointercancel', handleResizeEnd)
    window.addEventListener('blur', handleResizeEnd)
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? IDENTITY_COLUMN_RESIZE_STEP * 3 : IDENTITY_COLUMN_RESIZE_STEP
    let nextWidth: number | null = null

    if (event.key === 'ArrowLeft') {
      nextWidth = finalColumnWidth - step
    } else if (event.key === 'ArrowRight') {
      nextWidth = finalColumnWidth + step
    } else if (event.key === 'Home') {
      nextWidth = FINAL_COLUMN_MIN_WIDTH
    } else if (event.key === 'End') {
      nextWidth = FINAL_COLUMN_MAX_WIDTH
    }

    if (nextWidth == null) return
    event.preventDefault()
    event.stopPropagation()
    onFinalColumnWidthChange(clampFinalColumnWidth(nextWidth))
  }

  return (
    <DataTableHeaderCell
      aria-label="Final"
      align="right"
      style={getFinalColumnStyle(finalColumnWidth)}
      className={[
        'group relative sticky z-20 bg-surface-2 text-xs sm:text-sm md:right-0 md:z-30',
        FINAL_COLUMN_SEPARATOR_CLASS,
        headerTopClass,
        hidden ? 'text-text-muted opacity-60' : '',
      ].join(' ')}
    >
      Final
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize Final column"
        aria-valuemin={FINAL_COLUMN_MIN_WIDTH}
        aria-valuemax={FINAL_COLUMN_MAX_WIDTH}
        aria-valuenow={finalColumnWidth}
        className="absolute inset-y-0 left-0 z-10 flex w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
      >
        <span
          aria-hidden="true"
          className="h-5 w-px rounded-full bg-border-strong opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
    </DataTableHeaderCell>
  )
}

function AssessmentMatrixTable({
  students,
  columns,
  displayMode,
  editMode,
  visibleColumns,
  identityColumnWidths,
  finalColumnWidth,
  visibleSummaryRows,
  hiddenAssessmentColumnKeys,
  assessmentWeightDrafts,
  savingAssessmentKey,
  isReadOnly,
  onFixedColumnVisibleChange,
  onIdentityColumnWidthChange,
  onFinalColumnWidthChange,
  onAssessmentColumnVisibleChange,
  onSummaryRowVisibleChange,
  onAssessmentWeightDraftChange,
  onAssessmentWeightCommit,
  selectedIds,
  allSelected,
  toggleSelect,
  toggleSelectAll,
  selectedStudentId,
  onStudentSelect,
  sortColumn,
  sortDirection,
  handleSort,
  scrollContainerRef,
  onScrollContainerScroll,
}: {
  students: GradebookStudentSummary[]
  columns: GradebookAssessmentColumn[]
  displayMode: ScoreDisplayMode
  editMode: boolean
  visibleColumns: Record<GradebookFixedColumn, boolean>
  identityColumnWidths: Record<GradebookIdentityColumn, number>
  finalColumnWidth: number
  visibleSummaryRows: Record<GradebookSummaryRow, boolean>
  hiddenAssessmentColumnKeys: Set<string>
  assessmentWeightDrafts: Record<string, string>
  savingAssessmentKey: string | null
  isReadOnly: boolean
  onFixedColumnVisibleChange: (column: GradebookFixedColumn, visible: boolean) => void
  onIdentityColumnWidthChange: (column: GradebookIdentityColumn, width: number) => void
  onFinalColumnWidthChange: (width: number) => void
  onAssessmentColumnVisibleChange: (column: GradebookAssessmentColumn, visible: boolean) => void
  onSummaryRowVisibleChange: (row: GradebookSummaryRow, visible: boolean) => void
  onAssessmentWeightDraftChange: (column: GradebookAssessmentColumn, value: string) => void
  onAssessmentWeightCommit: (column: GradebookAssessmentColumn) => void
  selectedIds: Set<string>
  allSelected: boolean
  toggleSelect: (id: string) => void
  toggleSelectAll: () => void
  selectedStudentId: string | null
  onStudentSelect: (student: GradebookStudentSummary) => void
  sortColumn: GradebookSortColumn
  sortDirection: 'asc' | 'desc'
  handleSort: (column: GradebookSortColumn) => void
  scrollContainerRef?: Ref<HTMLDivElement>
  onScrollContainerScroll?: () => void
}) {
  const visibleIdentityCount = IDENTITY_COLUMN_DEFS.filter((column) => visibleColumns[column.key]).length
  const renderedIdentityColumns = editMode
    ? IDENTITY_COLUMN_DEFS
    : IDENTITY_COLUMN_DEFS.filter((column) => visibleColumns[column.key])
  const renderedAssessmentColumns = editMode ? columns : columns.filter(
    (column) => !hiddenAssessmentColumnKeys.has(getAssessmentColumnKey(column))
  )
  const renderFinalColumn = editMode || visibleColumns.final
  const headerTopClass = editMode ? 'top-24' : 'top-0'
  const colSpan = renderedAssessmentColumns.length + renderedIdentityColumns.length + (renderFinalColumn ? 2 : 1)
  const leadingColumnWidthClass = getLeadingColumnWidthClass(editMode)
  const editColumnBorderClass = editMode ? 'border-r border-border' : ''
  const assessmentWeightTotal = renderedAssessmentColumns.reduce((sum, column) => {
    const value = Number(assessmentWeightDrafts[getAssessmentColumnKey(column)] || 0)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  const finalPercents = students
    .map((student) => student.final_percent)
    .filter((value): value is number => value != null)
  const finalAverage = average(finalPercents)
  const finalMedian = median(finalPercents)
  const renderAverageRow = editMode || visibleSummaryRows.average
  const renderMedianRow = editMode || visibleSummaryRows.median

  return (
    <div
      ref={scrollContainerRef}
      className="h-full min-h-0 min-w-0 overflow-auto"
      data-testid="gradebook-student-scroll-pane"
      onScroll={onScrollContainerScroll}
    >
      <DataTable density="tight" className="min-w-max">
          <DataTableHead>
            {editMode ? (
              <DataTableRow className="border-b border-border">
                <DataTableHeaderCell
                  className={[
                    'sticky left-0 top-0 z-30 h-8 whitespace-nowrap border-r border-border bg-surface-2 !px-2 text-[11px] font-semibold uppercase tracking-normal text-text-muted',
                    leadingColumnWidthClass,
                  ].join(' ')}
                >
                  Visible
                </DataTableHeaderCell>
                {renderedIdentityColumns.map((column, index) => (
                  <DataTableHeaderCell
                    key={`toggle:${column.key}`}
                    align="center"
                    style={getIdentityColumnStyle(column, index, editMode, renderedIdentityColumns, identityColumnWidths)}
                    className={[
                      'sticky top-0 z-30 h-8 bg-surface-2',
                      getIdentityColumnBorderClass(index, editMode, renderedIdentityColumns),
                    ].join(' ')}
                  >
                    <ColumnHeaderCheckbox
                      label={column.label}
                      checked={visibleColumns[column.key]}
                      disabled={visibleColumns[column.key] && visibleIdentityCount === 1}
                      onChange={(checked) => onFixedColumnVisibleChange(column.key, checked)}
                    />
                  </DataTableHeaderCell>
                ))}
                {renderedAssessmentColumns.map((column) => {
                  const key = getAssessmentColumnKey(column)
                  return (
                    <DataTableHeaderCell
                      key={`toggle:${key}`}
                      align="center"
                      className="sticky top-0 z-20 h-8 min-w-16 border-r border-border bg-surface-2 px-2"
                    >
                      <ColumnHeaderCheckbox
                        label={column.code}
                        checked={!hiddenAssessmentColumnKeys.has(key)}
                        onChange={(checked) => onAssessmentColumnVisibleChange(column, checked)}
                      />
                    </DataTableHeaderCell>
                  )
                })}
                {renderFinalColumn ? (
                  <DataTableHeaderCell
                    align="right"
                    style={getFinalColumnStyle(finalColumnWidth)}
                    className={[
                      'sticky top-0 z-20 h-8 bg-surface-2 text-xs sm:text-sm md:right-0 md:z-30',
                      FINAL_COLUMN_SEPARATOR_CLASS,
                    ].join(' ')}
                  >
                    <ColumnHeaderCheckbox
                      label="Final"
                      checked={visibleColumns.final}
                      onChange={(checked) => onFixedColumnVisibleChange('final', checked)}
                    />
                  </DataTableHeaderCell>
                ) : null}
              </DataTableRow>
            ) : null}
            {editMode ? (
              <DataTableRow className="border-b border-border">
                <DataTableHeaderCell
                  className={[
                    'sticky left-0 top-8 z-30 h-14 whitespace-nowrap border-r border-border bg-surface-2 !px-2 text-[11px] font-semibold uppercase tracking-normal text-text-muted',
                    leadingColumnWidthClass,
                  ].join(' ')}
                >
                  Weight
                </DataTableHeaderCell>
                {renderedIdentityColumns.map((column, index) => (
                  <DataTableHeaderCell
                    key={`weight-label:${column.key}`}
                    style={getIdentityColumnStyle(column, index, editMode, renderedIdentityColumns, identityColumnWidths)}
                    className={[
                      'sticky top-8 z-30 h-14 bg-surface-2',
                      getIdentityColumnBorderClass(index, editMode, renderedIdentityColumns),
                      !visibleColumns[column.key] ? 'text-text-muted' : '',
                    ].join(' ')}
                  >
                    {null}
                  </DataTableHeaderCell>
                ))}
                {renderedAssessmentColumns.map((column) => {
                  const key = getAssessmentColumnKey(column)
                  const hidden = hiddenAssessmentColumnKeys.has(key)
                  const weightDraft = assessmentWeightDrafts[key] ?? String(column.weight)
                  const weightValue = Number(weightDraft)
                  const weightShare = formatWeightShare(weightValue, assessmentWeightTotal)
                  const savingWeight = savingAssessmentKey === key
                  return (
                    <DataTableHeaderCell
                      key={`weight:${key}`}
                      align="center"
                      className={[
                        'sticky top-8 z-20 h-14 min-w-16 border-r border-border bg-surface-2 px-2',
                        hidden ? 'opacity-60' : '',
                      ].join(' ')}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <Input
                          type="number"
                          min={ASSESSMENT_WEIGHT_MIN}
                          max={ASSESSMENT_WEIGHT_MAX}
                          inputMode="numeric"
                          value={weightDraft}
                          disabled={isReadOnly || savingWeight}
                          aria-label={`${column.code} assessment weight`}
                          title={`${column.code} assessment weight`}
                          onChange={(event) => onAssessmentWeightDraftChange(column, event.target.value)}
                          onBlur={() => onAssessmentWeightCommit(column)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                          className="h-7 w-12 [appearance:textfield] px-1 text-center text-xs tabular-nums [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span
                          className="text-[10px] font-medium leading-none tabular-nums text-text-muted"
                          aria-label={`${column.code} weight share ${weightShare}`}
                        >
                          {weightShare}
                        </span>
                      </div>
                    </DataTableHeaderCell>
                  )
                })}
                {renderFinalColumn ? (
                  <DataTableHeaderCell
                    align="right"
                    style={getFinalColumnStyle(finalColumnWidth)}
                    className={[
                      'sticky top-8 z-20 h-14 bg-surface-2 text-xs font-semibold tabular-nums text-text-muted md:right-0 md:z-30',
                      FINAL_COLUMN_SEPARATOR_CLASS,
                    ].join(' ')}
                  >
                    <div className="flex flex-col items-end gap-0.5">
                      <span>Total {assessmentWeightTotal}</span>
                      <span className="text-[10px] font-medium leading-none">
                        {assessmentWeightTotal > 0 ? '100%' : '—'}
                      </span>
                    </div>
                  </DataTableHeaderCell>
                ) : null}
              </DataTableRow>
            ) : null}
            {editMode ? (
              <DataTableRow aria-hidden="true" className="h-2 bg-page">
                <td colSpan={colSpan} className="p-0" />
              </DataTableRow>
            ) : null}
            <DataTableRow>
              <DataTableHeaderCell className={['sticky left-0 z-30 border-r border-border bg-surface-2', headerTopClass, leadingColumnWidthClass].join(' ')}>
                {editMode ? null : (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    aria-label="Select all students"
                  />
                )}
              </DataTableHeaderCell>
              {renderedIdentityColumns.map((column, index) => (
                <ResizableIdentityHeaderCell
                  key={column.key}
                  column={column}
                  index={index}
                  renderedColumns={renderedIdentityColumns}
                  editMode={editMode}
                  headerTopClass={headerTopClass}
                  hidden={!visibleColumns[column.key]}
                  columnWidths={identityColumnWidths}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onColumnWidthChange={onIdentityColumnWidthChange}
                />
              ))}
              {renderedAssessmentColumns.map((column) => {
                const key = getAssessmentColumnKey(column)
                const hidden = hiddenAssessmentColumnKeys.has(key)
                return (
                <DataTableHeaderCell
                  key={key}
                  align="center"
                    className={[
                      'sticky z-20 min-w-16 bg-surface-2 px-2 text-xs',
                      headerTopClass,
                      editColumnBorderClass,
                      hidden ? 'opacity-60' : '',
                    ].join(' ')}
                >
                  <div className="flex flex-col items-center">
                    <Tooltip content={column.title} side="bottom">
                      <span
                        tabIndex={0}
                        className={[
                          'inline-flex min-h-10 min-w-12 flex-col items-center justify-center rounded-sm px-1.5 py-0.5 font-normal tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          column.is_draft || !column.include_in_final
                            ? 'text-text-muted'
                            : 'text-text-default',
                          hidden ? 'text-text-muted' : '',
                        ].join(' ')}
                        aria-label={[
                          `${column.code}: ${column.title}`,
                          column.due_at ? `Due ${formatTorontoDateShort(column.due_at)}` : null,
                        ].filter(Boolean).join(', ')}
                      >
                        <span>{column.code}</span>
                        <span className="mt-0.5 min-h-3 text-[10px] font-normal leading-none text-text-muted">
                          {!hidden && column.due_at ? formatTorontoDateShort(column.due_at) : ''}
                        </span>
                      </span>
                    </Tooltip>
                  </div>
                </DataTableHeaderCell>
                )
              })}
              {renderFinalColumn ? (
                <ResizableFinalHeaderCell
                  headerTopClass={headerTopClass}
                  hidden={!visibleColumns.final}
                  finalColumnWidth={finalColumnWidth}
                  onFinalColumnWidthChange={onFinalColumnWidthChange}
                />
              ) : null}
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {students.map((student) => {
              const isSelected = selectedStudentId === student.student_id
              const isSelectable = !editMode
              return (
                <DataTableRow
                  key={student.student_id}
                  tabIndex={isSelectable ? 0 : undefined}
                  aria-selected={isSelectable ? isSelected : undefined}
                  className={[
                    'group transition-colors',
                    isSelectable ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary' : '',
                    isSelected ? 'bg-surface-selected hover:bg-surface-selected' : 'hover:bg-surface-hover',
                  ].join(' ')}
                  onClick={(event) => {
                    if (!isSelectable) return
                    if ((event.target as HTMLElement).closest('button,input,a,label,select,textarea')) return
                    onStudentSelect(student)
                  }}
                  onKeyDown={(event) => {
                    if (!isSelectable) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    if ((event.target as HTMLElement).closest('button,input,a,label,select,textarea')) return
                    event.preventDefault()
                    onStudentSelect(student)
                  }}
                >
                  <DataTableCell
                    className={[
                      'sticky left-0 z-10 border-r border-border',
                      isSelected ? 'bg-surface-selected group-hover:bg-surface-selected' : 'bg-surface group-hover:bg-surface-hover',
                      leadingColumnWidthClass,
                    ].join(' ')}
                  >
                    {editMode ? null : (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(student.student_id)}
                        onChange={() => toggleSelect(student.student_id)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        aria-label={`Select ${getStudentName(student)}`}
                      />
                    )}
                  </DataTableCell>
                  {renderedIdentityColumns.map((column, index) => {
                    const hidden = !visibleColumns[column.key]
                    const value = getStudentIdentityValue(student, column.key)
                    return (
                      <DataTableCell
                        key={column.key}
                        style={getIdentityColumnStyle(column, index, editMode, renderedIdentityColumns, identityColumnWidths)}
                        className={[
                          'sticky z-10',
                          getIdentityColumnBorderClass(index, editMode, renderedIdentityColumns),
                          isSelected ? 'bg-surface-selected group-hover:bg-surface-selected' : 'bg-surface group-hover:bg-surface-hover',
                          column.key === 'id' ? 'text-text-muted' : '',
                          hidden ? 'bg-surface-2 text-text-muted group-hover:bg-surface-hover' : '',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'block truncate text-sm',
                            column.key === 'id' || hidden ? '' : 'font-semibold text-text-default',
                          ].join(' ')}
                          title={value === '—' ? undefined : value}
                        >
                          {value}
                        </span>
                      </DataTableCell>
                    )
                  })}
                  {renderedAssessmentColumns.map((column) => {
                    const hidden = hiddenAssessmentColumnKeys.has(getAssessmentColumnKey(column))
                    const cell = getAssessmentCell(student, column)
                    return (
                      <DataTableCell
                        key={`${student.student_id}:${column.assessment_type}:${column.assessment_id}`}
                        align="center"
                        className={['min-w-16 px-2 text-xs tabular-nums', editColumnBorderClass].join(' ')}
                      >
                        <span
                          className={[
                            'font-normal',
                            hidden || !cell?.is_graded ? 'text-text-muted' : 'text-text-default',
                          ].join(' ')}
                        >
                          {formatAssessmentScore(cell, displayMode)}
                        </span>
                      </DataTableCell>
                    )
                  })}
                  {renderFinalColumn ? (
                    <DataTableCell
                      align="right"
                      style={getFinalColumnStyle(finalColumnWidth)}
                      className={[
                        'whitespace-nowrap text-xs font-semibold tabular-nums sm:text-sm md:sticky md:right-0 md:z-10',
                        FINAL_COLUMN_SEPARATOR_CLASS,
                        isSelected ? 'bg-surface-selected group-hover:bg-surface-selected' : 'bg-surface group-hover:bg-surface-hover',
                        !visibleColumns.final ? 'bg-surface-2 text-text-muted' : '',
                      ].join(' ')}
                    >
                      {formatPercent(student.final_percent)}
                    </DataTableCell>
                  ) : null}
                </DataTableRow>
              )
            })}

            {students.length === 0 && (
              <EmptyStateRow colSpan={colSpan} message="No students enrolled yet" />
            )}
            {students.length > 0 && (renderAverageRow || renderMedianRow) && (
              <>
                <DataTableRow aria-hidden="true" className="h-2 bg-page">
                  <td colSpan={colSpan} className="p-0" />
                </DataTableRow>
                {renderAverageRow ? (
                  <DataTableRow className={[
                    renderMedianRow ? 'border-t border-border bg-surface-2' : 'border-y border-border bg-surface-2',
                    editMode && !visibleSummaryRows.average ? 'opacity-60' : '',
                  ].join(' ')}>
                    <DataTableCell
                      className={[
                        'sticky left-0 z-10 border-r border-border bg-surface-2 text-xs font-semibold uppercase tracking-wide text-text-muted',
                        editMode ? '!px-2' : '!px-1 text-center',
                        leadingColumnWidthClass,
                      ].join(' ')}
                    >
                      <SummaryRowLabel
                        label="Avg"
                        editMode={editMode}
                        checked={visibleSummaryRows.average}
                        onChange={(checked) => onSummaryRowVisibleChange('average', checked)}
                      />
                    </DataTableCell>
                    {renderedIdentityColumns.map((column, index) => (
                      <DataTableCell
                        key={`average:${column.key}`}
                        style={getIdentityColumnStyle(column, index, editMode, renderedIdentityColumns, identityColumnWidths)}
                        className={[
                        'sticky z-10 bg-surface-2',
                        getIdentityColumnBorderClass(index, editMode, renderedIdentityColumns),
                        editMode && index === 0 ? 'text-xs font-semibold uppercase tracking-wide text-text-muted' : '',
                      ].join(' ')}
                      >
                        {null}
                      </DataTableCell>
                    ))}
                    {renderedAssessmentColumns.map((column) => {
                      const hidden = hiddenAssessmentColumnKeys.has(getAssessmentColumnKey(column))
                      const stats = getColumnStats(students, column)
                      return (
                        <DataTableCell
                          key={`average:${column.assessment_type}:${column.assessment_id}`}
                          align="center"
                          className={[
                            'min-w-16 px-2 text-xs font-normal tabular-nums',
                            editColumnBorderClass,
                            hidden ? 'text-text-muted' : 'text-text-default',
                          ].join(' ')}
                        >
                          {formatColumnStat(stats, column, 'average', displayMode)}
                        </DataTableCell>
                      )
                    })}
                    {renderFinalColumn ? (
                      <DataTableCell
                        align="right"
                        style={getFinalColumnStyle(finalColumnWidth)}
                        className={[
                          'whitespace-nowrap bg-surface-2 text-xs font-semibold tabular-nums md:sticky md:right-0 md:z-10',
                          FINAL_COLUMN_SEPARATOR_CLASS,
                          visibleColumns.final ? 'text-text-default' : 'text-text-muted',
                        ].join(' ')}
                      >
                        {formatCompactPercent(finalAverage)}
                      </DataTableCell>
                    ) : null}
                  </DataTableRow>
                ) : null}
                {renderMedianRow ? (
                  <DataTableRow className={[
                    renderAverageRow ? 'border-b border-border bg-surface-2' : 'border-y border-border bg-surface-2',
                    editMode && !visibleSummaryRows.median ? 'opacity-60' : '',
                  ].join(' ')}>
                    <DataTableCell
                      className={[
                        'sticky left-0 z-10 border-r border-border bg-surface-2 text-xs font-semibold uppercase tracking-wide text-text-muted',
                        editMode ? '!px-2' : '!px-1 text-center',
                        leadingColumnWidthClass,
                      ].join(' ')}
                    >
                      <SummaryRowLabel
                        label="Med"
                        editMode={editMode}
                        checked={visibleSummaryRows.median}
                        onChange={(checked) => onSummaryRowVisibleChange('median', checked)}
                      />
                    </DataTableCell>
                    {renderedIdentityColumns.map((column, index) => (
                      <DataTableCell
                        key={`median:${column.key}`}
                        style={getIdentityColumnStyle(column, index, editMode, renderedIdentityColumns, identityColumnWidths)}
                        className={[
                        'sticky z-10 bg-surface-2',
                        getIdentityColumnBorderClass(index, editMode, renderedIdentityColumns),
                        editMode && index === 0 ? 'text-xs font-semibold uppercase tracking-wide text-text-muted' : '',
                      ].join(' ')}
                      >
                        {null}
                      </DataTableCell>
                    ))}
                    {renderedAssessmentColumns.map((column) => {
                      const hidden = hiddenAssessmentColumnKeys.has(getAssessmentColumnKey(column))
                      const stats = getColumnStats(students, column)
                      return (
                        <DataTableCell
                          key={`median:${column.assessment_type}:${column.assessment_id}`}
                          align="center"
                          className={[
                            'min-w-16 px-2 text-xs font-normal tabular-nums',
                            editColumnBorderClass,
                            hidden ? 'text-text-muted' : 'text-text-default',
                          ].join(' ')}
                        >
                          {formatColumnStat(stats, column, 'median', displayMode)}
                        </DataTableCell>
                      )
                    })}
                    {renderFinalColumn ? (
                      <DataTableCell
                        align="right"
                        style={getFinalColumnStyle(finalColumnWidth)}
                        className={[
                          'whitespace-nowrap bg-surface-2 text-xs font-semibold tabular-nums md:sticky md:right-0 md:z-10',
                          FINAL_COLUMN_SEPARATOR_CLASS,
                          visibleColumns.final ? 'text-text-default' : 'text-text-muted',
                        ].join(' ')}
                      >
                        {formatCompactPercent(finalMedian)}
                      </DataTableCell>
                    ) : null}
                  </DataTableRow>
                ) : null}
              </>
            )}
          </DataTableBody>
      </DataTable>
    </div>
  )
}

export function TeacherGradebookTab({
  classroom,
  sectionParam,
  onSectionChange = () => {},
}: Props) {
  const section: GradebookSection = sectionParam === 'settings' ? 'settings' : 'grades'
  const isReadOnly = !!classroom.archived_at
  const { showMessage } = useAppMessage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scoreDisplayMode, setScoreDisplayMode] = useState<ScoreDisplayMode>('percent')
  const [columnEditorOpen, setColumnEditorOpen] = useState(section === 'settings')
  const [visibleColumns, setVisibleColumns] =
    useState<Record<GradebookFixedColumn, boolean>>(DEFAULT_VISIBLE_COLUMNS)
  const [identityColumnWidths, setIdentityColumnWidths] =
    useState<Record<GradebookIdentityColumn, number>>(DEFAULT_IDENTITY_COLUMN_WIDTHS)
  const [finalColumnWidth, setFinalColumnWidth] = useState(FINAL_COLUMN_DEFAULT_WIDTH)
  const [visibleSummaryRows, setVisibleSummaryRows] =
    useState<Record<GradebookSummaryRow, boolean>>(DEFAULT_VISIBLE_SUMMARY_ROWS)
  const [hiddenAssessmentColumnKeys, setHiddenAssessmentColumnKeys] = useState<Set<string>>(() => new Set())
  const [assessmentWeightDrafts, setAssessmentWeightDrafts] = useState<Record<string, string>>({})
  const [savingAssessmentKey, setSavingAssessmentKey] = useState<string | null>(null)
  const [assessmentColumns, setAssessmentColumns] = useState<GradebookAssessmentColumn[]>([])
  const [students, setStudents] = useState<GradebookStudentSummary[]>([])
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [detailPaneWidth, setDetailPaneWidth] = useState(32)
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: GradebookSortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })

  const sortedStudents = useMemo(() => {
    const rows = [...students]
    rows.sort((a, b) => {
      if (sortColumn === 'id') {
        const cmp = getStudentDisplayId(a).localeCompare(getStudentDisplayId(b))
        if (cmp !== 0) return applyDirection(cmp, sortDirection)
        return compareByNameFields(
          { firstName: a.student_first_name, lastName: a.student_last_name, id: a.student_email },
          { firstName: b.student_first_name, lastName: b.student_last_name, id: b.student_email },
          'last_name',
          'asc',
        )
      }

      return compareByNameFields(
        { firstName: a.student_first_name, lastName: a.student_last_name, id: a.student_email },
        { firstName: b.student_first_name, lastName: b.student_last_name, id: b.student_email },
        sortColumn,
        sortDirection,
      )
    })
    return rows
  }, [students, sortColumn, sortDirection])

  const selectedStudent = useMemo(
    () => students.find((student) => student.student_id === selectedStudentId) || null,
    [selectedStudentId, students],
  )
  const rowKeys = useMemo(() => sortedStudents.map((student) => student.student_id), [sortedStudents])
  const { selectedIds, toggleSelect, toggleSelectAll, allSelected, clearSelection } = useStudentSelection(rowKeys)
  const selectedStudents = useMemo(
    () => sortedStudents.filter((student) => selectedIds.has(student.student_id)),
    [selectedIds, sortedStudents],
  )
  const selectedStudentEmails = useMemo(
    () => getValidEmailList(selectedStudents.map((student) => student.student_email)),
    [selectedStudents],
  )
  const someStudentsSelected = selectedIds.size > 0
  const {
    scrollRef: gradebookTableScrollRef,
    preserveScrollPosition: preserveGradebookTableScrollPosition,
  } = useScrollPositionMemory<HTMLDivElement>({
    key: `${classroom.id}:gradebook`,
    enabled: !columnEditorOpen,
    restoreToken: [
      selectedStudentId ?? 'none',
      sortedStudents.length,
      loading ? 'loading' : 'ready',
      columnEditorOpen ? 'settings' : 'grades',
    ].join(':'),
  })

  function handleSort(column: GradebookSortColumn) {
    setSortState((previous) => toggleSort(previous, column))
  }

  const loadGradebook = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false
    if (showLoading) setLoading(true)
    setError('')
    try {
      const data = await fetchJSONWithCache<GradebookPayload>(
        `gradebook:${classroom.id}:class`,
        async () => {
          const response = await fetch(`/api/teacher/gradebook?classroom_id=${classroom.id}`)
          const json = await response.json()
          if (!response.ok) throw new Error(json.error || 'Failed to load gradebook')
          return json
        },
        60_000,
      )

      const columnsWithWeights = (data.assessment_columns || []).map((column) => ({
        ...column,
        weight: Number(column.weight || ASSESSMENT_WEIGHT_DEFAULT),
      }))
      setAssessmentColumns(columnsWithWeights)
      setAssessmentWeightDrafts(() => {
        const next: Record<string, string> = {}
        for (const column of columnsWithWeights) {
          const key = getAssessmentColumnKey(column)
          next[key] = String(column.weight)
        }
        return next
      })
      setStudents(data.students || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load gradebook')
      setAssessmentColumns([])
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    void loadGradebook()
  }, [loadGradebook])

  useEffect(() => {
    setColumnEditorOpen(section === 'settings')
    if (section === 'settings') {
      setSelectedStudentId(null)
      clearSelection()
    }
  }, [clearSelection, section])

  useEffect(() => {
    if (!selectedStudentId) return
    if (students.some((student) => student.student_id === selectedStudentId)) return
    setSelectedStudentId(null)
  }, [selectedStudentId, students])

  function handleSettingsActiveChange(active: boolean) {
    if (active) {
      setSelectedStudentId(null)
      clearSelection()
    }
    setColumnEditorOpen(active)
    onSectionChange(active ? 'settings' : 'grades')
  }

  function handleScoreDisplayModeChange(nextMode: ScoreDisplayMode) {
    setScoreDisplayMode(nextMode)
    if (columnEditorOpen) {
      setColumnEditorOpen(false)
    }
    onSectionChange('grades')
  }

  async function copySelectedEmailsToClipboard() {
    if (selectedStudentEmails.length === 0) {
      showMessage({ text: 'No selected student emails', tone: 'warning' })
      return
    }

    const text = selectedStudentEmails.join(', ')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    showMessage({ text: 'Student emails copied', tone: 'success' })
  }

  function openDefaultEmail(emails: string[]) {
    if (emails.length === 0) {
      showMessage({ text: 'No selected student emails', tone: 'warning' })
      return
    }
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}`
  }

  function openGmail(emails: string[]) {
    if (emails.length === 0) {
      showMessage({ text: 'No selected student emails', tone: 'warning' })
      return
    }
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(emails.join(','))}`, '_blank')
  }

  function openOutlook(emails: string[]) {
    if (emails.length === 0) {
      showMessage({ text: 'No selected student emails', tone: 'warning' })
      return
    }
    window.open(`https://outlook.office.com/mail/deeplink/compose?bcc=${encodeURIComponent(emails.join(','))}`, '_blank')
  }

  function handleStudentSelect(student: GradebookStudentSummary) {
    preserveGradebookTableScrollPosition()
    setSelectedStudentId((previous) => (
      previous === student.student_id ? null : student.student_id
    ))
  }

  function handleFixedColumnVisibleChange(column: GradebookFixedColumn, visible: boolean) {
    const next = { ...visibleColumns, [column]: visible }
    const visibleIdentityColumns = IDENTITY_COLUMN_DEFS.filter((identityColumn) => next[identityColumn.key])
    if (visibleIdentityColumns.length === 0) return

    setVisibleColumns(next)
    if (column === sortColumn && !visible) {
      setSortState({ column: visibleIdentityColumns[0].key, direction: 'asc' })
    }
  }

  function handleIdentityColumnWidthChange(column: GradebookIdentityColumn, width: number) {
    setIdentityColumnWidths((previous) => ({
      ...previous,
      [column]: clampIdentityColumnWidth(column, width),
    }))
  }

  function handleFinalColumnWidthChange(width: number) {
    setFinalColumnWidth(clampFinalColumnWidth(width))
  }

  function handleAssessmentColumnVisibleChange(column: GradebookAssessmentColumn, visible: boolean) {
    const key = getAssessmentColumnKey(column)
    setHiddenAssessmentColumnKeys((previous) => {
      const next = new Set(previous)
      if (visible) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function handleSummaryRowVisibleChange(row: GradebookSummaryRow, visible: boolean) {
    setVisibleSummaryRows((previous) => ({ ...previous, [row]: visible }))
  }

  function handleAssessmentWeightDraftChange(column: GradebookAssessmentColumn, value: string) {
    const key = getAssessmentColumnKey(column)
    if (!/^\d*$/.test(value)) return
    setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: value }))
  }

  async function handleAssessmentWeightCommit(column: GradebookAssessmentColumn) {
    if (isReadOnly) return

    const key = getAssessmentColumnKey(column)
    const rawValue = assessmentWeightDrafts[key] ?? String(column.weight)
    const nextWeight = Number(rawValue)

    if (
      !Number.isInteger(nextWeight) ||
      nextWeight < ASSESSMENT_WEIGHT_MIN ||
      nextWeight > ASSESSMENT_WEIGHT_MAX
    ) {
      setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: String(column.weight) }))
      setError(`Assessment weight must be an integer ${ASSESSMENT_WEIGHT_MIN}-${ASSESSMENT_WEIGHT_MAX}`)
      return
    }

    if (nextWeight === column.weight) return

    setSavingAssessmentKey(key)
    setError('')
    try {
      const response = await fetch('/api/teacher/gradebook', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          assessment_type: column.assessment_type,
          assessment_id: column.assessment_id,
          gradebook_weight: nextWeight,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save assessment weight')
      }

      setAssessmentColumns((previous) => previous.map((assessmentColumn) => (
        getAssessmentColumnKey(assessmentColumn) === key
          ? { ...assessmentColumn, weight: nextWeight }
          : assessmentColumn
      )))
      setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: String(nextWeight) }))
      invalidateCachedJSONMatching(`gradebook:${classroom.id}:`)
      await loadGradebook({ showLoading: false })
    } catch (err: unknown) {
      setAssessmentWeightDrafts((previous) => ({ ...previous, [key]: String(column.weight) }))
      setError(err instanceof Error ? err.message : 'Failed to save assessment weight')
    } finally {
      setSavingAssessmentKey(null)
    }
  }

  const isSettingsActive = columnEditorOpen
  const showSelectedStudentEmailActions = someStudentsSelected && !isSettingsActive
  const scoreDisplayOptions = [
    {
      value: 'percent',
      label: 'Show %',
    },
    {
      value: 'raw',
      label: 'Show Raw',
    },
  ] satisfies Array<SegmentedControlOption<ScoreDisplayMode>>
  const gradebookEmailOptions: SplitButtonOption[] = [
    {
      id: 'copy-selected-emails',
      label: `Copy emails (${selectedStudentEmails.length})`,
      icon: <Copy className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => {
        void copySelectedEmailsToClipboard()
      },
      disabled: selectedStudentEmails.length === 0,
    },
    {
      id: 'gmail-selected-students',
      label: 'Gmail',
      icon: <Mail className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => openGmail(selectedStudentEmails),
      disabled: selectedStudentEmails.length === 0,
    },
    {
      id: 'outlook-selected-students',
      label: 'Outlook',
      icon: <Mail className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => openOutlook(selectedStudentEmails),
      disabled: selectedStudentEmails.length === 0,
    },
  ]

  const actionBar = (
    <TeacherWorkSurfaceActionBar
      center={
        <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1.5">
          {showSelectedStudentEmailActions ? (
            <SplitButton
              label={
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  <span>Email ({selectedStudentEmails.length})</span>
                </span>
              }
              onPrimaryClick={() => openDefaultEmail(selectedStudentEmails)}
              options={gradebookEmailOptions}
              disabled={selectedStudentEmails.length === 0}
              size="sm"
              toggleAriaLabel="Gradebook email actions"
              menuPlacement="down"
            />
          ) : null}
          <SegmentedControl
            ariaLabel="Gradebook score display"
            value={scoreDisplayMode}
            options={scoreDisplayOptions}
            onChange={handleScoreDisplayModeChange}
            className="h-9"
          />
          <Tooltip content={isSettingsActive ? 'Hide gradebook settings' : 'Show gradebook settings'}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Gradebook settings"
              aria-pressed={isSettingsActive}
              title="Gradebook settings"
              className={[
                'h-9 w-9 px-0',
                isSettingsActive
                  ? 'border-primary/40 bg-info-bg text-primary shadow-inner hover:bg-info-bg-hover hover:text-primary'
                  : '',
              ].join(' ')}
              onClick={() => handleSettingsActiveChange(!isSettingsActive)}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      }
      centerPlacement="floating"
    />
  )

  const gradebookTable = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <AssessmentMatrixTable
        students={sortedStudents}
        columns={assessmentColumns}
        displayMode={scoreDisplayMode}
        editMode={columnEditorOpen}
        visibleColumns={visibleColumns}
        identityColumnWidths={identityColumnWidths}
        finalColumnWidth={finalColumnWidth}
        visibleSummaryRows={visibleSummaryRows}
        hiddenAssessmentColumnKeys={hiddenAssessmentColumnKeys}
        assessmentWeightDrafts={assessmentWeightDrafts}
        savingAssessmentKey={savingAssessmentKey}
        isReadOnly={isReadOnly}
        onFixedColumnVisibleChange={handleFixedColumnVisibleChange}
        onIdentityColumnWidthChange={handleIdentityColumnWidthChange}
        onFinalColumnWidthChange={handleFinalColumnWidthChange}
        onAssessmentColumnVisibleChange={handleAssessmentColumnVisibleChange}
        onSummaryRowVisibleChange={handleSummaryRowVisibleChange}
        onAssessmentWeightDraftChange={handleAssessmentWeightDraftChange}
        onAssessmentWeightCommit={handleAssessmentWeightCommit}
        selectedIds={selectedIds}
        allSelected={allSelected}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        selectedStudentId={columnEditorOpen ? null : selectedStudentId}
        onStudentSelect={handleStudentSelect}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        handleSort={handleSort}
        scrollContainerRef={gradebookTableScrollRef}
        onScrollContainerScroll={preserveGradebookTableScrollPosition}
      />
    </div>
  )

  const studentAssessmentPanel = selectedStudent && !columnEditorOpen ? (
    <StudentAssessmentPanel
      student={selectedStudent}
      columns={assessmentColumns}
      displayMode={scoreDisplayMode}
      onClose={() => setSelectedStudentId(null)}
    />
  ) : undefined

  const gradesWorkspace = loading ? (
    <div className="flex flex-1 justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <TeacherWorkspaceSplit
      className="h-full flex-1"
      splitVariant="gapped"
      primary={gradebookTable}
      inspector={studentAssessmentPanel}
      inspectorWidth={detailPaneWidth}
      onInspectorWidthChange={setDetailPaneWidth}
      inspectorCollapsed={false}
      inspectorClassName="min-h-[280px] rounded-lg border border-border bg-surface"
      dividerLabel="Resize gradebook details"
      defaultInspectorWidth={32}
      minInspectorPx={300}
      minPrimaryPx={420}
      minInspectorPercent={24}
      maxInspectorPercent={45}
    />
  )

  return (
    <TeacherWorkSurfaceShell
      state="workspace"
      workspaceFrame="standalone"
      primary={actionBar}
      feedback={
        error ? (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null
      }
      summary={null}
      workspace={gradesWorkspace}
      workspaceFrameClassName="min-h-[360px] border-0 bg-page"
    />
  )
}
