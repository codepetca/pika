'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { DateActionBar } from '@/components/DateActionBar'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { getAttendanceDotClass, getAttendanceLabel } from '@/lib/attendance'
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
import { applyDirection, compareNullableStrings, toggleSort } from '@/lib/table-sort'
import { useLeftSidebar, RightSidebarToggle } from '@/components/layout'
import type { ClassDay, Classroom, Entry } from '@/types'

type SortColumn = 'first_name' | 'last_name' | 'id'

interface LogRow {
  student_id: string
  student_email: string
  student_first_name: string
  student_last_name: string
  email_username: string
  entry: Entry | null
  summary: string | null
}

interface Props {
  classroom: Classroom
  onSelectEntry?: (entry: Entry | null, studentName: string) => void
}

export function TeacherAttendanceTab({ classroom, onSelectEntry }: Props) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })

  const { isExpanded: isLeftExpanded } = useLeftSidebar()

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const classDaysRes = await fetch(`/api/classrooms/${classroom.id}/class-days`)
        const classDaysData = await classDaysRes.json()
        const nextClassDays: ClassDay[] = classDaysData.class_days || []
        setClassDays(nextClassDays)

        const today = getTodayInToronto()
        const previousClassDay = getMostRecentClassDayBefore(nextClassDays, today)
        setSelectedDate(previousClassDay || addDaysToDateString(today, -1))
      } catch (err) {
        console.error('Error loading attendance tab:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  // Fetch logs when date changes
  useEffect(() => {
    async function loadLogs() {
      if (!selectedDate) return
      if (!isClassDayOnDate(classDays, selectedDate)) {
        setLogs([])
        setSelectedStudentId(null)
        onSelectEntry?.(null, '')
        return
      }

      setLoading(true)
      try {
        const res = await fetch(`/api/teacher/logs?classroom_id=${classroom.id}&date=${selectedDate}`)
        const data = await res.json()
        const rawLogs = data.logs || []
        const mappedLogs = rawLogs.map((log: any) => ({
          ...log,
          email_username: log.student_email.split('@')[0],
        }))
        setLogs(mappedLogs)

        // Auto-select first student
        if (mappedLogs.length > 0) {
          const firstLog = mappedLogs[0]
          setSelectedStudentId(firstLog.student_id)
          const studentName = [firstLog.student_first_name, firstLog.student_last_name].filter(Boolean).join(' ') || firstLog.email_username
          onSelectEntry?.(firstLog.entry, studentName)
        } else {
          setSelectedStudentId(null)
          onSelectEntry?.(null, '')
        }
      } catch (err) {
        console.error('Error loading logs:', err)
      } finally {
        setLoading(false)
      }
    }
    loadLogs()
  }, [classroom.id, classDays, selectedDate, onSelectEntry])

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

  const today = useMemo(() => getTodayInToronto(), [])

  const rows = useMemo(() => {
    return [...logs].sort((a, b) => {
      if (sortColumn === 'id') {
        return applyDirection(a.email_username.localeCompare(b.email_username), sortDirection)
      }
      const aValue = sortColumn === 'first_name' ? a.student_first_name : a.student_last_name
      const bValue = sortColumn === 'first_name' ? b.student_first_name : b.student_last_name
      const cmp = compareNullableStrings(aValue, bValue, { missingLast: true })
      if (cmp !== 0) return applyDirection(cmp, sortDirection)
      return applyDirection(a.email_username.localeCompare(b.email_username), sortDirection)
    })
  }, [logs, sortColumn, sortDirection])

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
      onSelectEntry?.(row.entry, studentName)
    } else {
      onSelectEntry?.(null, '')
    }
  }

  function getLogText(row: LogRow): string {
    if (row.summary) return row.summary
    if (row.entry?.text) return row.entry.text
    return '—'
  }

  // Keyboard navigation handler
  const handleKeyboardSelect = useCallback(
    (studentId: string) => {
      const row = rows.find((r) => r.student_id === studentId)
      if (!row) return

      setSelectedStudentId(studentId)
      const studentName =
        [row.student_first_name, row.student_last_name].filter(Boolean).join(' ') ||
        row.email_username
      onSelectEntry?.(row.entry, studentName)
    },
    [rows, onSelectEntry]
  )

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
        trailing={<RightSidebarToggle />}
      />

      <PageContent>
        <KeyboardNavigableTable
          rowKeys={rowKeys}
          selectedKey={selectedStudentId}
          onSelectKey={handleKeyboardSelect}
        >
          <TableCard>
            <DataTable>
            <DataTableHead>
              <DataTableRow>
                <SortableHeaderCell
                  label="First Name"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('first_name')}
                  density="tight"
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
                <DataTableHeaderCell density="tight" align="center">
                  Status
                </DataTableHeaderCell>
                <DataTableHeaderCell density="tight">
                  Log
                </DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const isSelected = selectedStudentId === row.student_id
                const status: AttendanceStatus = row.entry
                  ? 'present'
                  : selectedDate >= today
                    ? 'pending'
                    : 'absent'
                const logText = getLogText(row)

                return (
                  <DataTableRow
                    key={row.student_id}
                    className={[
                      'cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-info-bg hover:bg-info-bg'
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
                    <DataTableCell density="tight" className={isLeftExpanded ? 'max-w-xs' : 'max-w-md'}>
                      {logText !== '—' ? (
                        <Tooltip content={logText}>
                          <div className="truncate text-text-muted">
                            {logText}
                          </div>
                        </Tooltip>
                      ) : (
                        <div className="text-text-muted">—</div>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
              {rows.length === 0 && (
                <EmptyStateRow
                  colSpan={5}
                  message={isClassDay ? 'No students enrolled' : 'Not a class day'}
                  density="tight"
                />
              )}
            </DataTableBody>
            </DataTable>
          </TableCard>
        </KeyboardNavigableTable>
      </PageContent>
    </PageLayout>
  )
}
