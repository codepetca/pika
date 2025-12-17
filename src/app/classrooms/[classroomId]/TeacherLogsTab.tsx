'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { DateActionBar } from '@/components/DateActionBar'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import type { ClassDay, Classroom, Entry } from '@/types'
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline'

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
  const [sortColumn, setSortColumn] = useState<SortColumn>('student_last_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

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
      const aVal = a[sortColumn] ?? ''
      const bVal = b[sortColumn] ?? ''
      const comparison = aVal.localeCompare(bVal)
      return sortDirection === 'asc' ? comparison : -comparison
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

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return null
    return sortDirection === 'asc' ? '↑' : '↓'
  }

  return (
    <div>
      <div className="mb-4">
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

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th
                className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 dark:text-gray-400 cursor-pointer"
                onClick={() => toggleSort('student_first_name')}
              >
                First Name {getSortIndicator('student_first_name')}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 dark:text-gray-400 cursor-pointer"
                onClick={() => toggleSort('student_last_name')}
              >
                Last Name {getSortIndicator('student_last_name')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 dark:text-gray-400">
                Log Summary
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {isClassDay ? (
              sortedRows.map(row => {
                const summaryText = row.summary ?? row.entry?.text ?? ''
                return (
                  <Fragment key={row.student_id}>
                    <tr
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => toggle(row.student_id)}
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        {row.student_first_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        {row.student_last_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        <div className="truncate" title={summaryText}>
                          {summaryText}
                        </div>
                      </td>
                    </tr>
                    {expanded.has(row.student_id) && row.entry && (
                      <tr className="bg-gray-50 dark:bg-gray-900">
                        <td colSpan={3} className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {row.entry.text}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            ) : (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  No class on this day
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
