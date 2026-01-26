'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button, ConfirmDialog, AlertDialog, Tooltip } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useDeleteClassroom } from '@/hooks/useDeleteClassroom'
import type { ClassDay, Classroom } from '@/types'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  parseISO
} from 'date-fns'
import { getTodayInToronto } from '@/lib/timezone'

type WizardMode = 'preset' | 'custom'

export default function CalendarPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingCalendar, setLoadingCalendar] = useState(false)
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [generating, setGenerating] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Wizard state
  const [wizardMode, setWizardMode] = useState<WizardMode>('preset')
  const [selectedPreset, setSelectedPreset] = useState<'semester1' | 'semester2' | null>(null)

  // Custom date state - default to September of current year to January of next year
  const currentYear = new Date().getFullYear()
  const [startMonth, setStartMonth] = useState(9) // September
  const [startYear, setStartYear] = useState(currentYear)
  const [endMonth, setEndMonth] = useState(1) // January
  const [endYear, setEndYear] = useState(currentYear + 1)

  const { alertState, showError, showSuccess, closeAlert } = useAlertDialog()

  const handleDeleteSuccess = useCallback((deletedId: string) => {
    const updatedClassrooms = classrooms.filter(c => c.id !== deletedId)
    setClassrooms(updatedClassrooms)
    setSelectedClassroom(updatedClassrooms.length > 0 ? updatedClassrooms[0] : null)
    showSuccess('Deleted', 'Classroom deleted successfully')
  }, [classrooms, showSuccess])

  const handleDeleteError = useCallback((message: string) => {
    showError('Error', message)
  }, [showError])

  const { requestDelete, confirmDialogProps } = useDeleteClassroom({
    onSuccess: handleDeleteSuccess,
    onError: handleDeleteError,
  })

  // Helper function to calculate semester years based on current date
  function getSemesterYears() {
    const now = new Date()
    const currentMonth = now.getMonth() + 1 // 1-12
    const currentYear = now.getFullYear()

    let semester1Year: number
    let semester2Year: number

    if (currentMonth >= 9 || currentMonth <= 1) {
      // Currently in Semester 1 (Sep-Jan)
      if (currentMonth >= 9) {
        // Sep-Dec: current academic year
        semester1Year = currentYear
        semester2Year = currentYear + 1
      } else {
        // Jan: academic year started prev year
        semester1Year = currentYear - 1
        semester2Year = currentYear
      }
    } else if (currentMonth >= 2 && currentMonth <= 6) {
      // Currently in Semester 2 (Feb-Jun)
      semester1Year = currentYear
      semester2Year = currentYear
    } else {
      // July-August (summer): upcoming academic year
      semester1Year = currentYear
      semester2Year = currentYear + 1
    }

    return { semester1Year, semester2Year }
  }

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

  const loadClassDays = useCallback(async () => {
    const classroomId = selectedClassroom?.id
    if (!classroomId) return

    setLoadingCalendar(true)
    try {
      const response = await fetch(`/api/classrooms/${classroomId}/class-days`)
      const data = await response.json()
      setClassDays(data.class_days || [])
    } catch (err) {
      console.error('Error loading class days:', err)
    } finally {
      setLoadingCalendar(false)
    }
  }, [selectedClassroom?.id])

  // Load calendar when classroom selected
  useEffect(() => {
    if (!selectedClassroom) {
      setClassDays([])
      return
    }

    loadClassDays()
  }, [selectedClassroom, loadClassDays])

  async function handleGenerate() {
    if (!selectedClassroom) return

    setGenerating(true)
    try {
      let body: any = { classroom_id: selectedClassroom.id }

      if (wizardMode === 'preset' && selectedPreset) {
        // Use semester preset with calculated year
        const { semester1Year, semester2Year } = getSemesterYears()
        const year = selectedPreset === 'semester1' ? semester1Year : semester2Year
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

      const response = await fetch(`/api/classrooms/${selectedClassroom.id}/class-days`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        // Refresh classroom list to pick up start/end date updates.
        const classroomsRes = await fetch('/api/teacher/classrooms')
        const classroomsData = await classroomsRes.json()
        const nextClassrooms: Classroom[] = classroomsData.classrooms || []
        setClassrooms(nextClassrooms)
        const refreshed = nextClassrooms.find(c => c.id === selectedClassroom.id) ?? null
        if (refreshed) setSelectedClassroom(refreshed)
        await loadClassDays()
      } else {
        const data = await response.json()
        showError('Error', data.error || 'Failed to generate calendar')
      }
    } catch (err) {
      console.error('Error generating calendar:', err)
      showError('Error', 'An error occurred')
    } finally {
      setGenerating(false)
    }
  }

  async function toggleClassDay(date: string, currentValue: boolean) {
    if (!selectedClassroom) return

    try {
      const response = await fetch(`/api/classrooms/${selectedClassroom.id}/class-days`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

  function handleClassroomCreated(classroom: Classroom) {
    setClassrooms([classroom, ...classrooms])
    setSelectedClassroom(classroom)
  }

  function handleDeleteClassroom() {
    if (!selectedClassroom) return
    requestDelete(selectedClassroom)
  }

  function renderWizard() {
    // Calculate semester date ranges based on current date
    const { semester1Year, semester2Year } = getSemesterYears()

    return (
      <div className="bg-white rounded-lg shadow-sm p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Create Calendar
        </h2>

        {/* Quick Select Buttons */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                setWizardMode('preset')
                setSelectedPreset('semester1')
              }}
              className={`px-6 py-4 rounded-lg border-2 transition-all text-left ${
                wizardMode === 'preset' && selectedPreset === 'semester1'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <div className="font-medium">Semester 1</div>
              <div className="text-sm text-gray-600 mt-1">
                Sep {semester1Year} - Jan {semester1Year + 1}
              </div>
            </button>
            <button
              onClick={() => {
                setWizardMode('preset')
                setSelectedPreset('semester2')
              }}
              className={`px-6 py-4 rounded-lg border-2 transition-all text-left ${
                wizardMode === 'preset' && selectedPreset === 'semester2'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <div className="font-medium">Semester 2</div>
              <div className="text-sm text-gray-600 mt-1">
                Feb {semester2Year} - Jun {semester2Year}
              </div>
            </button>
            <button
              onClick={() => setWizardMode('custom')}
              className={`px-6 py-4 rounded-lg border-2 transition-all ${
                wizardMode === 'custom'
                  ? 'border-blue-500 bg-blue-50 text-blue-900 font-medium'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <div className="font-medium">Custom</div>
            </button>
          </div>
        </div>

        {/* Custom Date Selection */}
        {wizardMode === 'custom' && (
          <div className="mb-6 p-6 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start
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
                  End
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
    if (!selectedClassroom) return null
    if (classDays.length === 0) return null

    // Prefer classroom range; fall back to class days range.
    const dates = classDays.map(d => parseISO(d.date))
    const minFromDays = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxFromDays = new Date(Math.max(...dates.map(d => d.getTime())))

    const rangeStart = selectedClassroom.start_date ? parseISO(selectedClassroom.start_date) : minFromDays
    const rangeEnd = selectedClassroom.end_date ? parseISO(selectedClassroom.end_date) : maxFromDays
    const rangeStartStr = format(rangeStart, 'yyyy-MM-dd')
    const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd')

    // Generate array of months to display
    const months: Date[] = []
    let current = startOfMonth(rangeStart)
    const end = startOfMonth(rangeEnd)

    while (current <= end) {
      months.push(current)
      current = addMonths(current, 1)
    }

    const classDayMap = new Map<string, ClassDay>()
    classDays.forEach(day => classDayMap.set(day.date, day))
    const todayToronto = getTodayInToronto()

    return (
      <div>
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
                    const isBeforeToday = dateString < todayToronto
                    const isInRange = dateString >= rangeStartStr && dateString <= rangeEndStr
                    const disabled = !isInRange || isBeforeToday

                    const colorClasses = disabled
                      ? 'bg-gray-100 text-gray-400'
                      : isClassDay
                        ? 'bg-green-100 text-green-900 hover:bg-green-200'
                        : classDay
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : isWeekend
                            ? 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                            : 'bg-red-50 text-red-700 hover:bg-red-100'

                    return (
                      <button
                        key={dateString}
                        onClick={() => toggleClassDay(dateString, isClassDay)}
                        className={`
                          aspect-square p-1 rounded text-xs font-medium transition-colors
                          ${colorClasses}
                          ${disabled ? 'cursor-not-allowed' : ''}
                        `}
                        disabled={disabled}
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

  // Empty state - no classrooms
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
        <div className="bg-surface rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-default">Classes</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-primary hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
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
                    : 'hover:bg-surface-hover border-transparent'
                }`}
              >
                <button
                  onClick={() => setSelectedClassroom(classroom)}
                  className="w-full text-left"
                >
                  <div className="font-medium text-text-default text-sm pr-6">
                    {classroom.title}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {classroom.class_code}
                  </div>
                </button>
                <Tooltip content="Delete classroom">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      requestDelete(classroom)
                    }}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </Tooltip>
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
                    {' • '}
                    {classDays.filter(d => d.is_class_day).length} class days
                  </div>
                </div>
              }
              actions={
                [
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
              {loadingCalendar ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
              ) : classDays.length === 0 ? (
                renderWizard()
              ) : (
                renderCompactCalendar()
              )}
            </PageContent>
          </PageLayout>
        ) : (
          <div className="bg-surface rounded-lg shadow-sm p-8 text-center text-text-muted">
            Select a class to manage its calendar
          </div>
        )}
      </div>

      <CreateClassroomModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleClassroomCreated}
      />

      <ConfirmDialog {...confirmDialogProps} />

      <AlertDialog {...alertState} onClose={closeAlert} />
    </div>
  )
}
