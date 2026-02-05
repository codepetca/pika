'use client'

import { useState, FormEvent, useId } from 'react'
import { Input, Button, DialogPanel, FormField } from '@/ui'
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
  const endMonthId = useId()

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

  const { semester1Year, semester2Year } = getSemesterYears()

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-lg"
      className="p-6"
      ariaLabelledBy="create-classroom-title"
    >
      <h2 id="create-classroom-title" className="text-xl font-bold text-text-default mb-4 flex-shrink-0">Create Classroom</h2>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Progress Indicator */}
        <div className="flex items-center mb-6">
          <div className={`flex-1 h-1 rounded ${step === 'name' ? 'bg-primary' : 'bg-info-bg'}`} />
          <div className={`flex-1 h-1 rounded ml-2 ${step === 'calendar' ? 'bg-primary' : 'bg-surface-2'}`} />
        </div>

        {/* Step 1: Name */}
        {step === 'name' && (
          <div>
            <FormField label="Classroom Name" required>
              <Input
                type="text"
                placeholder="Career Studies - Period 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={loading}
                autoFocus
              />
            </FormField>
          </div>
        )}

        {/* Step 2: Calendar */}
        {step === 'calendar' && (
          <div>
            <label className="block text-sm font-medium text-text-muted mb-3">
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
                    ? 'border-primary bg-info-bg'
                    : 'border-border-strong hover:border-border-strong'
                }`}
              >
                <div className="font-medium text-text-default">Semester 1</div>
                <div className="text-sm text-text-muted mt-1">
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
                    ? 'border-primary bg-info-bg'
                    : 'border-border-strong hover:border-border-strong'
                }`}
              >
                <div className="font-medium text-text-default">Semester 2</div>
                <div className="text-sm text-text-muted mt-1">
                  Feb {semester2Year} - Jun {semester2Year}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCalendarMode('custom')}
                className={`w-full p-4 rounded-lg border-2 transition ${
                  calendarMode === 'custom'
                    ? 'border-primary bg-info-bg'
                    : 'border-border-strong hover:border-border-strong'
                }`}
              >
                <div className="font-medium text-text-default">Custom Date Range</div>
              </button>
            </div>

            {calendarMode === 'custom' && (
              <div className="p-4 bg-surface-2 rounded-lg mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={startMonthId} className="block text-sm font-medium text-text-muted mb-2">Start</label>
                    <div className="flex gap-2">
                      <select
                        id={startMonthId}
                        value={startMonth}
                        onChange={(e) => setStartMonth(parseInt(e.target.value))}
                        className="flex-1 px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface text-text-default"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>
                            {format(new Date(2024, month - 1), 'MMM')}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={startYear}
                        onChange={(e) => setStartYear(parseInt(e.target.value))}
                        min={2020}
                        max={2030}
                        aria-label="Start year"
                        className="w-20 px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface text-text-default"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor={endMonthId} className="block text-sm font-medium text-text-muted mb-2">End</label>
                    <div className="flex gap-2">
                      <select
                        id={endMonthId}
                        value={endMonth}
                        onChange={(e) => setEndMonth(parseInt(e.target.value))}
                        className="flex-1 px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface text-text-default"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>
                            {format(new Date(2024, month - 1), 'MMM')}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={endYear}
                        onChange={(e) => setEndYear(parseInt(e.target.value))}
                        min={2020}
                        max={2030}
                        aria-label="End year"
                        className="w-20 px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface text-text-default"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex gap-3 mt-6 flex-shrink-0">
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
    </DialogPanel>
  )
}
