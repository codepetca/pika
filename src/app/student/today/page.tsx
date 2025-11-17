'use client'

import { useState, useEffect, FormEvent } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { getTodayInToronto } from '@/lib/timezone'
import { format, parse } from 'date-fns'
import type { MoodEmoji, Entry, ClassDay } from '@/types'

const MOOD_OPTIONS: MoodEmoji[] = ['😊', '😐', '😢']

export default function TodayPage() {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [courseCode] = useState('GLD2O') // For MVP, hardcoded
  const [today, setToday] = useState('')
  const [isClassDay, setIsClassDay] = useState(true)
  const [existingEntry, setExistingEntry] = useState<Entry | null>(null)

  const [text, setText] = useState('')
  const [mood, setMood] = useState<MoodEmoji | null>(null)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadData() {
      try {
        // Get today's date in Toronto timezone
        const todayDate = getTodayInToronto()
        setToday(todayDate)

        // Check if today is a class day
        const classDayRes = await fetch(
          `/api/teacher/class-days?course_code=${courseCode}&semester=semester1&year=2024`
        )
        const classDayData = await classDayRes.json()

        const todayClassDay = (classDayData.class_days || []).find(
          (day: ClassDay) => day.date === todayDate
        )

        if (todayClassDay) {
          setIsClassDay(todayClassDay.is_class_day)
        }

        // Load existing entry for today
        const entriesRes = await fetch(`/api/student/entries?course_code=${courseCode}`)
        const entriesData = await entriesRes.json()

        const todayEntry = (entriesData.entries || []).find(
          (entry: Entry) => entry.date === todayDate
        )

        if (todayEntry) {
          setExistingEntry(todayEntry)
          setText(todayEntry.text)
          setMood(todayEntry.mood)
        }
      } catch (err) {
        console.error('Error loading data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [courseCode])

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
          course_code: courseCode,
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
      setSuccess(
        data.entry.on_time
          ? 'Entry saved! Submitted on time ✓'
          : 'Entry saved! Note: Submitted after midnight deadline'
      )
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

  if (!isClassDay) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          No Class Today
        </h2>
        <p className="text-gray-600">
          Today is not a scheduled class day. Enjoy your day off!
        </p>
      </div>
    )
  }

  // Format date as "Mon Nov 17"
  const formattedDate = today ? format(parse(today, 'yyyy-MM-dd', new Date()), 'EEE MMM d') : ''

  return (
    <div className="bg-white rounded-lg shadow-sm p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        {formattedDate}
      </h2>
      <p className="text-gray-600 mb-6">
        {courseCode}
      </p>

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm font-medium text-gray-700">
              What did you work on today?
            </label>
            <div className="relative group">
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Help"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity absolute left-0 top-full mt-1 w-80 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg z-10">
                Describe your learning activities, what you accomplished, challenges you faced, questions you have...
                <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
              </div>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            How are you feeling?
          </label>
          <div className="flex space-x-4">
            {MOOD_OPTIONS.map((moodOption) => (
              <button
                key={moodOption}
                type="button"
                onClick={() => setMood(moodOption)}
                className={`text-4xl p-2 rounded-lg transition-all ${
                  mood === moodOption
                    ? 'bg-blue-100 scale-110'
                    : 'hover:bg-gray-100'
                }`}
              >
                {moodOption}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={submitting || !text.trim()}
        >
          {submitting ? 'Saving...' : existingEntry ? 'Update Entry' : 'Submit Entry'}
        </Button>

        {existingEntry && (
          <p className="mt-4 text-sm text-gray-600 text-center">
            Last updated: {format(new Date(existingEntry.updated_at), 'h:mm a')}
          </p>
        )}
      </form>
    </div>
  )
}
