'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ClipboardCopy,
  Clock3,
  GripHorizontal,
  MoreVertical,
  QrCode as QrCodeIcon,
  RotateCcw,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { DateNavigator } from '@/components/DateNavigator'
import { StudentLogHistory } from '@/components/StudentLogHistory'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import {
  TeacherWorkSurfaceIconMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import { LogSummary } from './LogSummary'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString, getPastRelativeDateLabel } from '@/lib/date-string'
import { isClassDayOnDate } from '@/lib/class-days'
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
  FormField,
  IconButton,
  Input,
  KeyboardNavigableTable,
  PageState,
  QrCode,
  RefreshingIndicator,
  SortableHeaderCell,
  Tooltip,
  cn,
} from '@/ui'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { useScrollPositionMemory } from '@/hooks/useScrollPositionMemory'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
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
  AttendanceMarkButton,
  AttendanceStatusSortChip,
  SORTABLE_ATTENDANCE_STATUSES,
} from './TeacherAttendanceControls'
import {
  formatTeacherAttendanceTime,
  useTeacherAttendanceController,
  type TeacherAttendanceMark,
} from '@/hooks/useTeacherAttendanceController'
import { useTeacherManualAttendanceController } from '@/hooks/useTeacherManualAttendanceController'
import { deriveManualAttendanceStatus } from '@/lib/manual-attendance'

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
const STICKY_ATTENDANCE_OFFSETS: Record<TeacherAttendanceMark, string> = {
  present: 'right-attendance-three',
  late: 'right-attendance-two',
  absent: 'right-attendance-one',
}

function manualAttendanceTimeDate(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes)
}

function formatManualAttendanceRange(startsAt: string, endsAt: string) {
  const start = manualAttendanceTimeDate(startsAt)
  const end = manualAttendanceTimeDate(endsAt)
  return format(start, 'a') === format(end, 'a')
    ? `${format(start, 'h:mm')} - ${format(end, 'h:mm a')}`
    : `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`
}

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
  manualAttendanceEnabled?: boolean
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
  manualAttendanceEnabled = false,
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
  const [summaryReadyScopeKey, setSummaryReadyScopeKey] = useState<string | null>(null)
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false)
  const [isManualTimeDialogOpen, setIsManualTimeDialogOpen] = useState(false)
  const [manualDraftStartsAt, setManualDraftStartsAt] = useState('09:00')
  const [manualDraftEndsAt, setManualDraftEndsAt] = useState('10:00')
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
  const manualAttendance = useTeacherManualAttendanceController({
    classroomId: classroom.id,
    selectedDate,
    enabled: manualAttendanceEnabled,
    isActive,
    archived: Boolean(classroom.archived_at),
    visibleStudentIds,
  })
  const hours = useTeacherAttendancePolicy(classroom.id, attendanceEnabled && isActive && !classroom.archived_at)
  const [scheduleDeliveryFailure, setScheduleDeliveryFailure] = useState<string | null>(null)
  const hoursActionLabel = hours.label
    ? `Attendance hours, ${hours.label.replace(' - ', ' to ')}`
    : hours.state === 'error'
      ? 'Attendance hours unavailable'
      : hours.state === 'loading'
        ? 'Loading attendance hours'
        : 'Set attendance hours'
  const qrTimeLabel = hours.label ?? (classroom.archived_at ? attendance.windowLabel : null)
  const manualTimeLabel = manualAttendance.settings.sessionStartsLocal
    && manualAttendance.settings.sessionEndsLocal
    ? formatManualAttendanceRange(
      manualAttendance.settings.sessionStartsLocal,
      manualAttendance.settings.sessionEndsLocal,
    )
    : null
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

  // A fresh Daily view starts on Toronto today. Once initialized, explicit
  // teacher navigation remains selected for the lifetime of the mounted tab.
  useEffect(() => {
    if (classDaysLoading || (classDaysError && !hasClassDaysSnapshot)) return
    if (selectedDate) return // Already initialized
    setSelectedDate(today)
    // Do NOT setLoading(false) here — the logs fetch (Effect 3) handles it
  }, [classDaysError, classDaysLoading, hasClassDaysSnapshot, selectedDate, today])

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

  const attendanceRowsById = useMemo(() => new Map(logs.map((row) => {
    if (attendanceEnabled) {
      const student = attendance.studentsById.get(row.student_id)
      return [row.student_id, student ? {
        status: student.status,
        hasManualOverride: student.hasManualOverride,
        checkedInAt: student.checkedInAt,
        pending: attendance.pendingStudentIds.has(row.student_id),
      } : null] as const
    }
    if (!manualAttendanceEnabled) return [row.student_id, null] as const
    const override = manualAttendance.overridesByStudentId.get(row.student_id)
    return [row.student_id, {
      status: deriveManualAttendanceStatus({
        sourceMode: manualAttendance.settings.sourceMode,
        hasCompletedLog: Boolean(row.entry && entryHasContent(row.entry)),
        override,
      }),
      hasManualOverride: Boolean(override),
      checkedInAt: null,
      pending: manualAttendance.activeCommand === 'marks',
    }] as const
  })), [
    attendance.pendingStudentIds,
    attendance.studentsById,
    attendanceEnabled,
    logs,
    manualAttendance.activeCommand,
    manualAttendanceEnabled,
    manualAttendance.overridesByStudentId,
    manualAttendance.settings.sourceMode,
  ])

  const showAttendance = attendanceEnabled || manualAttendanceEnabled
  const canMarkAttendance = attendanceEnabled
    ? attendance.canMark
    : manualAttendanceEnabled && manualAttendance.canMark
  const attendanceCommandActive = attendanceEnabled
    ? Boolean(attendance.activeCommand)
    : Boolean(manualAttendance.activeCommand)

  const submitAttendanceMarks = useCallback((
    studentIds: string[],
    status: TeacherAttendanceMark | 'automatic',
    options?: { successText?: string },
  ) => {
    if (attendanceEnabled) {
      return attendance.submitMarks(studentIds, status, options)
    }
    if (manualAttendanceEnabled) return manualAttendance.submitMarks(studentIds, status, options)
  }, [attendance, attendanceEnabled, manualAttendance, manualAttendanceEnabled])

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
        const aStatus = attendanceRowsById.get(a.student_id)?.status
        const bStatus = attendanceRowsById.get(b.student_id)?.status
        const statusRank = Number(bStatus === sortStatus) - Number(aStatus === sortStatus)
        return statusRank || compareNames()
      }
      if (sortColumn === 'check_in') {
        const aCheckIn = attendanceRowsById.get(a.student_id)?.checkedInAt ?? null
        const bCheckIn = attendanceRowsById.get(b.student_id)?.checkedInAt ?? null
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
  }, [attendanceRowsById, logs, sortColumn, sortDirection, sortStatus])

  const attendanceStatusCounts = useMemo(() => {
    const counts: Record<TeacherAttendanceMark, number> = { present: 0, late: 0, absent: 0 }
    for (const row of logs) {
      const status = attendanceRowsById.get(row.student_id)?.status
      if (status && status !== 'unmarked') counts[status] += 1
    }
    return counts
  }, [attendanceRowsById, logs])

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
  const summaryScopeKey = `${classroom.id}:${selectedDate}`
  const summaryPanelVisible = Boolean(selectedDate && summaryReadyScopeKey === summaryScopeKey)

  useLayoutEffect(() => {
    setSummaryReadyScopeKey(null)
  }, [summaryScopeKey])

  const handleSummaryAvailabilityChange = useCallback((available: boolean) => {
    setSummaryReadyScopeKey((currentScopeKey) => {
      if (available) return summaryScopeKey
      return currentScopeKey === summaryScopeKey ? null : currentScopeKey
    })
  }, [summaryScopeKey])

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

  const openTimeEditor = () => {
    if (attendanceEnabled) {
      attendance.setAttendanceHoursOpen(true)
      return
    }
    setManualDraftStartsAt(manualAttendance.settings.sessionStartsLocal ?? '09:00')
    setManualDraftEndsAt(manualAttendance.settings.sessionEndsLocal ?? '10:00')
    setIsManualTimeDialogOpen(true)
  }

  const moreActions: TeacherWorkSurfaceActionItem[] = [
    ...(attendanceEnabled && attendance.attendanceReady && attendance.sessionAction ? [{
      id: `${attendance.sessionAction.command}-attendance`,
      label: attendance.sessionAction.command === 'open' ? 'Open attendance' : 'Close attendance',
      description: attendance.sessionAction.command === 'open'
        ? 'Allow QR check-ins for this date'
        : 'Stop accepting QR check-ins',
      checked: attendance.sessionState === 'open',
      checkedRole: 'menuitemcheckbox' as const,
      disabled: Boolean(attendance.activeCommand) || attendance.sessionPending,
      onSelect: () => void attendance.submitSessionCommand(attendance.sessionAction!.command),
    }] : []),
    ...(showAttendance ? [{
      id: 'edit-attendance-time',
      label: 'Edit time',
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      disabled: attendanceCommandActive || Boolean(classroom.archived_at),
      onSelect: openTimeEditor,
    }] : []),
    ...(manualAttendanceEnabled ? [
      {
        id: 'attendance-from-log',
        label: 'Attendance from log',
        description: 'A completed log marks the student Present',
        checked: manualAttendance.settings.sourceMode === 'log',
        checkedRole: 'menuitemcheckbox' as const,
        dividerBefore: true,
        disabled: attendanceCommandActive || Boolean(classroom.archived_at),
        onSelect: () => void manualAttendance.saveSettings({
          sourceMode: manualAttendance.settings.sourceMode === 'log' ? 'manual' : 'log',
        }),
      },
    ] : []),
    ...(showAttendance ? [{
      id: 'edit-attendance',
      label: 'Edit attendance',
      dividerBefore: true,
      disabled: !canMarkAttendance || attendanceCommandActive,
      onSelect: () => setIsBatchDialogOpen(true),
    }] : []),
    {
      id: 'toggle-id-column',
      label: showIdColumn ? 'Hide ID column' : 'Show ID column',
      dividerBefore: true,
      onSelect: () => setShowIdColumn((visible) => !visible),
    },
    {
      id: 'toggle-relative-date',
      label: showRelativeDate ? 'Hide relative date' : 'Show relative date',
      onSelect: () => setShowRelativeDate((visible) => !visible),
    },
  ]
  const qrAvailable = attendanceEnabled
    && attendance.attendanceReady
    && attendance.sessionState === 'open'
    && !attendance.hasUnconfirmedView
    && !attendance.sessionPending
    && !attendance.activeCommand

  const actionBar = (
    <TeacherWorkSurfaceContextBar
      ariaLabel="Daily controls"
      testId="daily-context-bar"
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
          {showAttendance ? (
            <div
              role="group"
              aria-label={attendanceEnabled ? 'Attendance time and QR check-in' : 'Attendance time'}
              className="inline-flex shrink-0 overflow-hidden rounded-control border border-border-strong bg-surface"
            >
            {attendanceEnabled ? (
              <IconButton
                label="Show QR"
                tooltip={qrAvailable ? 'Show QR' : 'QR unavailable until attendance is open'}
                icon={QrCodeIcon}
                variant="primary"
                size="sm"
                className="h-11 w-11 rounded-none border-0"
                disabled={!qrAvailable}
                onClick={attendance.openQrPresentation}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={attendanceEnabled
                ? classroom.archived_at && qrTimeLabel
                  ? `Attendance hours, ${qrTimeLabel.replace(' - ', ' to ')}`
                  : hoursActionLabel
                : `${manualTimeLabel ? 'Edit' : 'Set'} attendance time, manual attendance${manualTimeLabel ? `, ${manualTimeLabel}` : ''}`}
              disabled={attendanceCommandActive || Boolean(classroom.archived_at)}
              onClick={openTimeEditor}
              className={cn(
                'min-h-control rounded-none border-0 px-2 text-xs font-medium sm:px-3 sm:text-sm',
                attendanceEnabled && 'border-l border-border-strong',
                attendanceEnabled && qrAvailable
                  ? 'bg-success-bg text-success hover:bg-success-bg-muted'
                  : 'bg-surface text-text-muted',
              )}
            >
              <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {attendanceEnabled ? qrTimeLabel : manualTimeLabel}
            </Button>
            </div>
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
      + (attendanceEnabled ? 1 : 0)
      + (showAttendance ? 4 : 0)

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
          {(refreshing || attendance.refreshing || manualAttendance.refreshing) && (
            <RefreshingIndicator />
          )}
          <DataTable className="table-fixed">
            <colgroup>
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
              {showAttendance ? (
                <>
                  <col className="w-11" />
                  <col className="w-11" />
                  <col className="w-11" />
                  <col className="w-11" />
                </>
              ) : null}
            </colgroup>
            <DataTableHead sticky className="bg-surface-3">
              <DataTableRow>
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
                    label="Time of scan"
                    visualLabel={<Clock3 className="h-4 w-4" aria-hidden="true" />}
                    tooltipContent="Time of scan"
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
                />
                {showAttendance ? SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                  <DataTableHeaderCell
                    key={status}
                    density="tight"
                    className={cn(
                      'sticky z-sticky-table !p-0 bg-surface-3 text-center',
                      STICKY_ATTENDANCE_OFFSETS[status],
                    )}
                    aria-sort={sortColumn === 'attendance_status' && sortStatus === status ? 'other' : 'none'}
                  >
                    <span className="sr-only">{status}</span>
                    <AttendanceStatusSortChip
                      status={status}
                      count={attendanceStatusCounts[status]}
                      active={sortColumn === 'attendance_status' && sortStatus === status}
                      tooltipContent={`${attendanceStatusCounts[status]} ${status === 'absent' ? 'Absent' : status[0].toUpperCase() + status.slice(1)}`}
                      showSortIndicator
                      onClick={() => handleAttendanceStatusSort(status)}
                    />
                  </DataTableHeaderCell>
                )) : null}
                {showAttendance ? (
                  <DataTableHeaderCell
                    density="tight"
                    className="sticky right-0 z-sticky-table !p-0 bg-surface-3"
                  >
                    <span className="sr-only">Undo manual change</span>
                  </DataTableHeaderCell>
                ) : null}
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const isSelected = selectedStudentId === row.student_id
                const attendanceStudent = attendanceRowsById.get(row.student_id)
                const attendancePending = attendanceStudent?.pending ?? false
                const attendanceEditable = Boolean(
                  attendanceStudent && canMarkAttendance && !attendancePending && !attendanceCommandActive
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
                    aria-selected={isSelected}
                    tabIndex={-1}
                    className={[
                      'group cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-info-bg hover:bg-info-bg-hover'
                        : 'hover:bg-surface-hover',
                    ].join(' ')}
                    onClick={() => handleRowClick(row)}
                  >
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
                      {showLogColumn && hasLog ? (
                        <span className="block truncate" title={logText}>{logText}</span>
                      ) : (
                        <span aria-label={hasLog ? completionLabel : 'No log for this date'}>—</span>
                      )}
                    </DataTableCell>
                    {showAttendance ? SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                      <DataTableCell
                        key={status}
                        density="tight"
                        className={cn(
                          'sticky z-sticky-table !p-0 bg-surface text-center group-hover:bg-surface-hover',
                          isSelected && 'bg-info-bg group-hover:bg-info-bg-hover',
                          STICKY_ATTENDANCE_OFFSETS[status],
                        )}
                      >
                        {attendanceStudent ? (
                          <span onClick={(event) => event.stopPropagation()}>
                            <AttendanceMarkButton
                              studentName={studentName}
                              status={status}
                              active={attendanceStudent.status === status}
                              disabled={!attendanceEditable}
                              onClick={() => {
                                if (attendanceStudent.status !== status) {
                                  void submitAttendanceMarks([row.student_id], status)
                                }
                              }}
                            />
                          </span>
                        ) : null}
                      </DataTableCell>
                    )) : null}
                    {showAttendance ? (
                    <DataTableCell
                      density="tight"
                      className={cn(
                        'sticky right-0 z-sticky-table !p-0 bg-surface text-center group-hover:bg-surface-hover',
                        isSelected && 'bg-info-bg group-hover:bg-info-bg-hover',
                      )}
                    >
                      {attendanceStudent?.hasManualOverride ? (
                        <span onClick={(event) => event.stopPropagation()}>
                          <IconButton
                            label={`Undo manual change for ${studentName}`}
                            tooltip="Undo manual change"
                            icon={RotateCcw}
                            variant="ghost"
                            size="xs"
                            className="h-11 w-11"
                            disabled={!attendanceEditable}
                            onClick={() => void submitAttendanceMarks(
                              [row.student_id],
                              'automatic',
                              { successText: attendanceEnabled
                                ? `${studentName}'s automatic attendance restored`
                                : `${studentName}'s manual change undone` },
                            )}
                          />
                        </span>
                      ) : null}
                      {attendancePending ? <span className="sr-only">Updating attendance</span> : null}
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
            hidden={!summaryPanelVisible}
            className={cn(
              summaryPanelCollapsed
                ? 'flex h-10 min-h-10 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface'
                : 'flex min-h-[140px] shrink-0 flex-col overflow-hidden rounded-lg bg-surface',
              !summaryPanelVisible && '!hidden',
            )}
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
              <div className="flex items-center px-3 pt-3">
                <h3 className="truncate text-sm font-semibold text-text-default">
                  Class Log Summary
                </h3>
              </div>
            )}
            <div hidden={summaryPanelCollapsed} className="min-h-0 flex-1 overflow-y-auto">
              <LogSummary
                key={summaryScopeKey}
                classroomId={classroom.id}
                date={selectedDate}
                onStudentClick={selectStudentByName}
                onAvailabilityChange={handleSummaryAvailabilityChange}
              />
            </div>
          </section>
        )}
      </div>
    )
  )

  const attendanceWarning = (manualAttendanceEnabled && manualAttendance.error) ? (
    <div role="alert" className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
      {manualAttendance.error}. Daily logs remain available.
    </div>
  ) : attendanceEnabled && (
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
      <ContentDialog
        isOpen={isBatchDialogOpen}
        onClose={() => setIsBatchDialogOpen(false)}
        title="Edit attendance"
        subtitle={selectedDate ? format(parseISO(selectedDate), 'EEEE, MMMM d') : undefined}
        maxWidth="max-w-md"
        showFooterClose={false}
      >
        <div className="space-y-2">
          {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
            <Button
              key={status}
              type="button"
              variant="secondary"
              className="w-full justify-start"
              disabled={attendanceCommandActive || visibleStudentIds.length === 0}
              onClick={() => {
                setIsBatchDialogOpen(false)
                void submitAttendanceMarks(visibleStudentIds, status)
              }}
            >
              Mark all {status}
            </Button>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start"
            disabled={attendanceCommandActive || visibleStudentIds.length === 0}
            onClick={() => {
              setIsBatchDialogOpen(false)
              void submitAttendanceMarks(visibleStudentIds, 'automatic')
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Revert manual changes
          </Button>
          {attendanceEnabled ? (
            <Button
              type="button"
              variant="danger"
              className="w-full justify-start"
              disabled={attendanceCommandActive || visibleStudentIds.length === 0}
              onClick={() => {
                setIsBatchDialogOpen(false)
                void attendance.resetCheckIns(visibleStudentIds)
              }}
            >
              <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
              Clear QR check-ins
            </Button>
          ) : null}
        </div>
      </ContentDialog>
      <ContentDialog
        isOpen={isManualTimeDialogOpen}
        onClose={() => setIsManualTimeDialogOpen(false)}
        title="Attendance time"
        subtitle={selectedDate ? format(parseISO(selectedDate), 'EEEE, MMMM d') : undefined}
        maxWidth="max-w-sm"
        showFooterClose={false}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void manualAttendance.saveSettings({
              sessionStartsLocal: manualDraftStartsAt,
              sessionEndsLocal: manualDraftEndsAt,
            }).then((saved) => { if (saved) setIsManualTimeDialogOpen(false) })
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts">
              <Input
                type="time"
                value={manualDraftStartsAt}
                disabled={manualAttendance.activeCommand === 'settings'}
                onChange={(event) => setManualDraftStartsAt(event.target.value)}
              />
            </FormField>
            <FormField label="Ends">
              <Input
                type="time"
                value={manualDraftEndsAt}
                disabled={manualAttendance.activeCommand === 'settings'}
                onChange={(event) => setManualDraftEndsAt(event.target.value)}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={manualAttendance.activeCommand === 'settings'}
              onClick={() => {
                void manualAttendance.saveSettings({
                  sessionStartsLocal: null,
                  sessionEndsLocal: null,
                }).then((saved) => { if (saved) setIsManualTimeDialogOpen(false) })
              }}
            >
              Clear time
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={manualAttendance.activeCommand === 'settings'}
              onClick={() => setIsManualTimeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={manualAttendance.activeCommand === 'settings'}
              disabled={!manualDraftStartsAt || !manualDraftEndsAt}
            >
              Save time
            </Button>
          </div>
        </form>
      </ContentDialog>
    </>
  )
})
