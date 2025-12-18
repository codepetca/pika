'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { StudentRow } from '@/components/StudentRow'
import { DateActionBar } from '@/components/DateActionBar'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import { getAttendanceIcon } from '@/lib/attendance'
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
import { applyDirection, compareNullableStrings, toggleSort } from '@/lib/table-sort'
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
  const [{ column: sortColumn, direction: sortDirection }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
  }>({ column: 'last_name', direction: 'asc' })

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
      if (sortColumn === 'email') {
        return applyDirection(a.email_username.localeCompare(b.email_username), sortDirection)
      }
      const aValue = sortColumn === 'first_name' ? a.student_first_name : a.student_last_name
      const bValue = sortColumn === 'first_name' ? b.student_first_name : b.student_last_name
      const cmp = compareNullableStrings(aValue, bValue, { missingLast: true })
      if (cmp !== 0) return applyDirection(cmp, sortDirection)
      return applyDirection(a.email_username.localeCompare(b.email_username), sortDirection)
    })
  }, [attendance, selectedDate, sortColumn, sortDirection])

  function handleSort(column: SortColumn) {
    setSortState((prev) => toggleSort(prev, column))
  }

  function moveDateBy(deltaDays: number) {
    setSelectedDate(prev => {
      const base = prev || getTodayInToronto()
      return addDaysToDateString(base, deltaDays)
    })
  }

  if (loading) {
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
      />

      <PageContent>
        <TableCard>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <SortableHeaderCell
                  label="First Name"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('first_name')}
                  density="compact"
                />
                <SortableHeaderCell
                  label="Last Name"
                  isActive={sortColumn === 'last_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('last_name')}
                  density="compact"
                />
                <SortableHeaderCell
                  label="Email"
                  isActive={sortColumn === 'email'}
                  direction={sortDirection}
                  onClick={() => handleSort('email')}
                  density="compact"
                />
                <DataTableHeaderCell density="compact" align="center">
                  Status
                </DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <DataTableCell density="compact">{row.student_first_name}</DataTableCell>
                  <DataTableCell density="compact">{row.student_last_name}</DataTableCell>
                  <DataTableCell density="compact" className="text-gray-600 dark:text-gray-400">
                    {row.email_username}
                  </DataTableCell>
                  <DataTableCell density="compact" align="center">
                    <div className={`text-xl ${isClassDay ? '' : 'opacity-40'}`}>
                      {isClassDay ? getAttendanceIcon(row.status) : '—'}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
              {rows.length === 0 && (
                <EmptyStateRow colSpan={4} message="No students enrolled" density="compact" />
              )}
            </DataTableBody>
          </DataTable>
        </TableCard>
      </PageContent>
    </PageLayout>
  )
}
