'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import type { ClassDay } from '@/types'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  addMonths,
  parseISO
} from 'date-fns'

type WizardMode = 'preset' | 'custom'

export default function CalendarPage() {
  const [loading, setLoading] = useState(true)
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [courseCode] = useState('GLD2O')
  const [generating, setGenerating] = useState(false)

  // Wizard state
  const [wizardMode, setWizardMode] = useState<WizardMode>('preset')
  const [selectedPreset, setSelectedPreset] = useState<'semester1' | 'semester2' | null>(null)

  // Custom date state
  const [startMonth, setStartMonth] = useState(9) // September
  const [startYear, setStartYear] = useState(2024)
  const [endMonth, setEndMonth] = useState(1) // January
  const [endYear, setEndYear] = useState(2025)

  useEffect(() => {
    loadClassDays()
  }, [courseCode])

  async function loadClassDays() {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/teacher/class-days?course_code=${courseCode}&semester=semester1&year=2024`
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
      let body: any = { course_code: courseCode }

      if (wizardMode === 'preset' && selectedPreset) {
        // Use semester preset
        const year = selectedPreset === 'semester1' ? 2024 : 2025
        body.semester = selectedPreset
        body.year = year
      } else if (wizardMode === 'custom') {
        // Use custom date range
        const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`
        const endDay = new Date(endYear, endMonth, 0).getDate() // Last day of month
        const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

        body.start_date = startDate
        body.end_date = endDate
      }

      const response = await fetch('/api/teacher/class-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        await loadClassDays()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to generate calendar')
      }
    } catch (err) {
      console.error('Error generating calendar:', err)
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

  function renderWizard() {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Create Calendar
        </h2>
        <p className="text-gray-600 mb-6">
          Choose a semester preset or create a custom date range
        </p>

        {/* Quick Select Buttons */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Quick Select
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                setWizardMode('preset')
                setSelectedPreset('semester1')
              }}
              className={`px-6 py-3 rounded-lg border-2 transition-all ${
                wizardMode === 'preset' && selectedPreset === 'semester1'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              Semester 1 (Sep-Jan)
            </button>
            <button
              onClick={() => {
                setWizardMode('preset')
                setSelectedPreset('semester2')
              }}
              className={`px-6 py-3 rounded-lg border-2 transition-all ${
                wizardMode === 'preset' && selectedPreset === 'semester2'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              Semester 2 (Feb-Jun)
            </button>
            <button
              onClick={() => setWizardMode('custom')}
              className={`px-6 py-3 rounded-lg border-2 transition-all ${
                wizardMode === 'custom'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Custom Date Selection */}
        {wizardMode === 'custom' && (
          <div className="mb-6 p-6 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-4">Custom Date Range</h3>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <div className="flex gap-3">
                  <select
                    value={startMonth}
                    onChange={(e) => setStartMonth(parseInt(e.target.value))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                      <option key={month} value={month}>
                        {format(new Date(2024, month - 1), 'MMMM')}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={startYear}
                    onChange={(e) => setStartYear(parseInt(e.target.value))}
                    min={2020}
                    max={2030}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <div className="flex gap-3">
                  <select
                    value={endMonth}
                    onChange={(e) => setEndMonth(parseInt(e.target.value))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                      <option key={month} value={month}>
                        {format(new Date(2024, month - 1), 'MMMM')}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={endYear}
                    onChange={(e) => setEndYear(parseInt(e.target.value))}
                    min={2020}
                    max={2030}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-900">
            <strong>Note:</strong> Weekends and Ontario statutory holidays will be automatically excluded.
          </p>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={generating || (wizardMode === 'preset' && !selectedPreset)}
          className="w-full"
        >
          {generating ? 'Generating Calendar...' : 'Generate Calendar'}
        </Button>
      </div>
    )
  }

  function renderCompactCalendar() {
    if (classDays.length === 0) return null

    // Get date range from class days
    const dates = classDays.map(d => parseISO(d.date))
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))

    // Generate array of months to display
    const months: Date[] = []
    let current = startOfMonth(minDate)
    const end = startOfMonth(maxDate)

    while (current <= end) {
      months.push(current)
      current = addMonths(current, 1)
    }

    const classDayMap = new Map<string, ClassDay>()
    classDays.forEach(day => classDayMap.set(day.date, day))

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Calendar</h2>
          <p className="text-gray-600">
            <strong>{classDays.filter(d => d.is_class_day).length}</strong> class days configured.
            Click any day to toggle.
          </p>
        </div>

        {/* Compact Multi-Month Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {months.map(month => {
            const monthStart = startOfMonth(month)
            const monthEnd = endOfMonth(month)
            const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

            return (
              <div key={month.toString()} className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-center font-bold text-gray-900 mb-3">
                  {format(month, 'MMMM yyyy')}
                </h3>

                <div className="grid grid-cols-7 gap-1">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                    <div key={i} className="text-center text-xs font-medium text-gray-500 py-1">
                      {day}
                    </div>
                  ))}

                  {/* Empty cells before month starts */}
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
                          aspect-square p-1 rounded text-xs font-medium transition-colors
                          ${isClassDay ? 'bg-green-100 text-green-900 hover:bg-green-200' : ''}
                          ${!isClassDay && classDay ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' : ''}
                          ${!classDay && isWeekend ? 'bg-gray-50 text-gray-400' : ''}
                          ${!classDay && !isWeekend ? 'bg-red-50 text-red-600' : ''}
                          ${!isSameMonth(day, month) ? 'opacity-30' : ''}
                        `}
                        disabled={!classDay}
                      >
                        {format(day, 'd')}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 bg-white rounded-lg shadow-sm p-4">
          <h4 className="font-medium text-gray-900 mb-3">Legend</h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-green-100 rounded"></div>
              <span>Class Day</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-gray-200 rounded"></div>
              <span>Non-Class Day</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-gray-50 rounded"></div>
              <span>Weekend</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-red-50 rounded"></div>
              <span>Holiday</span>
            </div>
          </div>
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

  // Show wizard if no class days exist, otherwise show compact calendar
  return classDays.length === 0 ? renderWizard() : renderCompactCalendar()
}
