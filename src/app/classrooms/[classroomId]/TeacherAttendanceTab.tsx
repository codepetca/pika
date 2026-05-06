'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Spinner } from '@/components/Spinner'
import { CalendarDateNavigator } from '@/components/CalendarActionBar'
import { StudentLogHistory } from '@/components/StudentLogHistory'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import { LogSummary } from './LogSummary'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { entryHasContent, getAttendanceDotClass, getAttendanceLabel } from '@/lib/attendance'
import { useClassDaysContext } from '@/hooks/useClassDays'
import { RefreshingIndicator, Tooltip } from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import type { AttendanceStatus } from '@/types'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import { CountBadge, StudentCountBadge } from '@/components/StudentCountBadge'
import { applyDirection, compareByNameFields, toggleSort } from '@/lib/table-sort'
import type { Classroom, Entry } from '@/types'
import { format, parseISO } from 'date-fns'

type SortColumn = 'first_name' | 'last_name' | 'id' | 'status'

interface LogRow {
  student_id: string
  student_email: string
  student_first_name: string
  student_last_name: string
  email_username: string
  entry: Entry | null
}

interface Props {
  classroom: Classroom
  onSelectEntry?: (entry: Entry | null, studentName: string, studentId: string | null) => void
  onDateChange?: (date: string) => void
  isActive?: boolean
}

export interface TeacherAttendanceTabHandle {
  selectStudentByName: (name: string) => void
}

export const TeacherAttendanceTab = forwardRef<TeacherAttendanceTabHandle, Props>(function TeacherAttendanceTab({
  classroom,
  onSelectEntry,
  onDateChange,
  isActive = true,
}: Props, ref) {
  const { classDays, isLoading: classDaysLoading } = useClassDaysContext()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const [detailPaneWidth, setDetailPaneWidth] = useState(50)
  const showBlockingSpinner = useDelayedBusy(loading && logs.length === 0)
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })

  // Set initial date once class days are loaded from context
  useEffect(() => {
    if (classDaysLoading) return
    if (selectedDate) return // Already initialized
    const today = getTodayInToronto()
    const previousClassDay = getMostRecentClassDayBefore(classDays, today)
    setSelectedDate(previousClassDay || addDaysToDateString(today, -1))
    // Do NOT setLoading(false) here — the logs fetch (Effect 3) handles it
  }, [classDaysLoading, classDays, selectedDate])

  // Notify parent of date changes
  useEffect(() => {
    if (selectedDate) {
      onDateChange?.(selectedDate)
    }
  }, [selectedDate, onDateChange])

  // Fetch logs when date changes
  useEffect(() => {
    async function loadLogs() {
      if (!selectedDate) return
      if (!isActive) return
      if (!isClassDayOnDate(classDays, selectedDate)) {
        setLogs([])
        setHasLoadedOnce(true)
        setSelectedStudentId(null)
        onSelectEntry?.(null, '', null)
        setLoading(false)
        setRefreshing(false)
        return
      }

      if (hasLoadedOnce) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      try {
        const res = await fetch(`/api/teacher/logs?classroom_id=${classroom.id}&date=${selectedDate}`)
        const data = await res.json()
        const rawLogs = data.logs || []
        const mappedLogs = rawLogs.map((log: any) => ({
          ...log,
          email_username: log.student_email.split('@')[0],
        }))
        setLogs(mappedLogs)

        // Clear selection when date changes so summary is visible
        setSelectedStudentId(null)
        onSelectEntry?.(null, '', null)
        setHasLoadedOnce(true)
      } catch (err) {
        console.error('Error loading logs:', err)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }
    loadLogs()
  }, [classroom.id, classDays, selectedDate, onSelectEntry, hasLoadedOnce, isActive])

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

  const today = useMemo(() => getTodayInToronto(), [])

  const rows = useMemo(() => {
    return [...logs].sort((a, b) => {
      if (sortColumn === 'status') {
        const rankOf = (row: LogRow) => {
          if (row.entry && entryHasContent(row.entry)) return 0 // present
          if (selectedDate >= today) return 1 // pending
          return 2 // absent
        }
        const cmp = rankOf(a) - rankOf(b)
        if (cmp !== 0) return applyDirection(cmp, sortDirection)
        return compareByNameFields(
          { firstName: a.student_first_name, lastName: a.student_last_name, id: a.email_username },
          { firstName: b.student_first_name, lastName: b.student_last_name, id: b.email_username },
          'last_name',
          sortDirection
        )
      }
      if (sortColumn === 'id') {
        return applyDirection(a.email_username.localeCompare(b.email_username), sortDirection)
      }
      return compareByNameFields(
        { firstName: a.student_first_name, lastName: a.student_last_name, id: a.email_username },
        { firstName: b.student_first_name, lastName: b.student_last_name, id: b.email_username },
        sortColumn,
        sortDirection
      )
    })
  }, [logs, sortColumn, sortDirection, selectedDate, today])

  const { presentCount, absentCount } = useMemo(() => {
    let present = 0
    let absent = 0
    for (const row of rows) {
      if (row.entry && entryHasContent(row.entry)) {
        present++
      } else if (selectedDate < today) {
        absent++
      }
      // pending (selectedDate >= today && no entry) - not counted
    }
    return { presentCount: present, absentCount: absent }
  }, [rows, selectedDate, today])

  function handleSort(column: SortColumn) {
    setSortState((prev) => toggleSort(prev, column))
  }

  function moveDateBy(deltaDays: number) {
    setSelectedDate(prev => {
      const base = prev || getTodayInToronto()
      return addDaysToDateString(base, deltaDays)
    })
  }

  function handleRowClick(row: LogRow) {
    const newSelectedId = selectedStudentId === row.student_id ? null : row.student_id
    setSelectedStudentId(newSelectedId)

    if (newSelectedId) {
      const studentName = [row.student_first_name, row.student_last_name].filter(Boolean).join(' ') || row.email_username
      onSelectEntry?.(row.entry, studentName, row.student_id)
    } else {
      onSelectEntry?.(null, '', null)
    }
  }

  const handleDeselect = useCallback(() => {
    setSelectedStudentId(null)
    onSelectEntry?.(null, '', null)
  }, [onSelectEntry])

  const selectStudentByRow = useCallback(
    (row: LogRow) => {
      setSelectedStudentId(row.student_id)
      const studentName =
        [row.student_first_name, row.student_last_name].filter(Boolean).join(' ') ||
        row.email_username
      onSelectEntry?.(row.entry, studentName, row.student_id)
    },
    [onSelectEntry]
  )

  const selectStudentByName = useCallback(
    (name: string) => {
      const row = logs.find((logRow) => {
        const fullName = [logRow.student_first_name, logRow.student_last_name]
          .filter(Boolean)
          .join(' ')
        return fullName === name
      })
      if (row) {
        selectStudentByRow(row)
      }
    },
    [logs, selectStudentByRow]
  )

  // Keyboard navigation handler
  const handleKeyboardSelect = useCallback(
    (studentId: string) => {
      const row = rows.find((r) => r.student_id === studentId)
      if (!row) return
      selectStudentByRow(row)
    },
    [rows, selectStudentByRow]
  )

  useImperativeHandle(ref, () => ({
    selectStudentByName(name: string) {
      selectStudentByName(name)
    },
  }), [selectStudentByName])

  // Row keys for keyboard navigation (in sorted order)
  const rowKeys = useMemo(() => rows.map((r) => r.student_id), [rows])
  const selectedRow = useMemo(
    () => rows.find((row) => row.student_id === selectedStudentId) ?? null,
    [rows, selectedStudentId]
  )
  const selectedStudentName = selectedRow
    ? [selectedRow.student_first_name, selectedRow.student_last_name].filter(Boolean).join(' ') ||
      selectedRow.email_username
    : ''
  const selectedDateLabel = selectedDate ? format(parseISO(selectedDate), 'EEE MMM d') : 'Select date'

  const actionBar = (
    <TeacherWorkSurfaceActionBar
      center={
        <>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
          <CalendarDateNavigator
            label={selectedDateLabel}
            onLabelClick={() => dateInputRef.current?.showPicker()}
            labelAriaLabel="Select attendance date"
            onPrev={() => moveDateBy(-1)}
            onNext={() => moveDateBy(1)}
            prevAriaLabel="Previous day"
            nextAriaLabel="Next day"
          />
        </>
      }
      centerPlacement="floating"
    />
  )

  const detailPane = selectedRow ? (
    <StudentLogHistory studentId={selectedRow.student_id} classroomId={classroom.id} />
  ) : selectedDate ? (
    <LogSummary
      classroomId={classroom.id}
      date={selectedDate}
      onStudentClick={selectStudentByName}
    />
  ) : (
    <div className="p-4 text-sm text-text-muted">
      Select a date to view the log summary.
    </div>
  )

  const workspace = showBlockingSpinner ? (
    <div className="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    <TeacherWorkspaceSplit
      className="flex-1"
      splitVariant="gapped"
      primaryClassName="min-h-[200px] rounded-lg bg-surface"
      inspectorClassName="flex flex-col rounded-lg bg-surface"
      inspectorCollapsed={false}
      inspectorWidth={detailPaneWidth}
      minInspectorPx={280}
      minPrimaryPx={320}
      minInspectorPercent={28}
      maxInspectorPercent={72}
      defaultInspectorWidth={50}
      onInspectorWidthChange={setDetailPaneWidth}
      dividerLabel="Resize Daily panes"
      primary={
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="h-full min-h-0 overflow-auto"
          onClick={(e) => {
            // Deselect when clicking outside the table
            if (selectedStudentId && (e.target as HTMLElement).closest('table') === null) {
              handleDeselect()
            }
          }}
        >
          <KeyboardNavigableTable
            rowKeys={rowKeys}
            selectedKey={selectedStudentId}
            onSelectKey={handleKeyboardSelect}
            onDeselect={handleDeselect}
          >
            <TableCard chrome="flush">
              {refreshing && (
                <RefreshingIndicator />
              )}
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <SortableHeaderCell
                      label="First"
                      isActive={sortColumn === 'first_name'}
                      direction={sortDirection}
                      onClick={() => handleSort('first_name')}
                      density="tight"
                      trailing={isClassDay && rows.length > 0 ? <StudentCountBadge count={rows.length} variant="neutral" /> : undefined}
                    />
                    <SortableHeaderCell
                      label="Last"
                      isActive={sortColumn === 'last_name'}
                      direction={sortDirection}
                      onClick={() => handleSort('last_name')}
                      density="tight"
                    />
                    <SortableHeaderCell
                      label="ID"
                      isActive={sortColumn === 'id'}
                      direction={sortDirection}
                      onClick={() => handleSort('id')}
                      density="tight"
                    />
                    <SortableHeaderCell
                      label={isClassDay ? '' : 'Status'}
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onClick={() => handleSort('status')}
                      density="tight"
                      align="center"
                      trailing={isClassDay ? (
                        <div className="flex items-center gap-2">
                          <CountBadge count={presentCount} tooltip="Present" variant="success" />
                          <CountBadge count={absentCount} tooltip="Absent" variant="danger" />
                        </div>
                      ) : undefined}
                    />
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row) => {
                    const isSelected = selectedStudentId === row.student_id
                    const status: AttendanceStatus = row.entry && entryHasContent(row.entry)
                      ? 'present'
                      : selectedDate >= today
                        ? 'pending'
                        : 'absent'
                    return (
                      <DataTableRow
                        key={row.student_id}
                        className={[
                          'cursor-pointer transition-colors',
                          isSelected
                            ? 'bg-info-bg hover:bg-info-bg-hover'
                            : 'hover:bg-surface-hover',
                        ].join(' ')}
                        onClick={() => handleRowClick(row)}
                      >
                        <DataTableCell density="tight">{row.student_first_name || '—'}</DataTableCell>
                        <DataTableCell density="tight">{row.student_last_name || '—'}</DataTableCell>
                        <DataTableCell density="tight" className="text-text-muted">
                          {row.email_username}
                        </DataTableCell>
                        <DataTableCell density="tight" align="center">
                          {isClassDay ? (
                            <Tooltip content={getAttendanceLabel(status)}>
                              <span
                                className={`inline-block w-3 h-3 rounded-full ${getAttendanceDotClass(status)}`}
                              />
                            </Tooltip>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                  {rows.length === 0 && (
                    <EmptyStateRow
                      colSpan={4}
                      message={isClassDay ? 'No students enrolled' : 'Not a class day'}
                    />
                  )}
                </DataTableBody>
              </DataTable>
            </TableCard>
          </KeyboardNavigableTable>
        </div>
      }
      inspector={
        <>
          <div className="flex min-h-10 items-center border-b border-border px-3 py-2">
            <span className="truncate text-sm font-semibold text-text-default">
              {selectedRow ? selectedStudentName : 'Log Summary'}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {detailPane}
          </div>
        </>
      }
    />
  )

  return (
    <TeacherWorkSurfaceShell
      state="workspace"
      primary={actionBar}
      summary={null}
      workspace={workspace}
      workspaceFrame="standalone"
      workspaceFrameClassName="min-h-[360px] border-0 bg-page"
    />
  )
})
