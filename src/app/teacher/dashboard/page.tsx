'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { format, parse } from 'date-fns'
import type { AttendanceRecord, Entry } from '@/types'
import { getAttendanceIcon } from '@/lib/attendance'

export default function TeacherDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [dates, setDates] = useState<string[]>([])
  const [courseCode] = useState('GLD2O')
  const [selectedEntry, setSelectedEntry] = useState<Entry & { student_email: string } | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    async function loadAttendance() {
      try {
        const response = await fetch(`/api/teacher/attendance?course_code=${courseCode}`)
        const data = await response.json()

        setAttendance(data.attendance || [])
        setDates(data.dates || [])
      } catch (err) {
        console.error('Error loading attendance:', err)
      } finally {
        setLoading(false)
      }
    }

    loadAttendance()
  }, [courseCode])

  async function handleCellClick(studentId: string, studentEmail: string, date: string) {
    // Find if there's an entry for this student/date
    setLoadingEntry(true)

    try {
      const response = await fetch(`/api/student/entries?course_code=${courseCode}`)
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
    window.location.href = `/api/teacher/export-csv?course_code=${courseCode}`
  }

  function handleCopyLink() {
    const joinLink = `${window.location.origin}/join/${courseCode}`
    navigator.clipboard.writeText(joinLink)
    alert('Join link copied to clipboard!')
  }

  function handleUpdateRoster() {
    alert('Update roster functionality coming soon!')
  }

  function handleDelete() {
    if (confirm('Are you sure you want to delete this classroom? This action cannot be undone.')) {
      alert('Delete functionality coming soon!')
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {showSettings ? 'Classroom Settings' : 'Attendance Dashboard'}
          </h2>
          <p className="text-gray-600 mt-1">{courseCode} • {attendance.length} students</p>
        </div>
        {showSettings ? (
          <Button onClick={() => setShowSettings(false)} variant="secondary">
            Back to Dashboard
          </Button>
        ) : (
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            title="Settings"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {showSettings ? (
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-4 p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div>
                <div className="font-medium text-gray-900">Copy Link</div>
                <div className="text-sm text-gray-600">Copy the join link for this classroom</div>
              </div>
            </button>

            {/* Update Roster */}
            <button
              onClick={handleUpdateRoster}
              className="w-full flex items-center gap-4 p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <div>
                <div className="font-medium text-gray-900">Update Roster</div>
                <div className="text-sm text-gray-600">Add or remove students from this classroom</div>
              </div>
            </button>

            {/* Export CSV */}
            <button
              onClick={handleExportCSV}
              className="w-full flex items-center gap-4 p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div>
                <div className="font-medium text-gray-900">Export CSV</div>
                <div className="text-sm text-gray-600">Download attendance data as CSV file</div>
              </div>
            </button>

            {/* Destructive Operations Divider */}
            <div className="pt-4 border-t border-gray-300">
              <p className="text-sm font-medium text-gray-500 mb-4">Destructive Operations</p>
            </div>

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="w-full flex items-center gap-4 p-4 text-left border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <div>
                <div className="font-medium text-red-600">Delete Classroom</div>
                <div className="text-sm text-red-500">Permanently delete this classroom and all data</div>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <>
          {attendance.length === 0 ? (
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
                          {date.slice(5)} {/* Show MM-DD */}
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
                              {getAttendanceIcon(status)}
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
        </>
      )}

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
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  {selectedEntry.student_email}
                </h3>
                <p className="text-sm text-gray-600">
                  {format(parse(selectedEntry.date, 'yyyy-MM-dd', new Date()), 'EEE MMM d')}
                </p>
              </div>
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

      {loadingEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Spinner size="lg" />
        </div>
      )}
    </div>
  )
}
