'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AlertDialog, Button, PageState } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import type { Classroom, AttendanceRecord, Entry } from '@/types'
import { getAttendanceIcon } from '@/lib/attendance'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import {
  fetchTeacherDashboardAttendance,
  fetchTeacherDashboardEntry,
  invalidateTeacherDashboardAttendance,
} from '@/lib/teacher-dashboard-client'
import { fetchTeacherClassrooms, invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'

export default function TeacherDashboardPage() {
  const router = useRouter()
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<Entry & { student_email: string } | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const attendanceRequestIdRef = useRef(0)
  const selectedClassroomIdRef = useRef<string | null>(null)
  selectedClassroomIdRef.current = selectedClassroom?.id ?? null

  const { alertState, showSuccess, closeAlert } = useAlertDialog()

  const loadClassrooms = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const nextClassrooms = await fetchTeacherClassrooms()
      setClassrooms(nextClassrooms)
      setSelectedClassroom(nextClassrooms[0] ?? null)
    } catch (err) {
      console.error('Error loading classrooms:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load classrooms')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadClassrooms()
  }, [loadClassrooms])

  // Load attendance when classroom selected
  useEffect(() => {
    if (!selectedClassroom) {
      attendanceRequestIdRef.current += 1
      setAttendance([])
      setDates([])
      return
    }

    async function loadAttendance() {
      if (!selectedClassroom) return
      const classroomId = selectedClassroom.id
      const requestId = attendanceRequestIdRef.current + 1
      attendanceRequestIdRef.current = requestId

      setLoadingAttendance(true)
      try {
        const data = await fetchTeacherDashboardAttendance(classroomId)

        if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
        setAttendance(data.attendance || [])
        setDates(data.dates || [])
      } catch (err) {
        if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
        console.error('Error loading attendance:', err)
      } finally {
        if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
        setLoadingAttendance(false)
      }
    }

    loadAttendance()
  }, [selectedClassroom])

  async function handleCellClick(studentId: string, studentEmail: string, date: string) {
    if (!selectedClassroom) return

    setLoadingEntry(true)

    try {
      const entry = await fetchTeacherDashboardEntry(selectedClassroom.id, studentId, date)

      if (entry) {
        setSelectedEntry({ ...entry, student_email: studentEmail })
      }
    } catch (err) {
      console.error('Error loading entry:', err)
    } finally {
      setLoadingEntry(false)
    }
  }

  async function handleExportCSV() {
    if (!selectedClassroom) return
    window.location.href = `/api/teacher/export-csv?classroom_id=${selectedClassroom.id}`
  }

  function handleClassroomCreated(classroom: Classroom) {
    invalidateTeacherClassrooms()
    invalidateTeacherDashboardAttendance(classroom.id)
    setClassrooms([classroom, ...classrooms])
    setSelectedClassroom(classroom)
  }

  function handleCopyJoinLink() {
    if (!selectedClassroom) return
    const link = `${window.location.origin}/join/${selectedClassroom.id}`
    navigator.clipboard.writeText(link)
    showSuccess('Link Copied', 'Join link copied to clipboard!')
  }

  function handleCopyClassCode() {
    if (!selectedClassroom) return
    navigator.clipboard.writeText(selectedClassroom.class_code)
    showSuccess('Code Copied', 'Class code copied to clipboard!')
  }

  if (loading) {
    return (
      <PageLayout density="teacher" width="reading">
        <PageContent>
          <PageState
            kind="loading"
            title="Loading classrooms"
            description="Getting the latest classroom overview."
          />
        </PageContent>
      </PageLayout>
    )
  }

  if (loadError) {
    return (
      <PageLayout density="teacher" width="reading">
        <PageContent>
          <PageState
            kind="error"
            title="Could not load classrooms"
            description="The dashboard could not retrieve your classrooms."
            action={
              <Button
                type="button"
                onClick={() => {
                  invalidateTeacherClassrooms()
                  void loadClassrooms()
                }}
              >
                Try again
              </Button>
            }
          />
        </PageContent>
      </PageLayout>
    )
  }

  // Empty state
  if (classrooms.length === 0) {
    return (
      <PageLayout density="teacher" width="reading">
        <PageContent>
          <PageState
            kind="empty"
            title="No Classrooms Yet"
            description="Create your first classroom or start from a course blueprint."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button onClick={() => setShowCreateModal(true)}>
                  Create Classroom
                </Button>
                <Button variant="secondary" onClick={() => router.push('/teacher/blueprints')}>
                  Course Blueprints
                </Button>
              </div>
            }
          />
        </PageContent>

        <CreateClassroomModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleClassroomCreated}
        />
      </PageLayout>
    )
  }

  return (
    <div className="flex gap-6">
      {/* Classroom List Sidebar */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-surface rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-default">Classes</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-primary hover:text-primary-hover text-sm font-medium"
            >
              + New
            </button>
          </div>

          <div className="space-y-2">
            {classrooms.map((classroom) => (
              <div
                key={classroom.id}
                className={`p-3 rounded transition border ${
                  selectedClassroom?.id === classroom.id
                    ? 'bg-info-bg border-primary'
                    : 'hover:bg-surface-hover border-transparent'
                }`}
              >
                <button
                  onClick={() => setSelectedClassroom(classroom)}
                  className="w-full text-left"
                >
                  <div className="font-medium text-text-default text-sm">
                    {classroom.title}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {classroom.class_code}
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {selectedClassroom ? (
          <PageLayout>
            <PageActionBar
              primary={
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-default truncate">
                    {selectedClassroom.title}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    <span className="font-mono">{selectedClassroom.class_code}</span>
                    {selectedClassroom.term_label ? ` • ${selectedClassroom.term_label}` : ''}
                  </div>
                </div>
              }
              actions={
                [
                  {
                    id: 'course-blueprints',
                    label: 'Course blueprints',
                    onSelect: () => router.push('/teacher/blueprints'),
                  },
                  {
                    id: 'open-classroom',
                    label: 'Open classroom',
                    onSelect: () => router.push(`/classrooms/${selectedClassroom.id}`),
                  },
                  {
                    id: 'copy-code',
                    label: 'Copy code',
                    onSelect: handleCopyClassCode,
                  },
                  {
                    id: 'copy-link',
                    label: 'Copy link',
                    onSelect: handleCopyJoinLink,
                  },
                  {
                    id: 'upload-roster',
                    label: 'Upload roster',
                    onSelect: () => setShowUploadModal(true),
                  },
                  {
                    id: 'export-csv',
                    label: 'Export CSV',
                    onSelect: handleExportCSV,
                  },
                ] satisfies ActionBarItem[]
              }
            />

            <PageContent>
              {/* Attendance Dashboard */}
              {loadingAttendance ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
              ) : attendance.length === 0 ? (
                <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
                  No students enrolled yet
                </div>
              ) : (
                <div className="bg-surface rounded-lg shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-surface-2">
                        <tr>
                          <th className="sticky left-0 z-10 bg-surface-2 px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                            Student
                          </th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider">
                            Present
                          </th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider">
                            Absent
                          </th>
                          {dates.map(date => (
                            <th
                              key={date}
                              className="px-3 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider"
                            >
                              {date.slice(5)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-surface divide-y divide-border">
                        {attendance.map(record => (
                          <tr key={record.student_id} className="hover:bg-surface-hover">
                            <td className="sticky left-0 z-10 bg-surface px-6 py-4 whitespace-nowrap text-sm font-medium text-text-default">
                              {record.student_email}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-text-default">
                              {record.summary.present}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-text-default">
                              {record.summary.absent}
                            </td>
                            {dates.map(date => {
                              const status = record.dates[date]
                              const hasEntry = status === 'present'

                              return (
                                <td
                                  key={date}
                                  className={`px-3 py-4 whitespace-nowrap text-center text-xl ${
                                    hasEntry ? 'cursor-pointer hover:bg-info-bg' : ''
                                  }`}
                                  onClick={() =>
                                    hasEntry && handleCellClick(record.student_id, record.student_email, date)
                                  }
                                >
                                  {status && getAttendanceIcon(status)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Entry Modal */}
              {selectedEntry && (
                <div
                  className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
                  onClick={() => setSelectedEntry(null)}
                >
                  <div
                    className="bg-surface rounded-lg shadow-xl max-w-2xl w-full p-6"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-text-default">
                          {selectedEntry.student_email}
                        </h3>
                        <p className="text-sm text-text-muted">{selectedEntry.date}</p>
                      </div>
                      <button
                        onClick={() => setSelectedEntry(null)}
                        className="text-text-muted hover:text-text-default"
                        aria-label="Close entry"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-text-muted mb-1">
                          Entry
                        </label>
                        <p className="text-text-default whitespace-pre-wrap">{selectedEntry.text}</p>
                      </div>

                      {selectedEntry.minutes_reported && (
                        <div>
                          <label className="block text-sm font-medium text-text-muted mb-1">
                            Time Spent
                          </label>
                          <p className="text-text-default">{selectedEntry.minutes_reported} minutes</p>
                        </div>
                      )}

                      {selectedEntry.mood && (
                        <div>
                          <label className="block text-sm font-medium text-text-muted mb-1">
                            Mood
                          </label>
                          <p className="text-2xl">{selectedEntry.mood}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </PageContent>
          </PageLayout>
        ) : (
          <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
            Select a classroom to view attendance
          </div>
        )}
      </div>

      <CreateClassroomModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleClassroomCreated}
      />

      {selectedClassroom && (
        <UploadRosterModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          classroomId={selectedClassroom.id}
          onSuccess={async () => {
            const classroomId = selectedClassroom.id
            const requestId = attendanceRequestIdRef.current + 1
            attendanceRequestIdRef.current = requestId
            invalidateTeacherDashboardAttendance(classroomId)
            setLoadingAttendance(true)
            try {
              const data = await fetchTeacherDashboardAttendance(classroomId)
              if (attendanceRequestIdRef.current !== requestId || selectedClassroomIdRef.current !== classroomId) return
              setAttendance(data.attendance)
              setDates(data.dates)
            } finally {
              if (attendanceRequestIdRef.current === requestId && selectedClassroomIdRef.current === classroomId) {
                setLoadingAttendance(false)
              }
            }
          }}
        />
      )}

      <AlertDialog {...alertState} onClose={closeAlert} />
    </div>
  )
}
