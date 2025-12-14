'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { DateNavigator } from '@/components/DateNavigator'
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

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900">Attendance</h2>
          <DateNavigator
            value={selectedDate}
            onChange={setSelectedDate}
            shortcutLabel="Yesterday"
            onShortcut={() => {
              const today = getTodayInToronto()
              const previousClassDay = getMostRecentClassDayBefore(classDays, today)
              setSelectedDate(previousClassDay || addDaysToDateString(today, -1))
            }}
          />
        </div>
        {!isClassDay && (
          <div className="mt-3 text-sm text-gray-600">
            No class on {selectedDate}.
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
        {rows.map((row) => (
          <div key={row.student_id} className="p-4 flex items-center justify-between">
            <div className="text-sm text-gray-800">{row.student_email}</div>
            <div className={`text-xl ${isClassDay ? '' : 'opacity-40'}`}>
              {isClassDay ? getAttendanceIcon(row.status) : '—'}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="p-6 text-center text-gray-500">No students enrolled</div>
        )}
      </div>
    </div>
  )
}
