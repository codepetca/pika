'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import type { ClassDay, Semester } from '@/types'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay } from 'date-fns'

export default function ClassDaysPage() {
  const [loading, setLoading] = useState(true)
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [courseCode] = useState('GLD2O')
  const [semester, setSemester] = useState<Semester>('semester1')
  const [year, setYear] = useState(2024)
  const [currentMonth, setCurrentMonth] = useState(new Date(2024, 8, 1)) // September 2024
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    loadClassDays()
  }, [courseCode, semester, year])

  async function loadClassDays() {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/teacher/class-days?course_code=${courseCode}&semester=${semester}&year=${year}`
      )
      const data = await response.json()
      setClassDays(data.class_days || [])
    } catch (err) {
      console.error('Error loading class days:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const response = await fetch('/api/teacher/class-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_code: courseCode, semester, year }),
      })

      if (response.ok) {
        await loadClassDays()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to generate class days')
      }
    } catch (err) {
      console.error('Error generating class days:', err)
      alert('An error occurred')
    } finally {
      setGenerating(false)
    }
  }

  async function toggleClassDay(date: string, currentValue: boolean) {
    try {
      const response = await fetch('/api/teacher/class-days', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_code: courseCode,
          date,
          is_class_day: !currentValue,
        }),
      })

      if (response.ok) {
        await loadClassDays()
      }
    } catch (err) {
      console.error('Error toggling class day:', err)
    }
  }

  function renderCalendar() {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

    const classDayMap = new Map<string, ClassDay>()
    classDays.forEach(day => classDayMap.set(day.date, day))

    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
            className="p-2 hover:bg-gray-100 rounded"
          >
            ←
          </button>
          <h3 className="text-lg font-bold">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <button
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
            className="p-2 hover:bg-gray-100 rounded"
          >
            →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
              {day}
            </div>
          ))}

          {/* Empty cells for days before month starts */}
          {Array.from({ length: monthStart.getDay() }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {days.map(day => {
            const dateString = format(day, 'yyyy-MM-dd')
            const classDay = classDayMap.get(dateString)
            const isClassDay = classDay?.is_class_day || false
            const isWeekend = day.getDay() === 0 || day.getDay() === 6

            return (
              <button
                key={dateString}
                onClick={() => classDay && toggleClassDay(dateString, isClassDay)}
                className={`
                  aspect-square p-2 rounded-lg text-sm font-medium transition-colors
                  ${isClassDay ? 'bg-green-100 text-green-900 hover:bg-green-200' : ''}
                  ${!isClassDay && classDay ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : ''}
                  ${!classDay && isWeekend ? 'bg-gray-50 text-gray-400' : ''}
                  ${!classDay && !isWeekend ? 'bg-gray-50 text-gray-600 hover:bg-gray-100' : ''}
                  ${!isSameMonth(day, currentMonth) ? 'opacity-50' : ''}
                `}
                disabled={!classDay}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>

        <div className="mt-6 pt-6 border-t">
          <h4 className="font-medium text-gray-900 mb-3">Legend</h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-green-100 rounded"></div>
              <span>Class Day</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gray-100 rounded"></div>
              <span>Non-Class Day</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gray-50 rounded"></div>
              <span>Not Generated</span>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Click on class days to toggle them on/off.
          </p>
        </div>
      </div>
    )
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Manage Class Days</h2>

        <div className="flex items-center space-x-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Course
            </label>
            <div className="px-4 py-2 bg-gray-100 rounded-lg text-gray-900">
              {courseCode}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value as Semester)}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="semester1">Semester 1 (Sep-Jan)</option>
              <option value="semester2">Semester 2 (Feb-Jun)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Year
            </label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value={2024}>2024</option>
              <option value={2025}>2025</option>
            </select>
          </div>
        </div>

        {classDays.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
            <h3 className="font-medium text-yellow-900 mb-2">
              No class days generated yet
            </h3>
            <p className="text-yellow-800 mb-4">
              Click the button below to auto-generate class days for this semester.
              Weekends and holidays will be automatically excluded.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Class Days'}
            </Button>
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-blue-900">
              <strong>{classDays.filter(d => d.is_class_day).length}</strong> class days configured
            </p>
          </div>
        )}
      </div>

      {renderCalendar()}
    </div>
  )
}
