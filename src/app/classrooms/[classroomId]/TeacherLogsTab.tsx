'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { DateActionBar } from '@/components/DateActionBar'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import type { ClassDay, Classroom, Entry } from '@/types'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import { applyDirection, compareNullableStrings, toggleSort as toggleSortState } from '@/lib/table-sort'

type SortColumn = 'student_first_name' | 'student_last_name'

interface LogRow {
  student_id: string
  student_email: string
  student_first_name: string
  student_last_name: string
  entry: Entry | null
  summary: string | null
}

interface Props {
  classroom: Classroom
}

export function TeacherLogsTab({ classroom }: Props) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'student_last_name', direction: 'asc' })

  useEffect(() => {
    async function loadBase() {
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
        console.error('Error loading logs base:', err)
      } finally {
        setLoading(false)
      }
    }
    loadBase()
  }, [classroom.id])

  useEffect(() => {
    async function loadLogs() {
      if (!selectedDate) return
      if (!isClassDayOnDate(classDays, selectedDate)) {
        setLogs([])
        setExpanded(new Set())
        return
      }

      setLoading(true)
      try {
        const res = await fetch(`/api/teacher/logs?classroom_id=${classroom.id}&date=${selectedDate}`)
        const data = await res.json()
        setLogs(data.logs || [])
        setExpanded(new Set())
      } catch (err) {
        console.error('Error loading logs:', err)
      } finally {
        setLoading(false)
      }
    }
    loadLogs()
  }, [classroom.id, classDays, selectedDate])

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

  const sortedRows = useMemo(() => {
    return [...logs].sort((a, b) => {
      const aVal = sortColumn === 'student_first_name' ? a.student_first_name : a.student_last_name
      const bVal = sortColumn === 'student_first_name' ? b.student_first_name : b.student_last_name
      const cmp = compareNullableStrings(aVal, bVal, { missingLast: true })
      if (cmp !== 0) return applyDirection(cmp, sortDirection)
      return applyDirection(a.student_email.localeCompare(b.student_email), sortDirection)
    })
  }, [logs, sortColumn, sortDirection])

  const toggle = (studentId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  const expandAll = () => {
    setExpanded(new Set(logs.map(row => row.student_id)))
  }

  const collapseAll = () => {
    setExpanded(new Set())
  }

  const moveDateBy = (delta: number) => {
    if (!selectedDate) return
    setSelectedDate(addDaysToDateString(selectedDate, delta))
  }

  const onSort = (column: SortColumn) => {
    setSortState((prev) => toggleSortState(prev, column))
  }

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div>
      <div className="pb-3">
        <DateActionBar
          value={selectedDate}
          onChange={setSelectedDate}
          onPrev={() => moveDateBy(-1)}
          onNext={() => moveDateBy(1)}
          rightActions={
            isClassDay ? (
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => (expanded.size === logs.length ? collapseAll() : expandAll())}
                disabled={logs.length === 0}
              >
                {expanded.size === logs.length ? 'Collapse' : 'Expand'}
              </button>
            ) : null
          }
        />
      </div>

      <TableCard overflowX>
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <SortableHeaderCell
                label="First Name"
                isActive={sortColumn === 'student_first_name'}
                direction={sortDirection}
                onClick={() => onSort('student_first_name')}
              />
              <SortableHeaderCell
                label="Last Name"
                isActive={sortColumn === 'student_last_name'}
                direction={sortDirection}
                onClick={() => onSort('student_last_name')}
              />
              <DataTableHeaderCell>Log Summary</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {isClassDay &&
              sortedRows.map(row => {
                const summaryText = row.summary ?? row.entry?.text ?? ''
                const isExpanded = expanded.has(row.student_id)
                return (
                  <Fragment key={row.student_id}>
                    <DataTableRow
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => toggle(row.student_id)}
                    >
                      <DataTableCell>{row.student_first_name || '—'}</DataTableCell>
                      <DataTableCell>{row.student_last_name || '—'}</DataTableCell>
                      <DataTableCell className="text-gray-700 dark:text-gray-300">
                        <div className="truncate" title={summaryText}>
                          {summaryText}
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                    {isExpanded && row.entry && (
                      <DataTableRow className="bg-white dark:bg-gray-900">
                        <DataTableCell colSpan={3} className="text-gray-900 dark:text-gray-100">
                          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {row.entry.text}
                          </p>
                        </DataTableCell>
                      </DataTableRow>
                    )}
                  </Fragment>
                )
              })}
            {isClassDay && sortedRows.length === 0 && (
              <EmptyStateRow colSpan={3} message="No logs for this day" />
            )}
            {!isClassDay && <EmptyStateRow colSpan={3} message="Not a class day" />}
          </DataTableBody>
        </DataTable>
      </TableCard>
    </div>
  )
}
