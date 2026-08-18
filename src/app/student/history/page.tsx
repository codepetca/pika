'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'
import { Button, ContentDialog, FormField, Input, PageContent, PageLayout, PageState } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { format, parse } from 'date-fns'
import type { Entry, Classroom } from '@/types'
import {
  buildStudentAttendanceHistory,
  getAttendanceIcon,
  getAttendanceLabel,
  type StudentAttendanceHistoryRow,
} from '@/lib/attendance'
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
  const [history, setHistory] = useState<StudentAttendanceHistoryRow[]>([])
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
        const historyData = buildStudentAttendanceHistory(
          classDaysData,
          entries,
          getTodayInToronto(),
        )

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
        aria-label="Student attendance"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="student" width="reading">
          <PageContent>
            <PageState
              kind="loading"
              headingLevel="h1"
              title="Loading attendance"
              description="Getting your classrooms and attendance records."
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
        aria-label="Student attendance"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="student" width="reading">
          <PageContent>
            <PageState
              kind="error"
              headingLevel="h1"
              title="Could not load your classrooms"
              description="Your saved attendance records have not been changed, but they could not be retrieved right now."
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
        aria-label="Student attendance"
        tabIndex={-1}
        className="focus:outline-none"
      >
        <PageLayout density="student" width="reading">
          <PageContent>
            <PageState
              kind="empty"
              headingLevel="h1"
              title="No Classes Yet"
              description="Join a class to view your attendance."
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
      aria-label="Student attendance"
      tabIndex={-1}
      className="flex flex-col gap-4 focus:outline-none md:flex-row md:gap-6"
    >
      {/* Classroom List Sidebar */}
      <div className="w-full flex-shrink-0 md:w-64">
        <div className="bg-surface rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-default">My Classes</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowJoinFlow(!showJoinFlow)}
              aria-expanded={showJoinFlow}
              className="text-primary hover:text-primary-hover"
            >
              + Join
            </Button>
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
              <Button
                key={classroom.id}
                type="button"
                variant={selectedClassroom?.id === classroom.id ? 'subtle' : 'ghost'}
                fullWidth
                onClick={() => setSelectedClassroom(classroom)}
                aria-pressed={selectedClassroom?.id === classroom.id}
                className="h-auto justify-start p-3 text-left"
              >
                  <span className="block min-w-0">
                    <span className="block text-sm font-medium text-text-default">
                      {classroom.title}
                    </span>
                  <span className="mt-1 block text-xs text-text-muted">
                    {classroom.class_code}
                  </span>
                </span>
              </Button>
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
              <p className="text-text-muted mb-4">Attendance</p>

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
                  const rowContent = (
                    <>
                      <div className="flex items-center space-x-4">
                        <span className="text-2xl" aria-hidden="true">{getAttendanceIcon(status)}</span>
                        <div>
                          <div className="font-medium text-text-default">{formattedDate}</div>
                          <div className="text-sm text-text-muted">
                            {getAttendanceLabel(status)}
                          </div>
                        </div>
                      </div>

                      {entry && <span className="text-sm text-primary">View log</span>}
                    </>
                  )

                  return entry ? (
                    <Button
                      key={date}
                      type="button"
                      variant="ghost"
                      fullWidth
                      onClick={() => setSelectedEntry(entry)}
                      aria-label={`${formattedDate}: ${getAttendanceLabel(status)}. View log`}
                      className="h-auto justify-between rounded-none p-4 text-left"
                    >
                      {rowContent}
                    </Button>
                  ) : (
                    <div key={date} className="flex items-center justify-between p-4">
                      {rowContent}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
            Select a class to view your attendance
          </div>
        )}
      </div>

      <ContentDialog
        isOpen={!!selectedEntry}
        onClose={() => setSelectedEntry(null)}
        title={selectedEntry
          ? format(parse(selectedEntry.date, 'yyyy-MM-dd', new Date()), 'EEE MMM d')
          : 'Daily log'}
        showFooterClose={false}
      >
        {selectedEntry && (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-sm font-medium text-text-muted">Log</div>
              <div className="whitespace-pre-wrap text-text-default">{selectedEntry.text}</div>
            </div>
            <div className="border-t border-border pt-4 text-sm text-text-muted">
              Submitted: {format(new Date(selectedEntry.updated_at), 'h:mm a')}
            </div>
          </div>
        )}
      </ContentDialog>
    </div>
  )
}
