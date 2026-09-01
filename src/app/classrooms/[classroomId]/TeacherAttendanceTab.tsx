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
import {
  ChevronDown,
  ClipboardCopy,
  Clock3,
  DoorClosed,
  DoorOpen,
  GripHorizontal,
  MoreVertical,
  QrCode as QrCodeIcon,
  RotateCcw,
  Trash2,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { DateNavigator } from '@/components/DateNavigator'
import { StudentLogHistory } from '@/components/StudentLogHistory'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import {
  TeacherWorkSurfaceIconMenuButton,
  TeacherWorkSurfaceMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import { LogSummary } from './LogSummary'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString, getPastRelativeDateLabel } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { entryHasContent } from '@/lib/attendance'
import { useClassDaysContext } from '@/hooks/useClassDays'
import {
  Button,
  ContentDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  PageState,
  QrCode,
  RefreshingIndicator,
  SortableHeaderCell,
  TableSelectionCell,
  TableSelectionHeaderCell,
  Tooltip,
  cn,
} from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
import { CountBadge } from '@/components/StudentCountBadge'
import {
  applyDirection,
  compareByNameFields,
  compareNullableStrings,
  toggleSort,
} from '@/lib/table-sort'
import { fetchCachedJSON } from '@/lib/request-cache'
import type { Classroom, Entry } from '@/types'
import { format, parseISO } from 'date-fns'
import { AttendanceWindowDialog } from './AttendanceWindowDialog'
import { useTeacherAttendancePolicy } from '@/hooks/useTeacherAttendancePolicy'
import {
  AttendanceStatusControl,
  AttendanceStatusSortChip,
  SORTABLE_ATTENDANCE_STATUSES,
} from './TeacherAttendanceControls'
import {
  formatTeacherAttendanceTime,
  useTeacherAttendanceController,
  type TeacherAttendanceMark,
} from '@/hooks/useTeacherAttendanceController'

type SortColumn = 'first_name' | 'last_name' | 'id' | 'log' | 'check_in' | 'attendance_status'
type ResizableColumn = 'first' | 'last' | 'id' | 'checkIn'

const COLUMN_LIMITS: Record<ResizableColumn, { defaultWidth: number; min: number; max: number }> = {
  first: { defaultWidth: 72, min: 60, max: 160 },
  last: { defaultWidth: 72, min: 60, max: 160 },
  id: { defaultWidth: 80, min: 56, max: 180 },
  checkIn: { defaultWidth: 92, min: 76, max: 140 },
}

const SUMMARY_PANEL_DEFAULT_HEIGHT = 180
const SUMMARY_PANEL_COLLAPSED_HEIGHT = 40
const SUMMARY_PANEL_MIN_HEIGHT = 140
const SUMMARY_PANEL_MAX_HEIGHT = 420
const SUMMARY_PANEL_KEYBOARD_STEP = 32
const getAttendanceStudentRowId = (studentId: string) => `attendance-student-row-${studentId}`

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
  attendanceEnabled?: boolean
  onSelectEntry?: (entry: Entry | null, studentName: string, studentId: string | null) => void
  onDateChange?: (date: string) => void
  isActive?: boolean
}

export interface TeacherAttendanceTabHandle {
  selectStudentByName: (name: string) => void
}

export const TeacherAttendanceTab = forwardRef<TeacherAttendanceTabHandle, Props>(function TeacherAttendanceTab({
  classroom,
  attendanceEnabled = false,
  onSelectEntry,
  onDateChange,
  isActive = true,
}: Props, ref) {
  const {
    classDays,
    error: classDaysError,
    hasLoadedSnapshot: hasClassDaysSnapshot,
    isLoading: classDaysLoading,
    refresh: refreshClassDays,
  } = useClassDaysContext()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logsRequestVersion, setLogsRequestVersion] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [showIdColumn, setShowIdColumn] = useState(true)
  const [showRelativeDate, setShowRelativeDate] = useState(true)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const selectedWorkspaceRef = useRef<HTMLDivElement | null>(null)
  const studentTableNavigationRef = useRef<HTMLDivElement | null>(null)
  const pendingKeyboardFocusStudentIdRef = useRef<string | null>(null)
  const pendingKeyboardTableFocusRef = useRef(false)
  const onSelectEntryRef = useRef(onSelectEntry)
  const hasLoadedOnceRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  const currentSelectedDateRef = useRef('')
  const [detailPaneWidth, setDetailPaneWidth] = useState(50)
  const [summaryPanelCollapsed, setSummaryPanelCollapsed] = useState(false)
  const [summaryPanelHeight, setSummaryPanelHeight] = useState(SUMMARY_PANEL_DEFAULT_HEIGHT)
  const { columnWidths, setColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-daily:v1',
    columns: COLUMN_LIMITS,
  })
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
  const [{ column: sortColumn, direction: sortDirection, status: sortStatus }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
    status: TeacherAttendanceMark | null
  }>({ column: 'last_name', direction: 'asc', status: null })
  const visibleStudentIds = useMemo(
    () => logs.map((log) => log.student_id),
    [logs],
  )
  const attendance = useTeacherAttendanceController({
    classroom,
    selectedDate,
    enabled: attendanceEnabled,
    isActive,
    visibleStudentIds,
  })
  const showAttendanceSelection = attendanceEnabled && attendance.canMark
  const hours = useTeacherAttendancePolicy(classroom.id, attendanceEnabled && isActive && !classroom.archived_at)
  const [scheduleDeliveryFailure, setScheduleDeliveryFailure] = useState<string | null>(null)
  const hoursActionLabel = hours.label
    ? `Attendance hours, ${hours.label.replace(' - ', ' to ')}`
    : hours.state === 'error'
      ? 'Attendance hours unavailable'
      : hours.state === 'loading'
        ? 'Loading attendance hours'
        : 'Set attendance hours'
  currentClassroomIdRef.current = classroom.id
  currentSelectedDateRef.current = selectedDate
  onSelectEntryRef.current = onSelectEntry

  useEffect(() => {
    const stored = window.localStorage.getItem('teacher-daily:show-id')
    if (stored === 'false') setShowIdColumn(false)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('teacher-daily:show-id', String(showIdColumn))
    if (!showIdColumn && sortColumn === 'id') {
      setSortState({ column: 'last_name', direction: 'asc', status: null })
    }
  }, [showIdColumn, sortColumn])

  useEffect(() => {
    const stored = window.localStorage.getItem('teacher-daily:show-relative-date')
    if (stored === 'false') setShowRelativeDate(false)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('teacher-daily:show-relative-date', String(showRelativeDate))
  }, [showRelativeDate])

  const isCurrentLogsRequest = useCallback((requestId: number, classroomId: string, date: string) => {
    return (
      loadRequestIdRef.current === requestId &&
      currentClassroomIdRef.current === classroomId &&
      currentSelectedDateRef.current === date
    )
  }, [])

  useEffect(() => {
    loadRequestIdRef.current += 1
    hasLoadedOnceRef.current = false
    setLogs([])
    setLoading(true)
    setRefreshing(false)
    setLogsError(null)
    setSelectedDate('')
    setSelectedStudentId(null)
    onSelectEntryRef.current?.(null, '', null)
  }, [classroom.id])

  // Set initial date once class days are loaded from context
  useEffect(() => {
    if (classDaysLoading || (classDaysError && !hasClassDaysSnapshot)) return
    if (selectedDate) return // Already initialized
    setSelectedDate(lastClassDate || addDaysToDateString(today, -1))
    // Do NOT setLoading(false) here — the logs fetch (Effect 3) handles it
  }, [classDaysError, classDaysLoading, hasClassDaysSnapshot, lastClassDate, selectedDate, today])

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
      const classroomId = classroom.id
      const date = selectedDate
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      setLogsError(null)

      if (!isClassDayOnDate(classDays, date)) {
        if (!isCurrentLogsRequest(requestId, classroomId, date)) return
        setLogs([])
        setLogsError(null)
        hasLoadedOnceRef.current = true
        setSelectedStudentId(null)
        onSelectEntryRef.current?.(null, '', null)
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
        const data = await fetchCachedJSON<{ logs?: LogRow[] }>(
          `teacher-attendance:${classroomId}:${date}`,
          `/api/teacher/logs?classroom_id=${classroomId}&date=${date}`,
          { ttlMs: 0, errorMessage: 'Failed to load attendance' },
        )
        if (!isCurrentLogsRequest(requestId, classroomId, date)) return
        const rawLogs = data.logs || []
        const mappedLogs = rawLogs.map((log: any) => ({
          ...log,
          email_username: log.student_email.split('@')[0],
        }))
        setLogs(mappedLogs)
        setLogsError(null)

        // Clear selection when date changes so summary is visible
        setSelectedStudentId(null)
        onSelectEntryRef.current?.(null, '', null)
        hasLoadedOnceRef.current = true
      } catch (err) {
        if (!isCurrentLogsRequest(requestId, classroomId, date)) return
        console.error('Error loading logs:', err)
        setLogs([])
        setLogsError('The class log could not be loaded for this date.')
        setSelectedStudentId(null)
        onSelectEntryRef.current?.(null, '', null)
      } finally {
        if (!isCurrentLogsRequest(requestId, classroomId, date)) return
        setLoading(false)
        setRefreshing(false)
      }
    }
    loadLogs()
  }, [classroom.id, classDays, selectedDate, isActive, isCurrentLogsRequest, logsRequestVersion])

  const retryLogs = useCallback(() => {
    setLogsError(null)
    setLoading(true)
    setLogsRequestVersion((version) => version + 1)
  }, [])

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

  const rows = useMemo(() => {
    return [...logs].sort((a, b) => {
      const compareNames = () => compareByNameFields(
        { firstName: a.student_first_name, lastName: a.student_last_name, id: a.email_username },
        { firstName: b.student_first_name, lastName: b.student_last_name, id: b.email_username },
        'last_name',
        'asc',
      )

      if (sortColumn === 'attendance_status') {
        if (!sortStatus) return compareNames()
        const aStatus = attendance.studentsById.get(a.student_id)?.status
        const bStatus = attendance.studentsById.get(b.student_id)?.status
        const statusRank = Number(bStatus === sortStatus) - Number(aStatus === sortStatus)
        return statusRank || compareNames()
      }
      if (sortColumn === 'check_in') {
        const aCheckIn = attendance.studentsById.get(a.student_id)?.checkedInAt ?? null
        const bCheckIn = attendance.studentsById.get(b.student_id)?.checkedInAt ?? null
        return applyDirection(compareNullableStrings(aCheckIn, bCheckIn), sortDirection) || compareNames()
      }
      if (sortColumn === 'log') {
        const rankOf = (row: LogRow) => {
          return row.entry && entryHasContent(row.entry) ? 0 : 1
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
  }, [attendance.studentsById, logs, sortColumn, sortDirection, sortStatus])

  const attendanceStatusCounts = useMemo(() => {
    const counts: Record<TeacherAttendanceMark, number> = { present: 0, late: 0, absent: 0 }
    for (const row of logs) {
      const status = attendance.studentsById.get(row.student_id)?.status
      if (status && status !== 'unmarked') counts[status] += 1
    }
    return counts
  }, [attendance.studentsById, logs])

  const { completeCount, incompleteCount } = useMemo(() => {
    let complete = 0
    let incomplete = 0
    for (const row of rows) {
      if (row.entry && entryHasContent(row.entry)) {
        complete++
      } else {
        incomplete++
      }
    }
    return { completeCount: complete, incompleteCount: incomplete }
  }, [rows])

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
    setSortState((prev) => ({ ...toggleSort(prev, column), status: null }))
  }

  function handleAttendanceStatusSort(status: TeacherAttendanceMark) {
    setSortState({ column: 'attendance_status', direction: 'asc', status })
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
    pendingKeyboardFocusStudentIdRef.current = null
    preserveStudentTableScrollPosition()
    setSelectedStudentId(null)
    onSelectEntry?.(null, '', null)
  }, [onSelectEntry, preserveStudentTableScrollPosition])

  const handleKeyboardDeselect = useCallback(() => {
    pendingKeyboardTableFocusRef.current = true
    handleDeselect()
  }, [handleDeselect])

  useEffect(() => {
    if (!selectedStudentId || !isActive) return

    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="menu"]')) return
      event.preventDefault()
      handleKeyboardDeselect()
    }

    window.addEventListener('keydown', handleEscapeKey)
    return () => window.removeEventListener('keydown', handleEscapeKey)
  }, [handleKeyboardDeselect, isActive, selectedStudentId])

  useEffect(() => {
    if (!selectedStudentId || !isActive) return

    function handlePointerDown(event: PointerEvent) {
      const selectedWorkspace = selectedWorkspaceRef.current
      if (!selectedWorkspace) return
      if (event.target instanceof Element && event.target.closest('[aria-label="Daily controls"]')) return
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
      pendingKeyboardFocusStudentIdRef.current = studentId
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

  useEffect(() => {
    const pendingStudentId = pendingKeyboardFocusStudentIdRef.current
    if (pendingStudentId && selectedStudentId === pendingStudentId) {
      document.getElementById(getAttendanceStudentRowId(pendingStudentId))?.focus()
      pendingKeyboardFocusStudentIdRef.current = null
      return
    }

    if (!selectedStudentId && pendingKeyboardTableFocusRef.current) {
      studentTableNavigationRef.current?.focus()
      pendingKeyboardTableFocusRef.current = false
    }
  }, [selectedStudentId])
  const selectedStudentName = selectedRow
    ? [selectedRow.student_first_name, selectedRow.student_last_name].filter(Boolean).join(' ') ||
      selectedRow.email_username
    : ''
  const selectedDateLabel = selectedDate ? format(parseISO(selectedDate), 'EEE MMM d') : 'Select date'
  const relativeDateLabel = selectedDate ? getPastRelativeDateLabel(selectedDate, today) : null

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

  const moreActions: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'toggle-id-column',
      label: showIdColumn ? 'Hide ID column' : 'Show ID column',
      onSelect: () => setShowIdColumn((visible) => !visible),
    },
    {
      id: 'toggle-relative-date',
      label: showRelativeDate ? 'Hide relative date' : 'Show relative date',
      onSelect: () => setShowRelativeDate((visible) => !visible),
    },
  ]
  const selectedStudentActions: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'mark-selected-present',
      label: 'Present',
      icon: <UserRoundCheck className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || !attendance.canMark,
      onSelect: () => void attendance.submitMarks([...attendance.selectedIds], 'present', { clearSelectionAfter: true }),
    },
    {
      id: 'mark-selected-late',
      label: 'Late',
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || !attendance.canMark,
      onSelect: () => void attendance.submitMarks([...attendance.selectedIds], 'late', { clearSelectionAfter: true }),
    },
    {
      id: 'mark-selected-absent',
      label: 'Absent',
      icon: <UserRoundX className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || !attendance.canMark,
      onSelect: () => void attendance.submitMarks([...attendance.selectedIds], 'absent', { clearSelectionAfter: true }),
    },
    {
      id: 'restore-selected-automatic-status',
      label: 'Use automatic',
      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || !attendance.canMark,
      onSelect: () => void attendance.submitMarks([...attendance.selectedIds], 'automatic', { clearSelectionAfter: true }),
    },
    {
      id: 'remove-selected-qr-check-ins',
      label: 'Remove QR check-in',
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || !attendance.canMark,
      onSelect: () => void attendance.resetCheckIns([...attendance.selectedIds]),
    },
  ]
  const mobileAttendanceActions: TeacherWorkSurfaceActionItem[] = attendanceEnabled ? [
    ...(attendance.attendanceReady && attendance.sessionState === 'open' ? [{
      id: 'show-attendance-qr',
      label: 'Show QR',
      icon: <QrCodeIcon className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || attendance.sessionPending,
      onSelect: attendance.openQrPresentation,
    }] : []),
    ...(attendance.attendanceReady && attendance.sessionAction ? [{
      id: `${attendance.sessionAction.command}-attendance`,
      label: attendance.sessionAction.label,
      icon: attendance.sessionAction.command === 'open'
        ? <DoorOpen className="h-4 w-4" aria-hidden="true" />
        : <DoorClosed className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand) || attendance.sessionPending,
      onSelect: () => void attendance.submitSessionCommand(attendance.sessionAction!.command),
    }] : []),
    ...(!classroom.archived_at ? [{
      id: 'attendance-hours',
      label: hours.label ? `Attendance hours: ${hours.label}` : hoursActionLabel,
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      disabled: Boolean(attendance.activeCommand),
      onSelect: () => attendance.setAttendanceHoursOpen(true),
    }] : []),
  ] : []

  const actionBar = (
    <TeacherWorkSurfaceContextBar
      ariaLabel="Daily controls"
      testId="daily-context-bar"
      context={attendanceEnabled ? (
        <div className="hidden min-w-0 items-center justify-start whitespace-nowrap sm:flex">
          {!classroom.archived_at ? (
            <Tooltip content={hours.label ? 'Edit attendance hours' : hoursActionLabel}>
              <Button
                type="button"
                size="xs"
                variant="surface"
                className={cn(
                  'h-9 w-fit max-w-full justify-start whitespace-nowrap px-2.5 text-left tabular-nums text-text-muted hover:text-text-default',
                  !hours.label && 'w-9 justify-center px-0',
                )}
                aria-label={hoursActionLabel}
                disabled={Boolean(attendance.activeCommand)}
                onClick={() => attendance.setAttendanceHoursOpen(true)}
              >
                {hours.label ?? <Clock3 className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </Tooltip>
          ) : attendanceEnabled && attendance.windowLabel ? (
            <span className="inline-flex h-9 items-center whitespace-nowrap rounded-control px-2.5 text-xs tabular-nums text-text-muted">
              {attendance.windowLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      primary={(
        <div className="flex min-w-0 items-center gap-1" data-testid="daily-primary-control">
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
          <DateNavigator
            label={selectedDateLabel}
            subtitle={showRelativeDate ? relativeDateLabel : null}
            reserveSubtitleSpace
            onPrev={() => setSelectedDate((current) => addDaysToDateString(current, -1))}
            onNext={() => setSelectedDate((current) => addDaysToDateString(current, 1))}
            onLabelClick={() => dateInputRef.current?.showPicker()}
            labelAriaLabel="Select Daily date"
            prevAriaLabel="Previous day"
            nextAriaLabel="Next day"
            labelClassName="min-w-24 px-2 sm:min-w-28 sm:px-3"
            joined
          />
          {mobileAttendanceActions.length > 0 ? (
            <div className="sm:hidden">
              <TeacherWorkSurfaceIconMenuButton
                ariaLabel="Attendance actions"
                tooltip="Attendance actions"
                variant="primary"
                icon={attendance.sessionState === 'open'
                  ? <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                  : <DoorOpen className="h-4 w-4" aria-hidden="true" />}
                items={mobileAttendanceActions}
                disabled={Boolean(attendance.activeCommand) || attendance.sessionPending}
                menuAriaLabel="Attendance actions"
                menuAlign="center"
              />
            </div>
          ) : null}
          {attendance.attendanceReady && attendance.sessionState === 'open' ? (
            <Tooltip content="Show QR">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="hidden h-9 w-9 px-0 sm:inline-flex"
                aria-label="Show QR"
                disabled={Boolean(attendance.activeCommand) || attendance.sessionPending}
                onClick={attendance.openQrPresentation}
              >
                <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          ) : null}
          {attendance.attendanceReady && attendance.sessionAction ? (
            <Tooltip content={attendance.sessionAction.label}>
              <Button
                type="button"
                size="sm"
                variant={attendance.sessionAction.command === 'open' ? 'primary' : 'secondary'}
                className="hidden h-9 w-9 px-0 sm:inline-flex"
                aria-label={attendance.sessionAction.label}
                loading={attendance.activeCommand === `session:${attendance.sessionAction.command}`}
                disabled={Boolean(attendance.activeCommand) || attendance.sessionPending}
                onClick={() => void attendance.submitSessionCommand(attendance.sessionAction!.command)}
              >
                {attendance.sessionAction.command === 'open'
                  ? <DoorOpen className="h-4 w-4" aria-hidden="true" />
                  : <DoorClosed className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </Tooltip>
          ) : null}
          {showAttendanceSelection ? (
            <TeacherWorkSurfaceMenuButton
              label={(
                <span className="inline-flex items-center gap-1.5">
                  <span className="hidden sm:inline">
                    {attendance.selectedCount > 0 ? `${attendance.selectedCount} selected` : 'Student actions'}
                  </span>
                  <span className="sm:hidden" aria-hidden="true">
                    {attendance.selectedCount > 0 ? attendance.selectedCount : <UserRoundCheck className="h-4 w-4" />}
                  </span>
                  <ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                </span>
              )}
              items={selectedStudentActions}
              variant="secondary"
              size="sm"
              disabled={attendance.selectedCount === 0 || attendance.selectedHasPendingStudent
                || Boolean(attendance.activeCommand) || !attendance.canMark}
              menuAriaLabel="Selected student attendance actions"
              menuAlign="center"
              buttonProps={{
                'aria-label': attendance.selectedCount > 0
                  ? `Student actions for ${attendance.selectedCount} selected`
                  : 'Student actions (select students to enable)',
              }}
            />
          ) : null}
        </div>
      )}
      actions={(
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="More actions"
          tooltip="More actions"
          variant="ghost"
          icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
          items={moreActions}
          menuAriaLabel="Daily more actions"
          menuAlign="end"
        />
      )}
    />
  )

  function renderStudentTable(showLogColumn: boolean) {
    const visibleColumnCount = 3
      + (showIdColumn ? 1 : 0)
      + (attendanceEnabled ? 2 : 0)
      + (showAttendanceSelection ? 1 : 0)

    return (
      <KeyboardNavigableTable
        ref={studentTableNavigationRef}
        ariaLabel="Attendance students"
        rowKeys={rowKeys}
        selectedKey={selectedStudentId}
        onSelectKey={handleKeyboardSelect}
        onDeselect={handleKeyboardDeselect}
        getRowId={getAttendanceStudentRowId}
      >
        <>
          {(refreshing || attendance.refreshing) && (
            <RefreshingIndicator />
          )}
          <DataTable className="table-fixed">
            <colgroup>
              {showAttendanceSelection ? <col className="w-10" /> : null}
              <col style={{ width: `${columnWidths.first}px` }} />
              <col style={{ width: `${columnWidths.last}px` }} />
              {showIdColumn ? (
                <col
                  className={attendanceEnabled ? 'hidden sm:table-column' : undefined}
                  style={{ width: `${columnWidths.id}px` }}
                />
              ) : null}
              {attendanceEnabled ? (
                <col
                  className="hidden md:table-column"
                  style={{ width: `${columnWidths.checkIn}px` }}
                />
              ) : null}
              <col />
              {attendanceEnabled ? <col className="w-40" /> : null}
            </colgroup>
            <DataTableHead sticky className="bg-surface-3">
              <DataTableRow>
                {showAttendanceSelection ? (
                  <TableSelectionHeaderCell
                    checked={attendance.allSelected}
                    indeterminate={attendance.someSelected}
                    onChange={attendance.toggleSelectAll}
                    ariaLabel="Select all students"
                    disabled={Boolean(attendance.activeCommand)
                      || attendance.pendingStudentIds.size > 0 || attendance.students.length === 0}
                  />
                ) : null}
                <SortableHeaderCell
                  label="First"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('first_name')}
                  density="tight"
                  buttonClassName="!pl-2 !pr-5"
                  resize={{
                    value: columnWidths.first,
                    min: COLUMN_LIMITS.first.min,
                    max: COLUMN_LIMITS.first.max,
                    onChange: (width) => setColumnWidth('first', width),
                  }}
                />
                <SortableHeaderCell
                  label="Last"
                  isActive={sortColumn === 'last_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('last_name')}
                  density="tight"
                  buttonClassName="!pl-2 !pr-5"
                  resize={{
                    value: columnWidths.last,
                    min: COLUMN_LIMITS.last.min,
                    max: COLUMN_LIMITS.last.max,
                    onChange: (width) => setColumnWidth('last', width),
                  }}
                />
                {showIdColumn ? (
                  <SortableHeaderCell
                    label="ID"
                    isActive={sortColumn === 'id'}
                    direction={sortDirection}
                    onClick={() => handleSort('id')}
                    density="tight"
                    buttonClassName="!pl-2 !pr-5"
                    className={attendanceEnabled ? 'hidden sm:table-cell' : undefined}
                    resize={{
                      value: columnWidths.id,
                      min: COLUMN_LIMITS.id.min,
                      max: COLUMN_LIMITS.id.max,
                      onChange: (width) => setColumnWidth('id', width),
                    }}
                  />
                ) : null}
                {attendanceEnabled ? (
                  <SortableHeaderCell
                    label="Check-in"
                    isActive={sortColumn === 'check_in'}
                    direction={sortDirection}
                    onClick={() => handleSort('check_in')}
                    density="tight"
                    buttonClassName="!pl-2 !pr-5"
                    className="hidden md:table-cell"
                    resize={{
                      value: columnWidths.checkIn,
                      min: COLUMN_LIMITS.checkIn.min,
                      max: COLUMN_LIMITS.checkIn.max,
                      onChange: (width) => setColumnWidth('checkIn', width),
                    }}
                  />
                ) : null}
                <SortableHeaderCell
                  label="Log"
                  isActive={sortColumn === 'log'}
                  direction={sortDirection}
                  onClick={() => handleSort('log')}
                  density="tight"
                  align={showLogColumn ? 'left' : 'center'}
                  className={showLogColumn ? 'min-w-0' : ''}
                  trailingPlacement="after-label"
                  trailing={isClassDay && rows.length > 0 ? (
                    <span
                      aria-label={`${completeCount} complete, ${incompleteCount} incomplete`}
                      className={attendanceEnabled
                        ? 'hidden shrink-0 items-center gap-1 sm:flex'
                        : 'flex shrink-0 items-center gap-1'}
                    >
                      <CountBadge
                        count={completeCount}
                        tooltip={`${completeCount} complete`}
                        variant="success"
                      />
                      <CountBadge
                        count={incompleteCount}
                        tooltip={`${incompleteCount} incomplete`}
                        variant="danger"
                      />
                    </span>
                  ) : undefined}
                />
                {attendanceEnabled ? (
                  <DataTableHeaderCell
                    density="tight"
                    className="!p-0"
                    aria-sort={sortColumn === 'attendance_status' ? 'other' : 'none'}
                  >
                    <div className="flex min-h-control items-center px-1">
                      <span
                        role="group"
                        aria-label="Sort attendance by status"
                        className="flex min-w-0 items-center"
                      >
                        {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                          <AttendanceStatusSortChip
                            key={status}
                            status={status}
                            count={attendanceStatusCounts[status]}
                            active={sortColumn === 'attendance_status' && sortStatus === status}
                            onClick={() => handleAttendanceStatusSort(status)}
                          />
                        ))}
                      </span>
                    </div>
                  </DataTableHeaderCell>
                ) : null}
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const isSelected = selectedStudentId === row.student_id
                const attendanceStudent = attendance.studentsById.get(row.student_id)
                const attendanceSelected = attendance.selectedIds.has(row.student_id)
                const attendancePending = attendance.pendingStudentIds.has(row.student_id)
                const attendanceEditable = Boolean(
                  attendanceStudent && attendance.canMark && !attendancePending && !attendance.activeCommand
                )
                const hasLog = Boolean(row.entry && entryHasContent(row.entry))
                const logText = hasLog ? row.entry?.text || '' : ''
                const completionLabel = hasLog ? 'Complete' : 'Incomplete'
                const studentName = [row.student_first_name, row.student_last_name]
                  .filter(Boolean)
                  .join(' ') || row.email_username
                const checkInTime = formatTeacherAttendanceTime(attendanceStudent?.checkedInAt ?? null)
                return (
                  <DataTableRow
                    key={row.student_id}
                    id={getAttendanceStudentRowId(row.student_id)}
                    aria-selected={isSelected || attendanceSelected}
                    tabIndex={-1}
                    className={[
                      'cursor-pointer transition-colors',
                      isSelected || attendanceSelected
                        ? 'bg-info-bg hover:bg-info-bg-hover'
                        : 'hover:bg-surface-hover',
                    ].join(' ')}
                    onClick={() => handleRowClick(row)}
                  >
                    {showAttendanceSelection ? (
                      <TableSelectionCell
                        checked={attendanceSelected}
                        onChange={() => attendance.toggleSelect(row.student_id)}
                        ariaLabel={`Select ${studentName}`}
                        disabled={!attendanceEditable}
                        className="!py-0"
                      />
                    ) : null}
                    <DataTableCell density="tight" className="min-w-0">
                      <span className="block truncate" title={row.student_first_name || undefined}>
                        {row.student_first_name || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell density="tight" className="min-w-0">
                      <span className="block truncate" title={row.student_last_name || undefined}>
                        {row.student_last_name || '—'}
                      </span>
                      {attendanceEnabled && checkInTime ? (
                        <span className="block whitespace-nowrap text-xs tabular-nums text-text-muted md:hidden">
                          {checkInTime}
                        </span>
                      ) : null}
                    </DataTableCell>
                    {showIdColumn ? (
                      <DataTableCell
                        density="tight"
                        className={attendanceEnabled ? 'hidden text-text-muted sm:table-cell' : 'text-text-muted'}
                      >
                        <span className="block truncate" title={row.email_username}>
                          {row.email_username}
                        </span>
                      </DataTableCell>
                    ) : null}
                    {attendanceEnabled ? (
                      <DataTableCell density="tight" className="hidden min-w-0 text-text-muted md:table-cell">
                        {checkInTime ? <span>{checkInTime}</span> : <span className="sr-only">No QR check-in</span>}
                      </DataTableCell>
                    ) : null}
                    <DataTableCell
                      density="tight"
                      align={showLogColumn ? 'left' : 'center'}
                      className={showLogColumn ? 'min-w-0 text-text-muted' : ''}
                    >
                      <div
                        className={[
                          'flex min-w-0 items-center gap-2',
                          showLogColumn && attendanceEnabled ? 'justify-center sm:justify-start' : '',
                          showLogColumn ? '' : 'justify-center',
                        ].join(' ')}
                      >
                        <Tooltip content={completionLabel}>
                          <span
                            aria-label={completionLabel}
                            className={[
                              'inline-block h-3 w-3 shrink-0 rounded-full',
                              hasLog ? 'bg-success-solid' : 'bg-danger-solid',
                            ].join(' ')}
                          />
                        </Tooltip>
                        {showLogColumn && (
                          hasLog ? (
                            <span
                              className={attendanceEnabled ? 'hidden truncate sm:block' : 'block truncate'}
                              title={logText}
                            >
                              {logText}
                            </span>
                          ) : (
                            <span
                              aria-label="No log for this date"
                              className={attendanceEnabled ? 'hidden sm:inline' : undefined}
                            >
                              —
                            </span>
                          )
                        )}
                      </div>
                    </DataTableCell>
                    {attendanceEnabled ? (
                      <DataTableCell density="tight" className="!py-0">
                        {attendanceStudent ? (
                          <div
                            className={cn(
                              'flex items-center gap-1',
                              attendanceStudent.hasManualOverride && attendanceStudent.hasQrCheckIn
                                && 'flex-col items-end gap-0',
                            )}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <AttendanceStatusControl
                              studentName={studentName}
                              status={attendanceStudent.status}
                              disabled={!attendanceEditable}
                              onChange={(status) => {
                                if (status !== attendanceStudent.status) {
                                  void attendance.submitMarks([row.student_id], status)
                                }
                              }}
                            />
                            {attendanceStudent.hasManualOverride && attendanceStudent.hasQrCheckIn ? (
                              <Tooltip content="Restore QR check-in">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="h-11 w-11 min-h-11 min-w-11 px-0 py-0"
                                  aria-label={`Undo manual attendance change for ${studentName}`}
                                  disabled={!attendanceEditable}
                                  onClick={() => void attendance.submitMarks(
                                    [row.student_id],
                                    'automatic',
                                    { successText: `${studentName}'s QR check-in restored` },
                                  )}
                                >
                                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </Tooltip>
                            ) : null}
                            {attendancePending ? <span className="sr-only">Updating attendance</span> : null}
                            {!attendancePending && attendanceStudent.commandFailed ? (
                              <span className="sr-only">Previous attendance update failed</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-text-muted" aria-label="Attendance unavailable for this student">—</span>
                        )}
                      </DataTableCell>
                    ) : null}
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
        </>
      </KeyboardNavigableTable>
    )
  }

  const detailPane = selectedRow ? (
    <StudentLogHistory
      studentId={selectedRow.student_id}
      classroomId={classroom.id}
      selectedDate={selectedDate}
      selectedEntry={selectedRow.entry}
      initialEntries={selectedRow.history_preview}
    />
  ) : (
    <div className="p-4 text-sm text-text-muted">
      Select a student to view log history.
    </div>
  )

  const workspaceContent = classDaysError && !hasClassDaysSnapshot ? (
    <PageState
      kind="error"
      title="Class schedule unavailable"
      description={classDaysError}
      compact
      action={(
        <Button type="button" onClick={() => void refreshClassDays()}>
          Try again
        </Button>
      )}
    />
  ) : loading ? (
    showBlockingSpinner ? (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    ) : (
      <div className="min-h-40" aria-hidden="true" />
    )
  ) : logsError ? (
    <PageState
      kind="error"
      title="Attendance unavailable"
      description={logsError}
      compact
      action={(
        <Button type="button" onClick={retryLogs}>
          Try again
        </Button>
      )}
    />
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
                  : 'flex h-5 shrink-0 cursor-ns-resize items-center justify-center text-text-muted outline-none transition-colors hover:bg-surface-hover focus:bg-info-bg focus:text-text-default'
              }
              onPointerDown={handleSummaryResizeStart}
              onKeyDown={handleSummaryResizeKeyDown}
            >
              <GripHorizontal className="h-4 w-4" aria-hidden="true" />
              {summaryPanelCollapsed ? <span>Log Summary</span> : null}
            </div>
            {!summaryPanelCollapsed && (
              <>
                <div className="flex items-center px-3 pt-3">
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

  const attendanceWarning = attendanceEnabled && (
    hours.error
    || scheduleDeliveryFailure === classroom.id
    || attendance.hasUnconfirmedView
    || attendance.error
    || attendance.view?.integration === 'disabled'
    || attendance.view?.integration === 'not_configured'
    || attendance.view?.session.commandFailed
    || attendance.failedStudentCount > 0
  ) ? (
    <div role="alert" className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
      {hours.error
        ? hours.policy
          ? 'The latest attendance hours could not be loaded. Showing the last saved hours; reopen attendance hours to retry.'
          : 'Attendance hours could not be loaded. Open attendance hours to retry. Daily logs remain available.'
        : scheduleDeliveryFailure === classroom.id
          ? 'Hours were saved, but the last save did not confirm schedule delivery. Reopen attendance hours and save to retry.'
          : attendance.hasUnconfirmedView
            ? 'Attendance sync is delayed. The selected day’s check-in status is not confirmed.'
            : attendance.error
              ? `${attendance.error}. Daily logs remain available.`
        : attendance.view?.integration === 'not_configured'
          ? 'Attendance hours are not configured. Daily logs remain available.'
          : attendance.view?.integration === 'disabled'
            ? 'Attendance is temporarily unavailable. Daily logs remain available.'
            : attendance.view?.session.commandFailed
              ? 'A previous attendance session update failed. Review the current state and try again.'
              : `${attendance.failedStudentCount} previous attendance ${attendance.failedStudentCount === 1 ? 'update' : 'updates'} failed.`}
    </div>
  ) : null

  const workspace = (
    classDaysError && hasClassDaysSnapshot
      ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-4 py-3">
              <p className="text-sm text-danger">The latest class schedule could not be loaded.</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => void refreshClassDays()}>
                Try again
              </Button>
            </div>
            {attendanceWarning}
            {workspaceContent}
          </div>
        )
      : attendanceWarning
        ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {attendanceWarning}
              {workspaceContent}
            </div>
          )
        : workspaceContent
  )

  const qrEntryUrl = attendance.qrPresentation && typeof window !== 'undefined'
    ? new URL(attendance.qrPresentation.entryPath, window.location.origin).toString()
    : null

  return (
    <>
      <TeacherWorkSurfaceShell
        state="workspace"
        primary={actionBar}
        summary={null}
        workspace={workspace}
        workspaceFrame="standalone"
        workspaceFrameClassName="min-h-[360px] rounded-none border-0 bg-page"
      />
      <ContentDialog
        isOpen={attendance.qrOpen}
        onClose={() => attendance.setQrOpen(false)}
        title="Attendance QR"
        subtitle={selectedDate ? format(parseISO(selectedDate), 'EEEE, MMMM d') : undefined}
        maxWidth="max-w-md"
      >
        {attendance.qrLoading ? (
          <PageState kind="loading" title="Loading QR code" compact />
        ) : attendance.qrError ? (
          <PageState
            kind="error"
            title="QR unavailable"
            description={attendance.qrError}
            compact
            action={<Button type="button" onClick={() => void attendance.loadQrPresentation()}>Try again</Button>}
          />
        ) : qrEntryUrl && attendance.qrPresentation ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <QrCode value={qrEntryUrl} label="Student attendance check-in QR code" />
            <div>
              <p className="font-medium text-text-default">Scan to check in through Pika</p>
              <p className="mt-1 text-sm text-text-muted">
                Available until {formatTeacherAttendanceTime(attendance.qrPresentation.expiresAt)}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void attendance.copyQrLink()}>
              <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copy link
            </Button>
          </div>
        ) : null}
      </ContentDialog>
      {attendanceEnabled ? (
        <AttendanceWindowDialog
          key={classroom.id}
          classroomId={classroom.id}
          isOpen={attendance.attendanceHoursOpen}
          onClose={() => {
            attendance.setAttendanceHoursOpen(false)
            void hours.refresh()
          }}
          onSaved={(policy, scheduleSynced) => {
            hours.acceptSaved(policy)
            setScheduleDeliveryFailure(scheduleSynced ? null : classroom.id)
            void attendance.loadView(true)
          }}
        />
      ) : null}
    </>
  )
})
