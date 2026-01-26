'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Copy } from 'lucide-react'
import { Tooltip } from '@/ui'
import type { ClassDay, Classroom } from '@/types'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, parseISO } from 'date-fns'
import { getTodayInToronto } from '@/lib/timezone'
import { CLASS_DAYS_UPDATED_EVENT } from '@/lib/events'

interface Props {
  classroom: Classroom
}

export function TeacherCalendarTab({ classroom }: Props) {
  const isReadOnly = !!classroom.archived_at
  const [loading, setLoading] = useState(true)
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string>('')

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
    if (isReadOnly) return
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
      // Notify other components (e.g., calendar) that class days changed
      window.dispatchEvent(new CustomEvent(CLASS_DAYS_UPDATED_EVENT, { detail: { classroomId: classroom.id } }))
    } catch (err: any) {
      setError(err.message || 'Failed to generate class days')
    } finally {
      setSaving(false)
    }
  }

  async function copyClassDays() {
    const activeClassDays = classDays
      .filter(d => d.is_class_day)
      .map(d => d.date)
      .sort()

    if (activeClassDays.length === 0) {
      setCopyNotice('No class days to copy')
      setTimeout(() => setCopyNotice(''), 2000)
      return
    }

    const markdown = activeClassDays.map(date => `- ${date}`).join('\n')
    await navigator.clipboard.writeText(markdown)
    setCopyNotice('Copied!')
    setTimeout(() => setCopyNotice(''), 2000)
  }

  async function toggleDay(date: string, isClassDay: boolean) {
    if (isReadOnly) return
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
      // Notify other components (e.g., calendar) that class days changed
      window.dispatchEvent(new CustomEvent(CLASS_DAYS_UPDATED_EVENT, { detail: { classroomId: classroom.id } }))
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

      {!isInitialized && (
        <div className="bg-surface rounded-lg border border-border p-3 space-y-3 mb-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-text-muted mb-1">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-default"
                disabled={saving || isReadOnly}
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-default"
                disabled={saving || isReadOnly}
              />
            </div>
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50"
              onClick={generateFromRange}
              disabled={saving || isReadOnly || !startDate || !endDate}
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
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="flex flex-wrap gap-6 text-sm text-text-muted">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-green-100 dark:bg-green-900 rounded"></div>
                <span>Class Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-surface-2 rounded"></div>
                <span>Non-Class Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-emerald-50 dark:bg-emerald-900/40 rounded"></div>
                <span>Past Class Day</span>
              </div>
              <div className="text-xs text-text-muted">
                {isReadOnly ? 'Read-only mode' : 'Click on date to toggle class days'}
              </div>
              <Tooltip content="Copy class days as markdown">
                <button
                  type="button"
                  onClick={copyClassDays}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-gray-900 dark:hover:text-gray-200 hover:bg-surface-hover rounded transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copyNotice || 'Copy'}</span>
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {months.map(month => {
              const monthStart = startOfMonth(month)
              const monthEnd = endOfMonth(month)
              const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

              const todayToronto = getTodayInToronto()
              const rangeStartStr = format(range.start, 'yyyy-MM-dd')
              const rangeEndStr = format(range.end, 'yyyy-MM-dd')

              return (
                <div key={month.toString()} className="bg-surface rounded-lg shadow-sm border border-border p-4">
                  <h3 className="text-center font-bold text-text-default mb-3">
                    {format(month, 'MMMM yyyy')}
                  </h3>

                  <div className="grid grid-cols-7 gap-1">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                      <div key={i} className="text-center text-xs font-medium text-text-muted py-1">
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
                      const isBeforeToday = dateString < todayToronto
                      const isPastClassDay = isClassDay && isBeforeToday
                      const isInRange = dateString >= rangeStartStr && dateString <= rangeEndStr
                      const disabled = !isInRange || (!isClassDay && isBeforeToday)

                      const isToday = dateString === todayToronto
                      const colorClasses = disabled
                        ? 'bg-surface-2 text-gray-400 dark:text-gray-500'
                        : isClassDay
                          ? isPastClassDay
                            ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-900/70 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-700'
                            : 'bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100 hover:bg-green-200 dark:hover:bg-green-800'
                          : 'bg-surface-2 text-text-muted hover:bg-surface-hover'

                      const outlineClasses = isToday ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''
                      const toggleDisabled = disabled || isToday || isReadOnly
                      return (
                        <button
                          key={dateString}
                          onClick={() => toggleDay(dateString, !isClassDay)}
                          className={`aspect-square p-1 rounded text-xs font-medium transition-colors ${colorClasses} ${toggleDisabled ? 'cursor-not-allowed' : ''} ${outlineClasses}`}
                          disabled={toggleDisabled}
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

        </div>
      ) : (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6 text-center text-text-muted">
          No class days defined yet. Generate a range above.
        </div>
      )}
    </div>
  )
}
