'use client'

import { useState, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { Input } from '@/components/Input'
import { getTodayInToronto } from '@/lib/timezone'
import type { MoodEmoji, Entry, ClassDay, Classroom } from '@/types'

const MOOD_OPTIONS: MoodEmoji[] = ['😊', '🙂', '😐']

export default function TodayPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [today, setToday] = useState('')
  const [isClassDay, setIsClassDay] = useState(true)
  const [existingEntry, setExistingEntry] = useState<Entry | null>(null)

  const [text, setText] = useState('')
  const [mood, setMood] = useState<MoodEmoji | null>(null)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  // Join classroom flow
  const [showJoinFlow, setShowJoinFlow] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)

  // Load classrooms
  useEffect(() => {
    async function loadClassrooms() {
      try {
        const response = await fetch('/api/student/classrooms')
        const data = await response.json()

        setClassrooms(data.classrooms || [])

        // Auto-select first classroom
        if (data.classrooms && data.classrooms.length > 0) {
          setSelectedClassroom(data.classrooms[0])
        }
      } catch (err) {
        console.error('Error loading classrooms:', err)
      } finally {
        setLoading(false)
      }
    }

    loadClassrooms()
  }, [])

  // Load entry when classroom selected
  useEffect(() => {
    if (!selectedClassroom) {
      setExistingEntry(null)
      setText('')
      setMood(null)
      return
    }

    async function loadData() {
      if (!selectedClassroom) return
      try {
        const todayDate = getTodayInToronto()
        setToday(todayDate)

        // Check if today is a class day
        const classDayRes = await fetch(
          `/api/teacher/class-days?classroom_id=${selectedClassroom.id}&semester=semester1&year=2024`
        )
        const classDayData = await classDayRes.json()

        const todayClassDay = (classDayData.class_days || []).find(
          (day: ClassDay) => day.date === todayDate
        )

        if (todayClassDay) {
          setIsClassDay(todayClassDay.is_class_day)
        }

        // Load existing entry for today
        const entriesRes = await fetch(`/api/student/entries?classroom_id=${selectedClassroom.id}`)
        const entriesData = await entriesRes.json()

        const todayEntry = (entriesData.entries || []).find(
          (entry: Entry) => entry.date === todayDate
        )

        if (todayEntry) {
          setExistingEntry(todayEntry)
          setText(todayEntry.text)
          setMood(todayEntry.mood)
        } else {
          setExistingEntry(null)
          setText('')
          setMood(null)
        }
      } catch (err) {
        console.error('Error loading data:', err)
      }
    }

    loadData()
  }, [selectedClassroom])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedClassroom) return

    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const response = await fetch('/api/student/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: selectedClassroom.id,
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

  async function handleJoinClassroom(e: FormEvent) {
    e.preventDefault()
    setJoining(true)
    setError('')

    try {
      const response = await fetch('/api/student/classrooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classCode: joinCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join classroom')
      }

      // Add to list and select
      setClassrooms([data.classroom, ...classrooms])
      setSelectedClassroom(data.classroom)
      setJoinCode('')
      setShowJoinFlow(false)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  // Empty state - no classrooms
  if (classrooms.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Classes Yet</h2>
          <p className="text-gray-600 mb-6">Join a class to get started</p>

          <form onSubmit={handleJoinClassroom} className="space-y-4">
            <Input
              label="Class Code"
              type="text"
              placeholder="Enter class code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              required
              disabled={joining}
              error={error}
            />

            <Button type="submit" disabled={joining || !joinCode} className="w-full">
              {joining ? 'Joining...' : 'Join Class'}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      {/* Classroom List Sidebar */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">My Classes</h3>
            <button
              onClick={() => setShowJoinFlow(!showJoinFlow)}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              + Join
            </button>
          </div>

          {showJoinFlow && (
            <form onSubmit={handleJoinClassroom} className="mb-4 space-y-2">
              <Input
                label=""
                type="text"
                placeholder="Class code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                required
                disabled={joining}
                error={error}
              />
              <Button type="submit" size="sm" disabled={joining || !joinCode} className="w-full">
                {joining ? 'Joining...' : 'Join'}
              </Button>
            </form>
          )}

          <div className="space-y-2">
            {classrooms.map((classroom) => (
              <div
                key={classroom.id}
                className={`p-3 rounded transition ${
                  selectedClassroom?.id === classroom.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <button
                  onClick={() => setSelectedClassroom(classroom)}
                  className="w-full text-left"
                >
                  <div className="font-medium text-gray-900 text-sm">
                    {classroom.title}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {classroom.class_code}
                  </div>
                </button>
                <Link
                  href={`/classrooms/${classroom.id}`}
                  className="block text-xs text-blue-600 hover:text-blue-700 mt-2"
                >
                  View Assignments →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {selectedClassroom ? (
          <div className="max-w-2xl">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">{selectedClassroom.title}</h2>
                <p className="text-gray-600 mt-1">{today}</p>
              </div>

              {!isClassDay ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                  <p className="text-gray-600">No class today</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Today's entry
                      </label>
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={8}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="What did you learn today?"
                        required
                        disabled={submitting}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        How are you feeling?
                      </label>
                      <div className="flex gap-4">
                        {MOOD_OPTIONS.map((moodOption) => (
                          <button
                            key={moodOption}
                            type="button"
                            onClick={() => setMood(moodOption)}
                            className={`text-4xl p-3 rounded-lg transition ${
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

                    {error && (
                      <div className="text-sm text-red-600">
                        {error}
                      </div>
                    )}

                    {success && (
                      <div className="text-sm text-green-600">
                        {success}
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={submitting || !text}
                      className="w-full"
                    >
                      {submitting ? 'Saving...' : existingEntry ? 'Update Entry' : 'Save Entry'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-600">
            Select a class to view today's entry
          </div>
        )}
      </div>
    </div>
  )
}
