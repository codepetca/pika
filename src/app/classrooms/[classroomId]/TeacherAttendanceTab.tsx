'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { DateActionBar } from '@/components/DateActionBar'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { entryHasContent, getAttendanceDotClass, getAttendanceLabel } from '@/lib/attendance'
import { useClassDaysContext } from '@/hooks/useClassDays'
import { Tooltip } from '@/ui'
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
    setLoading(false)
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

  // Keyboard navigation handler
  const handleKeyboardSelect = useCallback(
    (studentId: string) => {
      const row = rows.find((r) => r.student_id === studentId)
      if (!row) return

      setSelectedStudentId(studentId)
      const studentName =
        [row.student_first_name, row.student_last_name].filter(Boolean).join(' ') ||
        row.email_username
      onSelectEntry?.(row.entry, studentName, row.student_id)
    },
    [rows, onSelectEntry]
  )

  useImperativeHandle(ref, () => ({
    selectStudentByName(name: string) {
      const row = logs.find((r) => {
        const fullName = [r.student_first_name, r.student_last_name].filter(Boolean).join(' ')
        return fullName === name
      })
      if (row) {
        setSelectedStudentId(row.student_id)
        const studentName = [row.student_first_name, row.student_last_name].filter(Boolean).join(' ') || row.email_username
        onSelectEntry?.(row.entry, studentName, row.student_id)
      }
    },
  }), [logs, onSelectEntry])

  // Row keys for keyboard navigation (in sorted order)
  const rowKeys = useMemo(() => rows.map((r) => r.student_id), [rows])

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <DateActionBar
            value={selectedDate}
            onChange={setSelectedDate}
            onPrev={() => moveDateBy(-1)}
            onNext={() => moveDateBy(1)}
          />
        }
        trailing={null}
      />

      <PageContent>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="min-h-[200px]" onClick={(e) => {
          // Deselect when clicking outside the table
          if (selectedStudentId && (e.target as HTMLElement).closest('table') === null) {
            handleDeselect()
          }
        }}>
        <KeyboardNavigableTable
          rowKeys={rowKeys}
          selectedKey={selectedStudentId}
          onSelectKey={handleKeyboardSelect}
          onDeselect={handleDeselect}
        >
          <TableCard>
            {refreshing && (
              <div className="px-3 py-2 text-xs text-text-muted">Refreshing…</div>
            )}
            <DataTable>
            <DataTableHead>
              <DataTableRow>
                <SortableHeaderCell
                  label="First Name"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('first_name')}
                  density="tight"
                  trailing={isClassDay && rows.length > 0 ? <StudentCountBadge count={rows.length} /> : undefined}
                />
                <SortableHeaderCell
                  label="Last Name"
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
      </PageContent>
    </PageLayout>
  )
})
