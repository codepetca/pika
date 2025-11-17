'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { UploadRosterModal } from '@/components/UploadRosterModal'
import type { Classroom, AttendanceRecord, Entry } from '@/types'
import { getAttendanceIcon } from '@/lib/attendance'

export default function TeacherDashboardPage() {
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
    alert('Join link copied!')
  }

  function handleCopyClassCode() {
    if (!selectedClassroom) return
    navigator.clipboard.writeText(selectedClassroom.class_code)
    alert('Class code copied!')
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
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Classes</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              + New
            </button>
          </div>

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
            {/* Classroom Header */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{selectedClassroom.title}</h2>
                  <p className="text-gray-600 mt-1">
                    {selectedClassroom.class_code}
                    {selectedClassroom.term_label && ` • ${selectedClassroom.term_label}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCopyClassCode}>
                    Copy Code
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleCopyJoinLink}>
                    Copy Link
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowUploadModal(true)}>
                    Upload Roster
                  </Button>
                  <Button size="sm" onClick={handleExportCSV}>
                    Export CSV
                  </Button>
                </div>
              </div>
            </div>

            {/* Attendance Dashboard */}
            {loadingAttendance ? (
              <div className="flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : attendance.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-600">
                No students enrolled yet
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="sticky left-0 z-10 bg-gray-50 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Student
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Present
                        </th>
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Absent
                        </th>
                        {dates.map(date => (
                          <th
                            key={date}
                            className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {date.slice(5)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {attendance.map(record => (
                        <tr key={record.student_id} className="hover:bg-gray-50">
                          <td className="sticky left-0 z-10 bg-white px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {record.student_email}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                            {record.summary.present}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                            {record.summary.absent}
                          </td>
                          {dates.map(date => {
                            const status = record.dates[date]
                            const hasEntry = status === 'present'

                            return (
                              <td
                                key={date}
                                className={`px-3 py-4 whitespace-nowrap text-center text-xl ${
                                  hasEntry ? 'cursor-pointer hover:bg-blue-50' : ''
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
                  className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        {selectedEntry.student_email}
                      </h3>
                      <p className="text-sm text-gray-600">{selectedEntry.date}</p>
                    </div>
                    <button
                      onClick={() => setSelectedEntry(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Entry
                      </label>
                      <p className="text-gray-900 whitespace-pre-wrap">{selectedEntry.text}</p>
                    </div>

                    {selectedEntry.minutes_reported && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Time Spent
                        </label>
                        <p className="text-gray-900">{selectedEntry.minutes_reported} minutes</p>
                      </div>
                    )}

                    {selectedEntry.mood && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mood
                        </label>
                        <p className="text-2xl">{selectedEntry.mood}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-600">
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
    </div>
  )
}
