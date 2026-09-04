'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Copy } from 'lucide-react'
import { Button, FormField, Input, Tooltip, useAppMessage } from '@/ui'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import { useClassDaysContext } from '@/hooks/useClassDays'
import type { ClassDay, Classroom } from '@/types'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, parseISO } from 'date-fns'
import { getTodayInToronto } from '@/lib/timezone'
import { CLASS_DAYS_UPDATED_EVENT } from '@/lib/events'
import { invalidateClassDaysForClassroom } from '@/lib/class-days-client'
import { getDefaultClassroomEndDate } from '@/lib/calendar'

interface Props {
  classroom: Classroom
}

export function TeacherCalendarTab({ classroom }: Props) {
  const isReadOnly = !!classroom.archived_at
  const { showMarkdown } = useMarkdownPreference()
  const { classDays: contextClassDays, isLoading: contextLoading } = useClassDaysContext()
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [endDateEdited, setEndDateEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const pendingToggleDatesRef = useRef(new Set<string>())
  const [pendingToggleDates, setPendingToggleDates] = useState<Set<string>>(() => new Set())
  const { showMessage } = useAppMessage()

  // Sync from shared context (used for initial load and after event-driven refreshes)
  useEffect(() => {
    if (!contextLoading) {
      setClassDays(contextClassDays)
      setLoading(false)
    }
  }, [contextClassDays, contextLoading])

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
      showMessage({ text: `Generated ${data.count ?? 0} days`, tone: 'success' })
      // Notify context and other components to refresh class days
      invalidateClassDaysForClassroom(classroom.id)
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
      showMessage({ text: 'No class days to copy', tone: 'warning' })
      return
    }

    const markdown = activeClassDays.map(date => `- ${date}`).join('\n')
    await navigator.clipboard.writeText(markdown)
    showMessage({ text: 'Copied', tone: 'success' })
  }

  async function toggleDay(date: string, isClassDay: boolean) {
    if (isReadOnly || pendingToggleDatesRef.current.has(date)) return

    const previousClassDay = classDayMap.get(date)
    const optimisticClassDay: ClassDay = previousClassDay
      ? { ...previousClassDay, is_class_day: isClassDay }
      : {
          id: `optimistic-${date}`,
          classroom_id: classroom.id,
          date,
          prompt_text: null,
          is_class_day: isClassDay,
        }

    pendingToggleDatesRef.current.add(date)
    setPendingToggleDates(new Set(pendingToggleDatesRef.current))
    setClassDays(prev => {
      const existingIndex = prev.findIndex(day => day.date === date)
      if (existingIndex === -1) return [...prev, optimisticClassDay]
      const next = [...prev]
      next[existingIndex] = optimisticClassDay
      return next
    })
    setError('')

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
      const savedClassDay = data.class_day as ClassDay | undefined
      if (!savedClassDay) {
        throw new Error('Failed to update day')
      }
      setClassDays(prev => {
        const existingIndex = prev.findIndex(d => d.date === date)
        if (existingIndex === -1) return [...prev, savedClassDay]
        const next = [...prev]
        next[existingIndex] = savedClassDay
        return next
      })
      // Notify other components (e.g., calendar) that class days changed
      invalidateClassDaysForClassroom(classroom.id)
      window.dispatchEvent(new CustomEvent(CLASS_DAYS_UPDATED_EVENT, { detail: { classroomId: classroom.id } }))
    } catch (err: any) {
      setClassDays(prev => {
        const existingIndex = prev.findIndex(day => day.date === date)
        if (!previousClassDay) {
          return existingIndex === -1 ? prev : prev.filter(day => day.date !== date)
        }
        if (existingIndex === -1) return [...prev, previousClassDay]
        const next = [...prev]
        next[existingIndex] = previousClassDay
        return next
      })
      setError(err.message || 'Failed to update day')
    } finally {
      pendingToggleDatesRef.current.delete(date)
      setPendingToggleDates(new Set(pendingToggleDatesRef.current))
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
        <div className="mb-4 space-y-4 rounded-lg border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-text-default">Set up class days</h2>
            <p className="mt-1 text-sm text-text-muted">
              Choose the actual first day. Pika will add every Monday-Friday so you can review exceptions yourself.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="First class day" required>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => {
                  const nextStartDate = event.target.value
                  setStartDate(nextStartDate)
                  if (!endDateEdited) setEndDate(getDefaultClassroomEndDate(nextStartDate))
                }}
                disabled={saving || isReadOnly}
              />
            </FormField>
            <FormField label="Last class day" required>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value)
                  setEndDateEdited(true)
                }}
                disabled={saving || isReadOnly}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">
              Review holidays, PA days, and the final class day after setup.
            </p>
            <Button
              size="sm"
              onClick={generateFromRange}
              disabled={saving || isReadOnly || !startDate || !endDate}
            >
              {saving ? 'Setting up…' : 'Set up class days'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="space-y-2 mb-4">
          <div className="text-sm text-danger">{error}</div>
        </div>
      )}

      {range ? (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="flex flex-wrap gap-6 text-sm text-text-muted">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-success-bg rounded"></div>
                <span>Class Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-surface-2 rounded"></div>
                <span>Non-Class Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-success-bg-muted rounded"></div>
                <span>Past Class Day</span>
              </div>
              <div className="text-xs text-text-muted">
                {isReadOnly ? 'Read-only mode' : 'Click on date to toggle class days'}
              </div>
              {showMarkdown ? (
                <Tooltip content="Copy class days as markdown">
                  <button
                    type="button"
                    onClick={copyClassDays}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-default hover:bg-surface-hover rounded transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                </Tooltip>
              ) : null}
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
                        ? 'bg-surface-2 text-text-muted'
                        : isClassDay
                          ? isPastClassDay
                            ? 'bg-success-bg-muted text-success hover:bg-success-bg'
                            : 'bg-success-bg text-success hover:bg-success-bg-hover'
                          : 'bg-surface-2 text-text-muted hover:bg-surface-hover'

                      const outlineClasses = isToday ? 'ring-2 ring-primary' : ''
                      const isPending = pendingToggleDates.has(dateString)
                      const toggleDisabled = disabled || isToday || isReadOnly || isPending
                      return (
                        <button
                          key={dateString}
                          onClick={() => toggleDay(dateString, !isClassDay)}
                          aria-pressed={isClassDay}
                          aria-busy={isPending || undefined}
                          className={`aspect-square p-1 rounded text-xs font-medium transition-colors ${colorClasses} ${isPending ? 'cursor-wait' : toggleDisabled ? 'cursor-not-allowed' : ''} ${outlineClasses}`}
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
