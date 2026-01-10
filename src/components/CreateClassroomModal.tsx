'use client'

import { useState, FormEvent, useId } from 'react'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import { format } from 'date-fns'

type WizardStep = 'name' | 'calendar'
type CalendarMode = 'preset' | 'custom'
type Semester = 'semester1' | 'semester2'

interface CreateClassroomModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (classroom: any) => void
}

export function CreateClassroomModal({ isOpen, onClose, onSuccess }: CreateClassroomModalProps) {
  const startMonthId = useId()
  const startYearId = useId()
  const endMonthId = useId()
  const endYearId = useId()

  const [step, setStep] = useState<WizardStep>('name')
  const [title, setTitle] = useState('')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('preset')
  const [selectedSemester, setSelectedSemester] = useState<Semester>('semester1')

  // Custom date state
  const currentYear = new Date().getFullYear()
  const [startMonth, setStartMonth] = useState(9) // September
  const [startYear, setStartYear] = useState(currentYear)
  const [endMonth, setEndMonth] = useState(1) // January
  const [endYear, setEndYear] = useState(currentYear + 1)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function getSemesterYears() {
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    let semester1Year: number
    let semester2Year: number

    if (currentMonth >= 9 || currentMonth <= 1) {
      if (currentMonth >= 9) {
        semester1Year = currentYear
        semester2Year = currentYear + 1
      } else {
        semester1Year = currentYear - 1
        semester2Year = currentYear
      }
    } else if (currentMonth >= 2 && currentMonth <= 6) {
      semester1Year = currentYear
      semester2Year = currentYear
    } else {
      semester1Year = currentYear
      semester2Year = currentYear + 1
    }

    return { semester1Year, semester2Year }
  }

  function resetForm() {
    setStep('name')
    setTitle('')
    setCalendarMode('preset')
    setSelectedSemester('semester1')
    setError('')
  }

  async function handleCreate() {
    setError('')
    setLoading(true)

    try {
      // Step 1: Create classroom
      const createResponse = await fetch('/api/teacher/classrooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })

      const createData = await createResponse.json()

      if (!createResponse.ok) {
        throw new Error(createData.error || 'Failed to create classroom')
      }

      const classroom = createData.classroom

      // Step 2: Create calendar
      let calendarBody: any = { classroom_id: classroom.id }

      if (calendarMode === 'preset') {
        const { semester1Year, semester2Year } = getSemesterYears()
        const year = selectedSemester === 'semester1' ? semester1Year : semester2Year
        calendarBody.semester = selectedSemester
        calendarBody.year = year
      } else {
        const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`
        const endDay = new Date(endYear, endMonth, 0).getDate()
        const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
        calendarBody.start_date = startDate
        calendarBody.end_date = endDate
      }

      await fetch('/api/teacher/class-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calendarBody),
      })
      // Ignoring errors on calendar creation - classroom is already created

      onSuccess(classroom)
      resetForm()
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  if (!isOpen) return null

  const { semester1Year, semester2Year } = getSemesterYears()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-w-lg w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Create Classroom</h2>

        {/* Progress Indicator */}
        <div className="flex items-center mb-6">
          <div className={`flex-1 h-1 rounded ${step === 'name' ? 'bg-blue-600 dark:bg-blue-500' : 'bg-blue-200 dark:bg-blue-800'}`} />
          <div className={`flex-1 h-1 rounded ml-2 ${step === 'calendar' ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
        </div>

        {/* Step 1: Name */}
        {step === 'name' && (
          <div>
            <Input
              label="Classroom Name"
              type="text"
              placeholder="Career Studies - Period 1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={loading}
              autoFocus
            />
          </div>
        )}

        {/* Step 2: Calendar */}
        {step === 'calendar' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Choose Calendar
            </label>

            <div className="space-y-3 mb-4">
              <button
                type="button"
                onClick={() => {
                  setCalendarMode('preset')
                  setSelectedSemester('semester1')
                }}
                className={`w-full p-4 rounded-lg border-2 transition text-left ${
                  calendarMode === 'preset' && selectedSemester === 'semester1'
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">Semester 1</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Sep {semester1Year} - Jan {semester1Year + 1}
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCalendarMode('preset')
                  setSelectedSemester('semester2')
                }}
                className={`w-full p-4 rounded-lg border-2 transition text-left ${
                  calendarMode === 'preset' && selectedSemester === 'semester2'
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">Semester 2</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Feb {semester2Year} - Jun {semester2Year}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCalendarMode('custom')}
                className={`w-full p-4 rounded-lg border-2 transition ${
                  calendarMode === 'custom'
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">Custom Date Range</div>
              </button>
            </div>

            {calendarMode === 'custom' && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={startMonthId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Start</label>
                    <div className="flex gap-2">
                      <select
                        id={startMonthId}
                        value={startMonth}
                        onChange={(e) => setStartMonth(parseInt(e.target.value))}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>
                            {format(new Date(2024, month - 1), 'MMM')}
                          </option>
                        ))}
                      </select>
                      <input
                        id={startYearId}
                        type="number"
                        value={startYear}
                        onChange={(e) => setStartYear(parseInt(e.target.value))}
                        min={2020}
                        max={2030}
                        aria-label="Start year"
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor={endMonthId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">End</label>
                    <div className="flex gap-2">
                      <select
                        id={endMonthId}
                        value={endMonth}
                        onChange={(e) => setEndMonth(parseInt(e.target.value))}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>
                            {format(new Date(2024, month - 1), 'MMM')}
                          </option>
                        ))}
                      </select>
                      <input
                        id={endYearId}
                        type="number"
                        value={endYear}
                        onChange={(e) => setEndYear(parseInt(e.target.value))}
                        min={2020}
                        max={2030}
                        aria-label="End year"
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-3 mt-6">
          <Button
            type="button"
            variant="secondary"
            onClick={step === 'name' ? handleClose : () => {
              setStep('name')
              setError('')
            }}
            disabled={loading}
            className="flex-1"
          >
            {step === 'name' ? 'Cancel' : 'Back'}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (step === 'name' && title) {
                setStep('calendar')
                setError('')
              } else if (step === 'calendar') {
                handleCreate()
              }
            }}
            disabled={loading || (step === 'name' && !title)}
            className="flex-1"
          >
            {loading ? 'Creating...' : step === 'calendar' ? 'Create' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
