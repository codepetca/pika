'use client'

import { useState, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { getTodayInToronto } from '@/lib/timezone'
import {
  formatDueDate,
  formatRelativeDueDate,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass
} from '@/lib/assignments'
import type { Classroom, Entry, ClassDay, MoodEmoji, AssignmentWithStatus } from '@/types'

const MOOD_OPTIONS: MoodEmoji[] = ['😊', '🙂', '😐']

interface Props {
  classroom: Classroom
}

export function StudentClassroomView({ classroom }: Props) {
  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [loading, setLoading] = useState(true)

  // Attendance state
  const [today, setToday] = useState('')
  const [isClassDay, setIsClassDay] = useState(true)
  const [existingEntry, setExistingEntry] = useState<Entry | null>(null)
  const [text, setText] = useState('')
  const [mood, setMood] = useState<MoodEmoji | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [classroom.id])

  async function loadData() {
    try {
      const todayDate = getTodayInToronto()
      setToday(todayDate)

      // Load assignments
      const assignmentsRes = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
      const assignmentsData = await assignmentsRes.json()
      setAssignments(assignmentsData.assignments || [])

      // Check if today is a class day
      const classDayRes = await fetch(
        `/api/teacher/class-days?classroom_id=${classroom.id}&semester=semester1&year=2024`
      )
      const classDayData = await classDayRes.json()

      const todayClassDay = (classDayData.class_days || []).find(
        (day: ClassDay) => day.date === todayDate
      )

      if (todayClassDay) {
        setIsClassDay(todayClassDay.is_class_day)
      }

      // Load existing entry for today
      const entriesRes = await fetch(`/api/student/entries?classroom_id=${classroom.id}`)
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

  async function handleSubmitEntry(e: FormEvent) {
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
      setTimeout(() => setSuccess(''), 3000)
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{classroom.title}</h1>
        <p className="text-gray-600 mt-1">{today}</p>
      </div>

      {/* Today's Attendance */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Check-in</h2>

        {!isClassDay ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <p className="text-gray-600">No class today</p>
          </div>
        ) : (
          <form onSubmit={handleSubmitEntry}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What did you do today?
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe your work today..."
                  required
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How are you feeling?
                </label>
                <div className="flex gap-3">
                  {MOOD_OPTIONS.map((moodOption) => (
                    <button
                      key={moodOption}
                      type="button"
                      onClick={() => setMood(moodOption)}
                      className={`text-3xl p-2 rounded-lg transition ${
                        mood === moodOption
                          ? 'bg-blue-50 border-2 border-blue-500'
                          : 'hover:bg-gray-50 border-2 border-transparent'
                      }`}
                      disabled={submitting}
                    >
                      {moodOption}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {success && <p className="text-sm text-green-600">{success}</p>}

              <Button type="submit" disabled={submitting || !text}>
                {submitting ? 'Saving...' : existingEntry ? 'Update Entry' : 'Save Entry'}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Assignments */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Assignments</h2>
        </div>

        <div className="p-4">
          {assignments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No assignments yet
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((assignment) => (
                <Link
                  key={assignment.id}
                  href={`/classrooms/${classroom.id}/assignments/${assignment.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {assignment.title}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {formatDueDate(assignment.due_at)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatRelativeDueDate(assignment.due_at)}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getAssignmentStatusBadgeClass(assignment.status)}`}>
                      {getAssignmentStatusLabel(assignment.status)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
