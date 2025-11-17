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
          <h2 className="text-2xl font-bold text-gray-900">Attendance Dashboard</h2>
          <p className="text-gray-600 mt-1">{courseCode} • {attendance.length} students</p>
        </div>
        <Button onClick={handleExportCSV}>
          Export CSV
        </Button>
      </div>

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
                    Late
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
                      {record.summary.late}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                      {record.summary.absent}
                    </td>
                    {dates.map(date => {
                      const status = record.dates[date]
                      const hasEntry = status === 'present' || status === 'late'

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
