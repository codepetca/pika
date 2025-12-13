'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { DateNavigator } from '@/components/DateNavigator'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import type { ClassDay, Classroom, Entry } from '@/types'

interface LogRow {
  student_id: string
  student_email: string
  entry: Entry | null
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

  useEffect(() => {
    async function loadBase() {
      setLoading(true)
      try {
        const classDaysRes = await fetch(`/api/teacher/class-days?classroom_id=${classroom.id}`)
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

  const isClassDay = useMemo(() => {
    if (!selectedDate) return true
    return isClassDayOnDate(classDays, selectedDate)
  }, [classDays, selectedDate])

  useEffect(() => {
    async function loadLogs() {
      if (!selectedDate) return
      if (!isClassDay) {
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
  }, [classroom.id, isClassDay, selectedDate])

  const studentsWithLogs = useMemo(
    () => logs.filter(l => Boolean(l.entry)).map(l => l.student_id),
    [logs]
  )

  function toggle(studentId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function expandAll() {
    setExpanded(new Set(studentsWithLogs))
  }

  function collapseAll() {
    setExpanded(new Set())
  }

  if (loading && logs.length === 0) {
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
          <h2 className="text-lg font-semibold text-gray-900">Logs</h2>
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

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-gray-600">
            {isClassDay ? `Showing ${selectedDate}` : `No class on ${selectedDate}`}
          </div>
          {isClassDay && (
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
                onClick={expandAll}
                disabled={studentsWithLogs.length === 0}
              >
                Expand all
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
                onClick={collapseAll}
                disabled={expanded.size === 0}
              >
                Collapse all
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
        {(isClassDay ? logs : []).map((row) => {
          const hasEntry = Boolean(row.entry)
          const isExpanded = expanded.has(row.student_id)
          return (
            <div key={row.student_id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {row.student_email}
                  </div>
                  {!hasEntry ? (
                    <div className="mt-1 text-sm text-gray-400">
                      (missing)
                    </div>
                  ) : isExpanded ? (
                    <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                      {row.entry!.text}
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-gray-600 truncate">
                      {row.entry!.text}
                    </div>
                  )}
                </div>
                {hasEntry && (
                  <button
                    type="button"
                    className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 flex-shrink-0"
                    onClick={() => toggle(row.student_id)}
                  >
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {isClassDay && logs.length === 0 && (
          <div className="p-6 text-center text-gray-500">No students enrolled</div>
        )}
        {!isClassDay && (
          <div className="p-6 text-center text-gray-500">No class on this day</div>
        )}
      </div>
    </div>
  )
}

