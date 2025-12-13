'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { ClassDay, Classroom } from '@/types'

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
      const res = await fetch(`/api/teacher/class-days?classroom_id=${classroom.id}`)
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

  const sorted = useMemo(() => {
    return [...classDays].sort((a, b) => a.date.localeCompare(b.date))
  }, [classDays])

  async function generateFromRange() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/teacher/class-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
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
      const res = await fetch('/api/teacher/class-days', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
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
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Calendar</h2>
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
            onClick={load}
          >
            Refresh
          </button>
        </div>

        <div className="text-sm text-gray-600">
          Define which dates are class days. Students can only log on class days.
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm"
              disabled={saving}
            />
          </div>
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            onClick={generateFromRange}
            disabled={saving || !startDate || !endDate}
          >
            {saving ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {success && <div className="text-sm text-green-700">{success}</div>}
      </div>

      <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100">
        {sorted.map((day) => (
          <div key={day.date} className="p-4 flex items-center justify-between">
            <div className="text-sm text-gray-800">{day.date}</div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={day.is_class_day}
                onChange={(e) => toggleDay(day.date, e.target.checked)}
              />
              Class day
            </label>
          </div>
        ))}

        {sorted.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            No class days defined yet. Generate a range above.
          </div>
        )}
      </div>
    </div>
  )
}

