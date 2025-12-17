'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { PageHeader } from '@/components/PageHeader'
import type { ClassDay, Classroom } from '@/types'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, parseISO } from 'date-fns'
import { getTodayInToronto } from '@/lib/timezone'

interface Props {
  classroom: Classroom
}

export function TeacherCalendarTab({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/classrooms/${classroom.id}/class-days`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load class days')
      }
      setClassDays(data.class_days || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load class days')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom.id])

  const isInitialized = classDays.length > 0

  const range = useMemo(() => {
    if (classroom.start_date && classroom.end_date) {
      return { start: parseISO(classroom.start_date), end: parseISO(classroom.end_date) }
    }
    if (classDays.length === 0) return null
    const dates = classDays.map(d => parseISO(d.date))
    return {
      start: new Date(Math.min(...dates.map(d => d.getTime()))),
      end: new Date(Math.max(...dates.map(d => d.getTime()))),
    }
  }, [classDays, classroom.end_date, classroom.start_date])

  const months = useMemo(() => {
    if (!range) return []
    const list: Date[] = []
    let current = startOfMonth(range.start)
    const end = startOfMonth(range.end)
    while (current <= end) {
      list.push(current)
      current = addMonths(current, 1)
    }
    return list
  }, [range])

  const classDayMap = useMemo(() => {
    const map = new Map<string, ClassDay>()
    for (const day of classDays) map.set(day.date, day)
    return map
  }, [classDays])

  async function generateFromRange() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/classrooms/${classroom.id}/class-days`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate class days')
      }
      setSuccess(`Generated ${data.count ?? 0} class days.`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Failed to generate class days')
    } finally {
      setSaving(false)
    }
  }

  async function toggleDay(date: string, isClassDay: boolean) {
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/classrooms/${classroom.id}/class-days`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          is_class_day: isClassDay,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update day')
      }
      setClassDays(prev => {
        const existingIndex = prev.findIndex(d => d.date === date)
        if (existingIndex === -1) return [...prev, data.class_day]
        const next = [...prev]
        next[existingIndex] = data.class_day
        return next
      })
    } catch (err: any) {
      setError(err.message || 'Failed to update day')
    }
  }

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
        title="Calendar"
        subtitle="Define which dates are class days. Students can only log on class days. Past dates are locked."
        action={
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
            onClick={load}
          >
            Refresh
          </button>
        }
      />

      {!isInitialized && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3 mb-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
                disabled={saving}
              />
            </div>
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50"
              onClick={generateFromRange}
              disabled={saving || !startDate || !endDate}
            >
              {saving ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {(error || success) && (
        <div className="space-y-2 mb-4">
          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          {success && <div className="text-sm text-green-700 dark:text-green-400">{success}</div>}
        </div>
      )}

      {range ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {months.map(month => {
              const monthStart = startOfMonth(month)
              const monthEnd = endOfMonth(month)
              const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

              const todayToronto = getTodayInToronto()
              const rangeStartStr = format(range.start, 'yyyy-MM-dd')
              const rangeEndStr = format(range.end, 'yyyy-MM-dd')

              return (
                <div key={month.toString()} className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                  <h3 className="text-center font-bold text-gray-900 dark:text-gray-100 mb-3">
                    {format(month, 'MMMM yyyy')}
                  </h3>

                  <div className="grid grid-cols-7 gap-1">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                      <div key={i} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
                        {day}
                      </div>
                    ))}

                    {Array.from({ length: monthStart.getDay() }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}

                    {days.map(day => {
                      const dateString = format(day, 'yyyy-MM-dd')
                      const classDay = classDayMap.get(dateString)
                      const isClassDay = classDay?.is_class_day || false
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6
                      const isBeforeToday = dateString < todayToronto
                      const isInRange = dateString >= rangeStartStr && dateString <= rangeEndStr
                      const disabled = !isInRange || isBeforeToday

                      const colorClasses = disabled
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                        : isClassDay
                          ? 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100 hover:bg-green-200 dark:hover:bg-green-800'
                          : classDay
                            ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                            : isWeekend
                              ? 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                              : 'bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800'

                      return (
                        <button
                          key={dateString}
                          onClick={() => toggleDay(dateString, !isClassDay)}
                          className={`aspect-square p-1 rounded text-xs font-medium transition-colors ${colorClasses} ${disabled ? 'cursor-not-allowed' : ''}`}
                          disabled={disabled}
                        >
                          {format(day, 'd')}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3">Legend</h4>
            <div className="flex flex-wrap gap-4 text-sm text-gray-700 dark:text-gray-300">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-green-100 dark:bg-green-900 rounded"></div>
                <span>Class Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <span>Non-Class Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-gray-50 dark:bg-gray-800 rounded"></div>
                <span>Weekend (default)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-red-50 dark:bg-red-900 rounded"></div>
                <span>Holiday (default)</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400">
          No class days defined yet. Generate a range above.
        </div>
      )}
    </div>
  )
}
