'use client'

import { useState, useEffect } from 'react'
import { Spinner } from '@/components/Spinner'
import type { Entry, ClassDay, AttendanceStatus } from '@/types'
import { getAttendanceIcon, getAttendanceLabel } from '@/lib/attendance'

interface HistoryEntry {
  date: string
  entry: Entry | null
  status: AttendanceStatus
}

export default function HistoryPage() {
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
  const [courseCode] = useState('GLD2O')

  useEffect(() => {
    async function loadHistory() {
      try {
        // Fetch class days
        const classDaysRes = await fetch(
          `/api/teacher/class-days?course_code=${courseCode}&semester=semester1&year=2024`
        )
        const classDaysData = await classDaysRes.json()
        const classDays: ClassDay[] = (classDaysData.class_days || []).filter(
          (day: ClassDay) => day.is_class_day
        )

        // Fetch entries
        const entriesRes = await fetch(`/api/student/entries?course_code=${courseCode}`)
        const entriesData = await entriesRes.json()
        const entries: Entry[] = entriesData.entries || []

        // Build history
        const entryMap = new Map<string, Entry>()
        entries.forEach(entry => entryMap.set(entry.date, entry))

        const historyData: HistoryEntry[] = classDays.map(classDay => {
          const entry = entryMap.get(classDay.date) || null
          let status: AttendanceStatus = 'absent'

          if (entry) {
            status = entry.on_time ? 'present' : 'late'
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
        setLoading(false)
      }
    }

    loadHistory()
  }, [courseCode])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const summary = {
    present: history.filter(h => h.status === 'present').length,
    late: history.filter(h => h.status === 'late').length,
    absent: history.filter(h => h.status === 'absent').length,
  }

  return (
    <div>
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Attendance History
        </h2>

        <div className="flex space-x-8">
          <div>
            <span className="text-3xl">🟢</span>
            <div className="mt-1">
              <div className="text-2xl font-bold text-gray-900">{summary.present}</div>
              <div className="text-sm text-gray-600">Present</div>
            </div>
          </div>

          <div>
            <span className="text-3xl">🟡</span>
            <div className="mt-1">
              <div className="text-2xl font-bold text-gray-900">{summary.late}</div>
              <div className="text-sm text-gray-600">Late</div>
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
      </div>

      <div className="bg-white rounded-lg shadow-sm divide-y">
        {history.length === 0 ? (
          <div className="p-8 text-center text-gray-600">
            No class days yet
          </div>
        ) : (
          history.map(({ date, entry, status }) => (
            <div
              key={date}
              className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => entry && setSelectedEntry(entry)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <span className="text-2xl">{getAttendanceIcon(status)}</span>
                  <div>
                    <div className="font-medium text-gray-900">{date}</div>
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
          ))
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
                {selectedEntry.date}
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

              {selectedEntry.minutes_reported && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Time Spent</div>
                  <div className="text-gray-900">{selectedEntry.minutes_reported} minutes</div>
                </div>
              )}

              {selectedEntry.mood && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">Mood</div>
                  <div className="text-3xl">{selectedEntry.mood}</div>
                </div>
              )}

              <div className="text-sm text-gray-600 pt-4 border-t">
                <div>Submitted: {new Date(selectedEntry.updated_at).toLocaleString()}</div>
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
