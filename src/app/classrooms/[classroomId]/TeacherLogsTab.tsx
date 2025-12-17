'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { Spinner } from '@/components/Spinner'
import { StudentRow } from '@/components/StudentRow'
import { getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'
import type { ClassDay, Classroom, Entry } from '@/types'

interface LogRow {
  student_id: string
  student_email: string
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
  const dateInputRef = useRef<HTMLInputElement>(null)

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

  const formattedDate = selectedDate ? format(parseISO(selectedDate), 'EEE MMM d') : ''
  const navButtonClasses =
    'px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'

  const moveDateBy = (delta: number) => {
    if (!selectedDate) return
    setSelectedDate(addDaysToDateString(selectedDate, delta))
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
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={navButtonClasses}
              onClick={() => moveDateBy(-1)}
            >
              ←
            </button>

            <input
              ref={dateInputRef}
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="sr-only"
              tabIndex={-1}
            />

            <button
              type="button"
              className={navButtonClasses}
              onClick={() => dateInputRef.current?.showPicker()}
            >
              {formattedDate || 'Select date'}
            </button>

            <button
              type="button"
              className={navButtonClasses}
              onClick={() => moveDateBy(1)}
            >
              →
            </button>
          </div>

          {isClassDay && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                onClick={expandAll}
                disabled={studentsWithLogs.length === 0}
              >
                Expand all
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                onClick={collapseAll}
                disabled={expanded.size === 0}
              >
                Collapse all
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {(isClassDay ? logs : []).map((row) => {
          const hasEntry = Boolean(row.entry)
          const isExpanded = expanded.has(row.student_id)

          let preview = null
          let expandedContent = null

          if (!hasEntry) {
            preview = <span className="text-gray-400 dark:text-gray-500">(missing)</span>
          } else if (row.summary && !isExpanded) {
            preview = row.summary
          } else if (!isExpanded) {
            preview = (
              <div>
                <div className="truncate">{row.entry!.text}</div>
                {!row.summary && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Summary pending (generated nightly)
                  </div>
                )}
              </div>
            )
          }

          if (isExpanded && hasEntry) {
            expandedContent = (
              <div className="space-y-2">
                {row.summary && (
                  <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                    {row.summary}
                  </div>
                )}
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {row.entry!.text}
                </div>
              </div>
            )
          }

          return (
            <StudentRow.Expandable
              key={row.student_id}
              email={row.student_email}
              preview={preview}
              expanded={isExpanded}
              expandedContent={expandedContent}
              onToggle={hasEntry ? () => toggle(row.student_id) : undefined}
            />
          )
        })}

        {isClassDay && logs.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No students enrolled
          </div>
        )}
        {!isClassDay && (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No class on this day
          </div>
        )}
      </div>
    </div>
  )
}
