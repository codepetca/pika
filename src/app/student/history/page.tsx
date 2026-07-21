'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'
import { Button, FormField, Input, PageContent, PageLayout, PageState } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { format, parse } from 'date-fns'
import type { Entry, ClassDay, AttendanceStatus, Classroom } from '@/types'
import { entryHasContent, getAttendanceIcon, getAttendanceLabel } from '@/lib/attendance'
import {
  fetchClassDaysForClassroom,
  invalidateClassDaysForClassroom,
} from '@/lib/class-days-client'
import {
  fetchStudentEntriesForClassroom,
  invalidateStudentEntriesForClassroom,
} from '@/lib/student-entries-client'
import { fetchStudentClassrooms, invalidateStudentClassrooms } from '@/lib/student-classrooms-client'
import { getTodayInToronto } from '@/lib/timezone'

interface HistoryEntry {
  date: string
  entry: Entry | null
  status: AttendanceStatus
}

export default function HistoryPage() {
  const pageRegionRef = useRef<HTMLDivElement>(null)
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
  const [error, setError] = useState('')

  // Join classroom flow
  const [showJoinFlow, setShowJoinFlow] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)

  // Load classrooms
  useEffect(() => {
    let cancelled = false

    async function loadClassrooms() {
      setLoading(true)
      setLoadError('')
      try {
        const nextClassrooms = await fetchStudentClassrooms()
        if (cancelled) return

        setClassrooms(nextClassrooms)
        setSelectedClassroom(nextClassrooms[0] ?? null)
      } catch (err) {
        console.error('Error loading classrooms:', err)
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load classrooms')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadClassrooms()
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  // Load history when classroom selected
  useEffect(() => {
    let cancelled = false

    if (!selectedClassroom) {
      setHistory([])
      setLoadingHistory(false)
      return
    }

    async function loadHistory() {
      if (!selectedClassroom) return
      setLoadingHistory(true)
      setHistoryError('')
      setHistory([])
      try {
        const [classDaysData, entries] = await Promise.all([
          fetchClassDaysForClassroom(selectedClassroom.id),
          fetchStudentEntriesForClassroom(selectedClassroom.id),
        ])
        const classDays: ClassDay[] = classDaysData.filter(
          (day: ClassDay) => day.is_class_day
        )

        // Build history
        const entryMap = new Map<string, Entry>()
        entries.forEach(entry => entryMap.set(entry.date, entry))
        const today = getTodayInToronto()

        const historyData: HistoryEntry[] = classDays.map(classDay => {
          const entry = entryMap.get(classDay.date) || null
          let status: AttendanceStatus
          if (entry && entryHasContent(entry)) {
            status = 'present'
          } else if (classDay.date >= today) {
            status = 'pending'
          } else {
            status = 'absent'
          }

          return {
            date: classDay.date,
            entry,
            status,
          }
        })

        // Sort by date descending
        historyData.sort((a, b) => b.date.localeCompare(a.date))

        if (cancelled) return
        setHistory(historyData)
      } catch (err) {
        console.error('Error loading history:', err)
        if (cancelled) return
        setHistory([])
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history')
      } finally {
        if (cancelled) return
        setLoadingHistory(false)
      }
    }

    loadHistory()

    return () => {
      cancelled = true
    }
  }, [historyAttempt, selectedClassroom])

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
      invalidateStudentClassrooms()
      setClassrooms((current) => [data.classroom, ...current.filter((classroom) => classroom.id !== data.classroom.id)])
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
      <div
        ref={pageRegionRef}
        role="region"
        aria-label="Student history"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="student" width="reading">
          <PageContent>
            <PageState
              kind="loading"
              headingLevel="h1"
              title="Loading history"
              description="Getting your classrooms and attendance history."
            />
          </PageContent>
        </PageLayout>
      </div>
    )
  }

  if (loadError) {
    return (
      <div
        ref={pageRegionRef}
        role="region"
        aria-label="Student history"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="student" width="reading">
          <PageContent>
            <PageState
              kind="error"
              headingLevel="h1"
              title="Could not load your classrooms"
              description="Your saved history has not been changed, but it could not be retrieved right now."
              action={
                <Button
                  type="button"
                  onClick={() => {
                    pageRegionRef.current?.focus()
                    invalidateStudentClassrooms()
                    setLoadAttempt((attempt) => attempt + 1)
                  }}
                >
                  Try again
                </Button>
              }
            />
          </PageContent>
        </PageLayout>
      </div>
    )
  }

  // Empty state - no classrooms
  if (classrooms.length === 0) {
    return (
      <div
        ref={pageRegionRef}
        role="region"
        aria-label="Student history"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="student" width="reading">
          <PageContent>
            <PageState
              kind="empty"
              headingLevel="h1"
              title="No Classes Yet"
              description="Join a class to view your history."
              action={
                <form onSubmit={handleJoinClassroom} className="w-full space-y-4 text-left">
                  <FormField label="Class Code" error={error} required>
                    <Input
                      type="text"
                      placeholder="Enter class code"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      required
                      disabled={joining}
                    />
                  </FormField>

                  <Button type="submit" disabled={joining || !joinCode} className="w-full">
                    {joining ? 'Joining...' : 'Join Class'}
                  </Button>
                </form>
              }
            />
          </PageContent>
        </PageLayout>
      </div>
    )
  }

  const summary = {
    present: history.filter(h => h.status === 'present').length,
    absent: history.filter(h => h.status === 'absent').length,
  }

  return (
    <div
      ref={pageRegionRef}
      role="region"
      aria-label="Student history"
      tabIndex={-1}
      className="flex flex-col gap-4 focus:outline-none md:flex-row md:gap-6"
    >
      {/* Classroom List Sidebar */}
      <div className="w-full flex-shrink-0 md:w-64">
        <div className="bg-surface rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-default">My Classes</h3>
            <button
              onClick={() => setShowJoinFlow(!showJoinFlow)}
              className="text-primary hover:text-primary-hover text-sm font-medium"
            >
              + Join
            </button>
          </div>

          {showJoinFlow && (
            <form onSubmit={handleJoinClassroom} className="mb-4 space-y-2">
              <FormField label="Class Code" error={error}>
                <Input
                  type="text"
                  placeholder="Class code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  required
                  disabled={joining}
                />
              </FormField>
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
                    ? 'bg-info-bg border border-primary'
                    : 'hover:bg-surface-hover border border-transparent'
                }`}
              >
                <div className="font-medium text-text-default text-sm">
                  {classroom.title}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {classroom.class_code}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1">
        {historyError ? (
          <PageState
            kind="error"
            compact
            title="Could not load attendance history"
            description="The selected class history could not be retrieved."
            action={
              <Button
                type="button"
                onClick={() => {
                  pageRegionRef.current?.focus()
                  if (selectedClassroom) {
                    invalidateClassDaysForClassroom(selectedClassroom.id)
                    invalidateStudentEntriesForClassroom(selectedClassroom.id)
                  }
                  setHistoryAttempt((attempt) => attempt + 1)
                }}
              >
                Try again
              </Button>
            }
          />
        ) : selectedClassroom ? (
          <div>
            <div className="bg-surface rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-2xl font-bold text-text-default mb-1">
                {selectedClassroom.title}
              </h2>
              <p className="text-text-muted mb-4">Attendance History</p>

              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : (
                <div className="flex space-x-8">
                  <div>
                    <span className="text-3xl">🟢</span>
                    <div className="mt-1">
                      <div className="text-2xl font-bold text-text-default">{summary.present}</div>
                      <div className="text-sm text-text-muted">Present</div>
                    </div>
                  </div>

                  <div>
                    <span className="text-3xl">🔴</span>
                    <div className="mt-1">
                      <div className="text-2xl font-bold text-text-default">{summary.absent}</div>
                      <div className="text-sm text-text-muted">Absent</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-surface rounded-lg shadow-sm divide-y">
              {loadingHistory ? (
                <div className="p-8 text-center text-text-muted">
                  <Spinner size="md" />
                </div>
              ) : history.length === 0 ? (
                <div className="p-8 text-center text-text-muted">
                  No class days yet
                </div>
              ) : (
                history.map(({ date, entry, status }) => {
                  const formattedDate = format(parse(date, 'yyyy-MM-dd', new Date()), 'EEE MMM d')
                  return (
                    <div
                      key={date}
                      className={`p-4 transition-colors ${
                        entry ? 'cursor-pointer hover:bg-surface-hover' : ''
                      }`}
                      onClick={() => entry && setSelectedEntry(entry)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <span className="text-2xl">{getAttendanceIcon(status)}</span>
                          <div>
                            <div className="font-medium text-text-default">{formattedDate}</div>
                            <div className="text-sm text-text-muted">
                              {getAttendanceLabel(status)}
                            </div>
                          </div>
                        </div>

                        {entry && (
                          <button className="text-sm text-primary hover:text-primary-hover">
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
          <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
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
            className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-text-default">
                {format(parse(selectedEntry.date, 'yyyy-MM-dd', new Date()), 'EEE MMM d')}
              </h3>
              <button
                onClick={() => setSelectedEntry(null)}
                className="text-text-muted hover:text-text-default text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-text-muted mb-1">Entry</div>
                <div className="text-text-default whitespace-pre-wrap">{selectedEntry.text}</div>
              </div>

              <div className="text-sm text-text-muted pt-4 border-t border-border">
                <div>Submitted: {format(new Date(selectedEntry.updated_at), 'h:mm a')}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
