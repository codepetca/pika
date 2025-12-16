'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { PageHeader } from '@/components/PageHeader'
import { StudentRow } from '@/components/StudentRow'
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
    <div>
      <PageHeader
        title="Attendance"
        subtitle={!isClassDay ? `No class on ${selectedDate}` : undefined}
        action={
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
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
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
          <div className="py-8 text-center text-sm text-gray-500">
            No students enrolled
          </div>
        )}
      </div>
    </div>
  )
}
