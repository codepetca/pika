'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AlertDialog } from '@/components/AlertDialog'
import type { Classroom, AttendanceRecord, Entry } from '@/types'
import { getAttendanceIcon } from '@/lib/attendance'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'

export default function TeacherDashboardPage() {
  const router = useRouter()
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<Entry & { student_email: string } | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean
    title: string
    description?: string
    variant?: 'default' | 'success' | 'error'
  }>({ isOpen: false, title: '' })

  // Load classrooms
  useEffect(() => {
    async function loadClassrooms() {
      try {
        const response = await fetch('/api/teacher/classrooms')
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

  // Load attendance when classroom selected
  useEffect(() => {
    if (!selectedClassroom) {
      setAttendance([])
      setDates([])
      return
    }

    async function loadAttendance() {
      if (!selectedClassroom) return
      setLoadingAttendance(true)
      try {
        const response = await fetch(`/api/teacher/attendance?classroom_id=${selectedClassroom.id}`)
        const data = await response.json()

        setAttendance(data.attendance || [])
        setDates(data.dates || [])
      } catch (err) {
        console.error('Error loading attendance:', err)
      } finally {
        setLoadingAttendance(false)
      }
    }

    loadAttendance()
  }, [selectedClassroom])

  async function handleCellClick(studentId: string, studentEmail: string, date: string) {
    if (!selectedClassroom) return

    setLoadingEntry(true)

    try {
      const response = await fetch(`/api/student/entries?classroom_id=${selectedClassroom.id}`)
      const data = await response.json()

      const entry = (data.entries || []).find(
        (e: Entry) => e.student_id === studentId && e.date === date
      )

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
    setClassrooms([classroom, ...classrooms])
    setSelectedClassroom(classroom)
  }

  function handleCopyJoinLink() {
    if (!selectedClassroom) return
    const link = `${window.location.origin}/join/${selectedClassroom.id}`
    navigator.clipboard.writeText(link)
    setAlertDialog({ isOpen: true, title: 'Link Copied', description: 'Join link copied to clipboard!', variant: 'success' })
  }

  function handleCopyClassCode() {
    if (!selectedClassroom) return
    navigator.clipboard.writeText(selectedClassroom.class_code)
    setAlertDialog({ isOpen: true, title: 'Code Copied', description: 'Class code copied to clipboard!', variant: 'success' })
  }

  function handleDeleteClassroom() {
    if (!selectedClassroom) return
    setDeleteConfirmOpen(true)
  }

  async function confirmDeleteClassroom() {
    if (!selectedClassroom) return
    setDeleteConfirmOpen(false)

    try {
      const response = await fetch(`/api/teacher/classrooms/${selectedClassroom.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setAlertDialog({ isOpen: true, title: 'Error', description: data.error || 'Failed to delete classroom', variant: 'error' })
        return
      }

      // Remove from list
      const updatedClassrooms = classrooms.filter(c => c.id !== selectedClassroom.id)
      setClassrooms(updatedClassrooms)

      // Select first remaining classroom or null
      setSelectedClassroom(updatedClassrooms.length > 0 ? updatedClassrooms[0] : null)

      setAlertDialog({ isOpen: true, title: 'Deleted', description: 'Classroom deleted successfully', variant: 'success' })
    } catch (err) {
      console.error('Error deleting classroom:', err)
      setAlertDialog({ isOpen: true, title: 'Error', description: 'An error occurred while deleting the classroom', variant: 'error' })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  // Empty state
  if (classrooms.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Classrooms Yet</h2>
          <p className="text-gray-600 mb-6">Create your first classroom to get started</p>
          <Button onClick={() => setShowCreateModal(true)}>
            Create Classroom
          </Button>
        </div>

        <CreateClassroomModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleClassroomCreated}
        />
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      {/* Classroom List Sidebar */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Classes</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
            >
              + New
            </button>
          </div>

          <div className="space-y-2">
            {classrooms.map((classroom) => (
              <div
                key={classroom.id}
                className={`relative p-3 rounded transition border ${
                  selectedClassroom?.id === classroom.id
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-transparent'
                }`}
              >
                <button
                  onClick={() => setSelectedClassroom(classroom)}
                  className="w-full text-left"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100 text-sm pr-6">
                    {classroom.title}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {classroom.class_code}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedClassroom(classroom)
                    handleDeleteClassroom()
                  }}
                  className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                  title="Delete classroom"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
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
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {selectedClassroom.title}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    <span className="font-mono">{selectedClassroom.class_code}</span>
                    {selectedClassroom.term_label ? ` • ${selectedClassroom.term_label}` : ''}
                  </div>
                </div>
              }
              actions={
                [
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
                  {
                    id: 'delete-classroom',
                    label: 'Delete',
                    onSelect: handleDeleteClassroom,
                    destructive: true,
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
                <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-8 text-center text-gray-600 dark:text-gray-300">
                  No students enrolled yet
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                          <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Student
                          </th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Present
                          </th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Absent
                          </th>
                          {dates.map(date => (
                            <th
                              key={date}
                              className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                            >
                              {date.slice(5)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {attendance.map(record => (
                          <tr key={record.student_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {record.student_email}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900 dark:text-gray-100">
                              {record.summary.present}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900 dark:text-gray-100">
                              {record.summary.absent}
                            </td>
                            {dates.map(date => {
                              const status = record.dates[date]
                              const hasEntry = status === 'present'

                              return (
                                <td
                                  key={date}
                                  className={`px-3 py-4 whitespace-nowrap text-center text-xl ${
                                    hasEntry ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20' : ''
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
                    className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                          {selectedEntry.student_email}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{selectedEntry.date}</p>
                      </div>
                      <button
                        onClick={() => setSelectedEntry(null)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        aria-label="Close entry"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Entry
                        </label>
                        <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{selectedEntry.text}</p>
                      </div>

                      {selectedEntry.minutes_reported && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Time Spent
                          </label>
                          <p className="text-gray-900 dark:text-gray-100">{selectedEntry.minutes_reported} minutes</p>
                        </div>
                      )}

                      {selectedEntry.mood && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-8 text-center text-gray-600 dark:text-gray-300">
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
          onSuccess={() => {
            // Reload attendance to show new students
            setLoadingAttendance(true)
            fetch(`/api/teacher/attendance?classroom_id=${selectedClassroom.id}`)
              .then(r => r.json())
              .then(data => {
                setAttendance(data.attendance || [])
                setDates(data.dates || [])
              })
              .finally(() => setLoadingAttendance(false))
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Classroom"
        description={selectedClassroom ? `Are you sure you want to delete "${selectedClassroom.title}"?\n\nThis will permanently delete:\n- The classroom\n- All student enrollments\n- All class days and calendar\n- All student entries\n\nThis action cannot be undone.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onConfirm={confirmDeleteClassroom}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <AlertDialog
        isOpen={alertDialog.isOpen}
        title={alertDialog.title}
        description={alertDialog.description}
        variant={alertDialog.variant}
        onClose={() => setAlertDialog({ isOpen: false, title: '' })}
      />
    </div>
  )
}
