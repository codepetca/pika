'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { StudentRow } from '@/components/StudentRow'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { getAttendanceIcon } from '@/lib/attendance'
import type { AttendanceRecord, ClassDay, Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherAttendanceTab({ classroom }: Props) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>('')
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
    return attendance.map((record) => {
      const status = record.dates[selectedDate]
      return {
        student_id: record.student_id,
        student_email: record.student_email,
        status: status || 'absent',
      }
    })
  }, [attendance, selectedDate])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const formattedDate = selectedDate ? format(parseISO(selectedDate), 'EEE MMM d') : ''

  return (
    <div>
      {/* Date Title - clickable to open date picker */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => dateInputRef.current?.showPicker()}
          className="text-lg font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
        >
          {formattedDate}
        </button>
        {!isClassDay && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            No class on {selectedDate}
          </p>
        )}
      </div>

      {/* Date Navigation - left-justified */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => setSelectedDate(addDaysToDateString(selectedDate, -1))}
          >
            ←
          </button>

          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
          />

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => setSelectedDate(addDaysToDateString(selectedDate, 1))}
          >
            →
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => {
              const today = getTodayInToronto()
              const previousClassDay = getMostRecentClassDayBefore(classDays, today)
              setSelectedDate(previousClassDay || addDaysToDateString(today, -1))
            }}
          >
            Yesterday
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {rows.map((row) => (
          <StudentRow.Minimal
            key={row.student_id}
            email={row.student_email}
            indicator={
              <div className={`text-xl ${isClassDay ? '' : 'opacity-40'}`}>
                {isClassDay ? getAttendanceIcon(row.status) : '—'}
              </div>
            }
          />
        ))}
        {rows.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No students enrolled
          </div>
        )}
      </div>
    </div>
  )
}
