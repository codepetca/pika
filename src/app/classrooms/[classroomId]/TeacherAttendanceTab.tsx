'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { CircleDot, GripHorizontal, UndoDot } from 'lucide-react'
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
import { Button, RefreshingIndicator, Tooltip } from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'
import type { AttendanceStatus } from '@/types'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
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

const SUMMARY_PANEL_DEFAULT_HEIGHT = 180
const SUMMARY_PANEL_COLLAPSED_HEIGHT = 40
const SUMMARY_PANEL_MIN_HEIGHT = 140
const SUMMARY_PANEL_MAX_HEIGHT = 420
const SUMMARY_PANEL_KEYBOARD_STEP = 32

function getSummaryPanelMaxHeight() {
  if (typeof window === 'undefined') return SUMMARY_PANEL_MAX_HEIGHT
  return Math.max(
    SUMMARY_PANEL_MIN_HEIGHT,
    Math.min(SUMMARY_PANEL_MAX_HEIGHT, Math.floor(window.innerHeight * 0.48))
  )
}

function clampSummaryPanelHeight(height: number) {
  return Math.min(getSummaryPanelMaxHeight(), Math.max(SUMMARY_PANEL_MIN_HEIGHT, Math.round(height)))
}

interface LogRow {
  student_id: string
  student_email: string
  student_first_name: string
  student_last_name: string
  email_username: string
  entry: Entry | null
  history_preview: Entry[]
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
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const selectedWorkspaceRef = useRef<HTMLDivElement | null>(null)
  const hasLoadedOnceRef = useRef(false)
  const [detailPaneWidth, setDetailPaneWidth] = useState(50)
  const [summaryPanelCollapsed, setSummaryPanelCollapsed] = useState(false)
  const [summaryPanelHeight, setSummaryPanelHeight] = useState(SUMMARY_PANEL_DEFAULT_HEIGHT)
  const showBlockingSpinner = useDelayedBusy(loading && logs.length === 0)
  const [today, setToday] = useState(() => getTodayInToronto())
  const refreshToday = useCallback(() => {
    const currentToday = getTodayInToronto()
    setToday(currentToday)
    return currentToday
  }, [])
  const lastClassDate = useMemo(
    () => getMostRecentClassDayBefore(classDays, today),
    [classDays, today]
  )
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })

  // Set initial date once class days are loaded from context
  useEffect(() => {
    if (classDaysLoading) return
    if (selectedDate) return // Already initialized
    setSelectedDate(lastClassDate || addDaysToDateString(today, -1))
    // Do NOT setLoading(false) here — the logs fetch (Effect 3) handles it
  }, [classDaysLoading, lastClassDate, selectedDate, today])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshToday()
      }
    }

    window.addEventListener('focus', refreshToday)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = window.setInterval(refreshToday, 60 * 1000)

    return () => {
      window.removeEventListener('focus', refreshToday)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [refreshToday])

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
        hasLoadedOnceRef.current = true
        setSelectedStudentId(null)
        onSelectEntry?.(null, '', null)
        setLoading(false)
        setRefreshing(false)
        return
      }

      if (hasLoadedOnceRef.current) {
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
        hasLoadedOnceRef.current = true
      } catch (err) {
        console.error('Error loading logs:', err)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }
    loadLogs()
  }, [classroom.id, classDays, selectedDate, onSelectEntry, isActive])

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

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

  const {
    scrollRef: studentTableScrollRef,
    preserveScrollPosition: preserveStudentTableScrollPosition,
  } = useScrollPositionMemory<HTMLDivElement>({
    key: selectedDate ? `${classroom.id}:${selectedDate}` : null,
    enabled: !showBlockingSpinner,
    restoreToken: [
      selectedStudentId ?? 'none',
      rows.length,
      loading ? 'loading' : 'ready',
      refreshing ? 'refreshing' : 'idle',
    ].join(':'),
  })

  function handleSort(column: SortColumn) {
    setSortState((prev) => toggleSort(prev, column))
  }

  function moveDateBy(deltaDays: number) {
    setSelectedDate(prev => {
      const base = prev || getTodayInToronto()
      return addDaysToDateString(base, deltaDays)
    })
  }

  function goToLastClass() {
    const currentToday = refreshToday()
    const currentLastClassDate = getMostRecentClassDayBefore(classDays, currentToday)
    if (!currentLastClassDate) return
    setSelectedDate(currentLastClassDate)
  }

  function goToToday() {
    setSelectedDate(refreshToday())
  }

  function handleRowClick(row: LogRow) {
    preserveStudentTableScrollPosition()
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
    preserveStudentTableScrollPosition()
    setSelectedStudentId(null)
    onSelectEntry?.(null, '', null)
  }, [onSelectEntry, preserveStudentTableScrollPosition])

  useEffect(() => {
    if (!selectedStudentId || !isActive) return

    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      handleDeselect()
    }

    window.addEventListener('keydown', handleEscapeKey)
    return () => window.removeEventListener('keydown', handleEscapeKey)
  }, [handleDeselect, isActive, selectedStudentId])

  useEffect(() => {
    if (!selectedStudentId || !isActive) return

    function handlePointerDown(event: PointerEvent) {
      const selectedWorkspace = selectedWorkspaceRef.current
      if (!selectedWorkspace) return
      if (event.target instanceof Node && selectedWorkspace.contains(event.target)) return
      handleDeselect()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [handleDeselect, isActive, selectedStudentId])

  const selectStudentByRow = useCallback(
    (row: LogRow) => {
      preserveStudentTableScrollPosition()
      setSelectedStudentId(row.student_id)
      const studentName =
        [row.student_first_name, row.student_last_name].filter(Boolean).join(' ') ||
        row.email_username
      onSelectEntry?.(row.entry, studentName, row.student_id)
    },
    [onSelectEntry, preserveStudentTableScrollPosition]
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

  const handleSummaryPanelDoubleClick = useCallback(() => {
    setSummaryPanelCollapsed((collapsed) => {
      if (collapsed) {
        setSummaryPanelHeight(SUMMARY_PANEL_DEFAULT_HEIGHT)
      }
      return !collapsed
    })
  }, [])

  const handleSummaryResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()

      const startY = event.clientY
      const collapsedAtStart = summaryPanelCollapsed
      const startHeight = collapsedAtStart ? SUMMARY_PANEL_COLLAPSED_HEIGHT : summaryPanelHeight
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (collapsedAtStart && moveEvent.clientY >= startY) return
        setSummaryPanelCollapsed(false)
        setSummaryPanelHeight(clampSummaryPanelHeight(startHeight + startY - moveEvent.clientY))
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
    },
    [summaryPanelCollapsed, summaryPanelHeight],
  )

  const handleSummaryResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSummaryPanelCollapsed(false)
        setSummaryPanelHeight((height) =>
          clampSummaryPanelHeight(
            (summaryPanelCollapsed ? SUMMARY_PANEL_MIN_HEIGHT : height) + SUMMARY_PANEL_KEYBOARD_STEP
          )
        )
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (!summaryPanelCollapsed) {
          setSummaryPanelHeight((height) => clampSummaryPanelHeight(height - SUMMARY_PANEL_KEYBOARD_STEP))
        }
      } else if (event.key === 'Home') {
        event.preventDefault()
        setSummaryPanelCollapsed(false)
        setSummaryPanelHeight(SUMMARY_PANEL_MIN_HEIGHT)
      } else if (event.key === 'End') {
        event.preventDefault()
        setSummaryPanelCollapsed(false)
        setSummaryPanelHeight(getSummaryPanelMaxHeight())
      } else if (event.key === 'Enter') {
        event.preventDefault()
        setSummaryPanelCollapsed(false)
        setSummaryPanelHeight(SUMMARY_PANEL_DEFAULT_HEIGHT)
      }
    },
    [summaryPanelCollapsed],
  )

  const actionBar = (
    <TeacherWorkSurfaceActionBar
      center={
        <div className="flex min-w-0 items-center gap-1">
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
          <Tooltip content="Last class">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={goToLastClass}
              disabled={!lastClassDate}
              aria-label="Go to last class"
            >
              <UndoDot className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
          <CalendarDateNavigator
            label={selectedDateLabel}
            onLabelClick={() => dateInputRef.current?.showPicker()}
            labelAriaLabel="Select attendance date"
            onPrev={() => moveDateBy(-1)}
            onNext={() => moveDateBy(1)}
            prevAriaLabel="Previous day"
            nextAriaLabel="Next day"
          />
          <Tooltip content="Today">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={goToToday}
              aria-label="Go to today"
            >
              <CircleDot className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      }
      centerPlacement="floating"
    />
  )

  function renderStudentTable(showLogColumn: boolean) {
    const visibleColumnCount = showLogColumn ? 5 : 4

    return (
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
          <DataTable className={showLogColumn ? 'table-fixed' : ''}>
            <DataTableHead>
              <DataTableRow>
                <SortableHeaderCell
                  label="First"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('first_name')}
                  density="tight"
                  className={showLogColumn ? 'w-24 sm:w-36' : ''}
                  trailing={isClassDay && rows.length > 0 ? (
                    <span className={showLogColumn ? 'hidden sm:inline-flex' : 'inline-flex'}>
                      <StudentCountBadge count={rows.length} variant="neutral" />
                    </span>
                  ) : undefined}
                />
                <SortableHeaderCell
                  label="Last"
                  isActive={sortColumn === 'last_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('last_name')}
                  density="tight"
                  className={showLogColumn ? 'w-20 sm:w-36' : ''}
                />
                <SortableHeaderCell
                  label="ID"
                  isActive={sortColumn === 'id'}
                  direction={sortDirection}
                  onClick={() => handleSort('id')}
                  density="tight"
                  className={showLogColumn ? 'hidden w-32 md:table-cell' : ''}
                />
                {showLogColumn && (
                  <DataTableHeaderCell density="tight" className="min-w-0">
                    Log
                  </DataTableHeaderCell>
                )}
                <SortableHeaderCell
                  label={isClassDay ? '' : 'Status'}
                  isActive={sortColumn === 'status'}
                  direction={sortDirection}
                  onClick={() => handleSort('status')}
                  density="tight"
                  align="center"
                  className={showLogColumn ? 'w-[5.5rem]' : ''}
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
                const hasLog = Boolean(row.entry && entryHasContent(row.entry))
                const logText = hasLog ? row.entry?.text || '' : ''
                const status: AttendanceStatus = hasLog
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
                    <DataTableCell density="tight" className={showLogColumn ? 'min-w-0' : ''}>
                      <span className={showLogColumn ? 'block truncate' : ''}>
                        {row.student_first_name || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell density="tight" className={showLogColumn ? 'min-w-0' : ''}>
                      <span className={showLogColumn ? 'block truncate' : ''}>
                        {row.student_last_name || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell
                      density="tight"
                      className={[
                        'text-text-muted',
                        showLogColumn ? 'hidden md:table-cell' : '',
                      ].join(' ')}
                    >
                      {row.email_username}
                    </DataTableCell>
                    {showLogColumn && (
                      <DataTableCell density="tight" className="min-w-0 text-text-muted">
                        {hasLog ? (
                          <span className="block truncate" title={logText}>
                            {logText}
                          </span>
                        ) : (
                          <span aria-label="No log for this date">—</span>
                        )}
                      </DataTableCell>
                    )}
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
                  colSpan={visibleColumnCount}
                  message={isClassDay ? 'No students enrolled' : 'Not a class day'}
                />
              )}
            </DataTableBody>
          </DataTable>
        </TableCard>
      </KeyboardNavigableTable>
    )
  }

  const detailPane = selectedRow ? (
    <StudentLogHistory
      studentId={selectedRow.student_id}
      classroomId={classroom.id}
      selectedEntry={selectedRow.entry}
      initialEntries={selectedRow.history_preview}
    />
  ) : (
    <div className="p-4 text-sm text-text-muted">
      Select a student to view log history.
    </div>
  )

  const workspace = showBlockingSpinner ? (
    <div className="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : (
    selectedRow ? (
      <div ref={selectedWorkspaceRef} className="daily-workspace-enter flex min-h-0 flex-1">
        <TeacherWorkspaceSplit
          className="flex-1"
          splitVariant="gapped"
          primaryClassName="min-h-[200px] rounded-lg bg-surface"
          inspectorClassName="daily-inspector-enter flex flex-col rounded-lg bg-surface"
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
              ref={studentTableScrollRef}
              className="h-full min-h-0 overflow-auto"
              data-testid="daily-student-scroll-pane"
              onScroll={preserveStudentTableScrollPosition}
              onClick={(e) => {
                // Deselect when clicking outside the table
                if (selectedStudentId && (e.target as HTMLElement).closest('table') === null) {
                  handleDeselect()
                }
              }}
            >
              {renderStudentTable(false)}
            </div>
          }
          inspector={
            <>
              <div className="flex min-h-10 items-center border-b border-border px-3 py-2">
                <span className="truncate text-sm font-semibold text-text-default">
                  {selectedStudentName}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {detailPane}
              </div>
            </>
          }
        />
      </div>
    ) : (
      <div className="daily-table-enter flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div
          ref={studentTableScrollRef}
          className="min-h-[180px] flex-1 overflow-auto rounded-lg bg-surface"
          data-testid="daily-student-scroll-pane"
          onScroll={preserveStudentTableScrollPosition}
        >
          {renderStudentTable(true)}
        </div>
        {selectedDate && (
          <section
            role="region"
            aria-label="Class Log Summary"
            data-state={summaryPanelCollapsed ? 'collapsed' : 'expanded'}
            className={
              summaryPanelCollapsed
                ? 'flex h-10 min-h-10 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface'
                : 'flex min-h-[140px] shrink-0 flex-col overflow-hidden rounded-lg bg-surface'
            }
            style={{ height: `${summaryPanelCollapsed ? SUMMARY_PANEL_COLLAPSED_HEIGHT : summaryPanelHeight}px` }}
            onDoubleClick={handleSummaryPanelDoubleClick}
          >
            <div
              role="separator"
              aria-label="Resize class log summary"
              aria-orientation="horizontal"
              aria-valuemin={summaryPanelCollapsed ? SUMMARY_PANEL_COLLAPSED_HEIGHT : SUMMARY_PANEL_MIN_HEIGHT}
              aria-valuemax={SUMMARY_PANEL_MAX_HEIGHT}
              aria-valuenow={summaryPanelCollapsed ? SUMMARY_PANEL_COLLAPSED_HEIGHT : summaryPanelHeight}
              tabIndex={0}
              className={
                summaryPanelCollapsed
                  ? 'flex h-10 shrink-0 cursor-ns-resize items-center justify-center gap-2 px-3 text-sm font-semibold text-text-default outline-none transition-colors hover:bg-surface-hover focus:bg-info-bg'
                  : 'flex h-5 shrink-0 cursor-ns-resize items-center justify-center border-b border-border text-text-muted outline-none transition-colors hover:bg-surface-hover focus:bg-info-bg focus:text-text-default'
              }
              onPointerDown={handleSummaryResizeStart}
              onKeyDown={handleSummaryResizeKeyDown}
            >
              <GripHorizontal className="h-4 w-4" aria-hidden="true" />
              {summaryPanelCollapsed ? <span>Log Summary</span> : null}
            </div>
            {!summaryPanelCollapsed && (
              <>
                <div className="flex min-h-10 items-center border-b border-border px-3 py-2">
                  <h3 className="truncate text-sm font-semibold text-text-default">
                    Class Log Summary
                  </h3>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <LogSummary
                    classroomId={classroom.id}
                    date={selectedDate}
                    onStudentClick={selectStudentByName}
                  />
                </div>
              </>
            )}
          </section>
        )}
      </div>
    )
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
