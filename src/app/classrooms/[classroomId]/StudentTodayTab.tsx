'use client'

import { useEffect, useState, FormEvent } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { getTodayInToronto } from '@/lib/timezone'
import { isClassDayOnDate } from '@/lib/class-days'
import type { Classroom, ClassDay, Entry, MoodEmoji } from '@/types'

const MOOD_OPTIONS: MoodEmoji[] = ['😊', '🙂', '😐']

interface Props {
  classroom: Classroom
}

export function StudentTodayTab({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState('')
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [existingEntry, setExistingEntry] = useState<Entry | null>(null)
  const [text, setText] = useState('')
  const [mood, setMood] = useState<MoodEmoji | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const todayDate = getTodayInToronto()
        setToday(todayDate)

        const classDayRes = await fetch(`/api/teacher/class-days?classroom_id=${classroom.id}`)
        const classDayData = await classDayRes.json()
        setClassDays(classDayData.class_days || [])

        const entriesRes = await fetch(`/api/student/entries?classroom_id=${classroom.id}`)
        const entriesData = await entriesRes.json()
        const todayEntry = (entriesData.entries || []).find((e: Entry) => e.date === todayDate) || null

        setExistingEntry(todayEntry)
        setText(todayEntry?.text || '')
        setMood(todayEntry?.mood || null)
      } catch (err) {
        console.error('Error loading today tab:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  const isClassDay = today ? isClassDayOnDate(classDays, today) : true

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const response = await fetch('/api/student/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          date: today,
          text,
          mood,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save entry')
      }

      setExistingEntry(data.entry)
      setSuccess('Entry saved!')
      setTimeout(() => setSuccess(''), 2000)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setSubmitting(false)
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
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Today</h2>
        <div className="text-sm text-gray-600">{today}</div>
      </div>

      {!isClassDay ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-gray-600">No class today</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              What did you do today?
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Write a short update..."
              required
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mood (optional)
            </label>
            <div className="flex gap-3">
              {MOOD_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMood(m)}
                  className={`text-3xl p-2 rounded-lg transition ${
                    mood === m
                      ? 'bg-blue-50 border-2 border-blue-500'
                      : 'hover:bg-gray-50 border-2 border-transparent'
                  }`}
                  disabled={submitting}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <Button type="submit" disabled={submitting || !text}>
            {submitting ? 'Saving...' : existingEntry ? 'Update' : 'Save'}
          </Button>
        </form>
      )}
    </div>
  )
}

