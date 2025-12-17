'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { getAttendanceIcon } from '@/lib/attendance'
import type { AttendanceRecord, ClassDay, Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

type SortColumn = 'first_name' | 'last_name' | 'email'

export function TeacherAttendanceTab({ classroom }: Props) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [sortColumn, setSortColumn] = useState<SortColumn>('last_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const dateInputRef = useRef<HTMLInputElement>(null)

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

        const attendanceRes = await fetch(`/api/teacher/attendance?classroom_id=${classroom.id}`)
        const attendanceData = await attendanceRes.json()
        setAttendance(attendanceData.attendance || [])
      } catch (err) {
        console.error('Error loading attendance tab:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

  const rows = useMemo(() => {
    const emailUsername = (email: string) => email.split('@')[0]

    const mappedRows = attendance.map((record) => {
      const status = record.dates[selectedDate]
      return {
        student_id: record.student_id,
        student_email: record.student_email,
        student_first_name: record.student_first_name,
        student_last_name: record.student_last_name,
        email_username: emailUsername(record.student_email),
        status: status || 'absent',
      }
    })

    return mappedRows.sort((a, b) => {
      let aVal = ''
      let bVal = ''

      if (sortColumn === 'email') {
        aVal = a.email_username
        bVal = b.email_username
      } else if (sortColumn === 'first_name') {
        aVal = a.student_first_name
        bVal = b.student_first_name
      } else {
        aVal = a.student_last_name
        bVal = b.student_last_name
      }

      const comparison = aVal.localeCompare(bVal)
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [attendance, selectedDate, sortColumn, sortDirection])

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const formattedDate = selectedDate ? format(parseISO(selectedDate), 'EEE MMM d') : ''
  const navButtonClasses =
    'px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'

  return (
    <div>
      {/* Date Navigation - left-justified */}
      <div className="mb-4">
        {!isClassDay && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            No class on {selectedDate}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={navButtonClasses}
            onClick={() => setSelectedDate(addDaysToDateString(selectedDate, -1))}
          >
            ←
          </button>

          {/* Hidden native date input */}
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="sr-only"
            tabIndex={-1}
          />

          {/* Visible formatted date button */}
          <button
            type="button"
            onClick={() => dateInputRef.current?.showPicker()}
            className={navButtonClasses}
          >
            {formattedDate}
          </button>

          <button
            type="button"
            className={navButtonClasses}
            onClick={() => setSelectedDate(addDaysToDateString(selectedDate, 1))}
          >
            →
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th
                className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => handleSort('first_name')}
              >
                <div className="flex items-center gap-1">
                  First Name
                  {sortColumn === 'first_name' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => handleSort('last_name')}
              >
                <div className="flex items-center gap-1">
                  Last Name
                  {sortColumn === 'last_name' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => handleSort('email')}
              >
                <div className="flex items-center gap-1">
                  Email
                  {sortColumn === 'email' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {rows.map((row) => (
              <tr key={row.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                  {row.student_first_name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                  {row.student_last_name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {row.email_username}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className={`text-xl ${isClassDay ? '' : 'opacity-40'}`}>
                    {isClassDay ? getAttendanceIcon(row.status) : '—'}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No students enrolled
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
