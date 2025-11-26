'use client'

import { useState, useEffect, FormEvent } from 'react'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Spinner } from '@/components/Spinner'
import { format, parse } from 'date-fns'
import type { Entry, ClassDay, AttendanceStatus, Classroom } from '@/types'
import { getAttendanceIcon, getAttendanceLabel } from '@/lib/attendance'

interface HistoryEntry {
  date: string
  entry: Entry | null
  status: AttendanceStatus
}

export default function HistoryPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
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

  // Load history when classroom selected
  useEffect(() => {
    if (!selectedClassroom) {
      setHistory([])
      return
    }

    async function loadHistory() {
      if (!selectedClassroom) return
      setLoadingHistory(true)
      try {
        // Fetch class days
        const classDaysRes = await fetch(
          `/api/teacher/class-days?classroom_id=${selectedClassroom.id}&semester=semester1&year=2024`
        )
        const classDaysData = await classDaysRes.json()
        const classDays: ClassDay[] = (classDaysData.class_days || []).filter(
          (day: ClassDay) => day.is_class_day
        )

        // Fetch entries
        const entriesRes = await fetch(`/api/student/entries?classroom_id=${selectedClassroom.id}`)
        const entriesData = await entriesRes.json()
        const entries: Entry[] = entriesData.entries || []

        // Build history
        const entryMap = new Map<string, Entry>()
        entries.forEach(entry => entryMap.set(entry.date, entry))

        const historyData: HistoryEntry[] = classDays.map(classDay => {
          const entry = entryMap.get(classDay.date) || null
          let status: AttendanceStatus = 'absent'

          if (entry) {
            status = 'present'
          }

          return {
            date: classDay.date,
            entry,
            status,
          }
        })

        // Sort by date descending
        historyData.sort((a, b) => b.date.localeCompare(a.date))

        setHistory(historyData)
      } catch (err) {
        console.error('Error loading history:', err)
      } finally {
        setLoadingHistory(false)
      }
    }

    loadHistory()
  }, [selectedClassroom])

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
          <p className="text-gray-600 mb-6">Join a class to view your history</p>

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

  const summary = {
    present: history.filter(h => h.status === 'present').length,
    absent: history.filter(h => h.status === 'absent').length,
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
              <button
                key={classroom.id}
                onClick={() => setSelectedClassroom(classroom)}
                className={`w-full text-left p-3 rounded transition ${
                  selectedClassroom?.id === classroom.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <div className="font-medium text-gray-900 text-sm">
                  {classroom.title}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {classroom.class_code}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {selectedClassroom ? (
          <div>
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {selectedClassroom.title}
              </h2>
              <p className="text-gray-600 mb-4">Attendance History</p>

              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : (
                <div className="flex space-x-8">
                  <div>
                    <span className="text-3xl">🟢</span>
                    <div className="mt-1">
                      <div className="text-2xl font-bold text-gray-900">{summary.present}</div>
                      <div className="text-sm text-gray-600">Present</div>
                    </div>
                  </div>

                  <div>
                    <span className="text-3xl">🔴</span>
                    <div className="mt-1">
                      <div className="text-2xl font-bold text-gray-900">{summary.absent}</div>
                      <div className="text-sm text-gray-600">Absent</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm divide-y">
              {loadingHistory ? (
                <div className="p-8 text-center text-gray-600">
                  <Spinner size="md" />
                </div>
              ) : history.length === 0 ? (
                <div className="p-8 text-center text-gray-600">
                  No class days yet
                </div>
              ) : (
                history.map(({ date, entry, status }) => {
                  const formattedDate = format(parse(date, 'yyyy-MM-dd', new Date()), 'EEE MMM d')
                  return (
                    <div
                      key={date}
                      className={`p-4 transition-colors ${
                        entry ? 'cursor-pointer hover:bg-gray-50' : ''
                      }`}
                      onClick={() => entry && setSelectedEntry(entry)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <span className="text-2xl">{getAttendanceIcon(status)}</span>
                          <div>
                            <div className="font-medium text-gray-900">{formattedDate}</div>
                            <div className="text-sm text-gray-600">
                              {getAttendanceLabel(status)}
                            </div>
                          </div>
                        </div>

                        {entry && (
                          <button className="text-sm text-blue-600 hover:text-blue-700">
                            View Entry →
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-600">
            Select a class to view your history
          </div>
        )}
      </div>

      {/* Entry Modal */}
      {selectedEntry && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedEntry(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                {format(parse(selectedEntry.date, 'yyyy-MM-dd', new Date()), 'EEE MMM d')}
              </h3>
              <button
                onClick={() => setSelectedEntry(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-gray-700 mb-1">Entry</div>
                <div className="text-gray-900 whitespace-pre-wrap">{selectedEntry.text}</div>
              </div>

              {selectedEntry.mood && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Mood</div>
                  <div className="text-3xl">{selectedEntry.mood}</div>
                </div>
              )}

              <div className="text-sm text-gray-600 pt-4 border-t">
                <div>Submitted: {format(new Date(selectedEntry.updated_at), 'h:mm a')}</div>
                <div>
                  Status: {selectedEntry.on_time ? '✓ On time' : '⚠️ Late submission'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
