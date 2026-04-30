'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input, Button, DialogPanel, FormField, SplitButton } from '@/ui'
import { format } from 'date-fns'
import type { CourseBlueprint } from '@/types'

type WizardStep = 'name' | 'blueprint' | 'calendar'
type CalendarMode = 'preset' | 'custom'
type Semester = 'semester1' | 'semester2'
type CreationMode = 'blank' | 'blueprint'

const CHOOSE_FILE_OPTION = '__choose-file__'

interface CreateClassroomModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (classroom: any) => void
  initialBlueprintId?: string | null
}

export function CreateClassroomModal({
  isOpen,
  onClose,
  onSuccess,
  initialBlueprintId = null,
}: CreateClassroomModalProps) {
  const startMonthId = useId()
  const endMonthId = useId()
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const [step, setStep] = useState<WizardStep>('name')
  const [title, setTitle] = useState('')
  const [availableBlueprints, setAvailableBlueprints] = useState<CourseBlueprint[]>([])
  const [creationMode, setCreationMode] = useState<CreationMode>(initialBlueprintId ? 'blueprint' : 'blank')
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(initialBlueprintId || '')
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('preset')
  const [selectedSemester, setSelectedSemester] = useState<Semester>('semester1')

  // Custom date state
  const currentYear = new Date().getFullYear()
  const [startMonth, setStartMonth] = useState(9) // September
  const [startYear, setStartYear] = useState(currentYear)
  const [endMonth, setEndMonth] = useState(1) // January
  const [endYear, setEndYear] = useState(currentYear + 1)

  const [loading, setLoading] = useState(false)
  const [importingBlueprint, setImportingBlueprint] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setCreationMode(initialBlueprintId ? 'blueprint' : 'blank')
    setSelectedBlueprintId(initialBlueprintId || '')
    fetch('/api/teacher/course-blueprints')
      .then((response) => response.json().catch(() => ({})))
      .then((data) => setAvailableBlueprints((data.blueprints || []) as CourseBlueprint[]))
      .catch(() => setAvailableBlueprints([]))
  }, [initialBlueprintId, isOpen])

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
    setCreationMode(initialBlueprintId ? 'blueprint' : 'blank')
    setSelectedBlueprintId(initialBlueprintId || '')
    setCalendarMode('preset')
    setSelectedSemester('semester1')
    setError('')
  }

  function proceedFromName(nextMode: CreationMode) {
    setCreationMode(nextMode)
    if (nextMode === 'blank' && !initialBlueprintId) {
      setSelectedBlueprintId('')
      setStep('calendar')
    } else {
      setStep('blueprint')
    }
    setError('')
  }

  function proceedFromBlueprintSource() {
    setStep('calendar')
    setError('')
  }

  async function handleImportBlueprintFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportingBlueprint(true)
    setError('')

    try {
      const isJsonBundle = file.name.toLowerCase().endsWith('.json')
      const response = isJsonBundle
        ? await (async () => {
            const text = await file.text()
            const bundle = JSON.parse(text)
            return fetch('/api/teacher/course-blueprints/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bundle),
            })
          })()
        : await fetch('/api/teacher/course-blueprints/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-tar' },
            body: await file.arrayBuffer(),
          })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.errors?.join('\n') || data.error || 'Failed to import course package')
      }

      const blueprint = data.blueprint as CourseBlueprint
      setAvailableBlueprints((current) => {
        const withoutImported = current.filter((item) => item.id !== blueprint.id)
        return [blueprint, ...withoutImported]
      })
      setSelectedBlueprintId(blueprint.id)
    } catch (err: any) {
      setError(err.message || 'Failed to import course package')
    } finally {
      setImportingBlueprint(false)
      if (event.target) event.target.value = ''
    }
  }

  async function handleCreate() {
    setError('')
    setLoading(true)

    try {
      let calendarBody: any = { classroom_id: undefined }

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

      let classroom: any

      if (selectedBlueprintId) {
        const instantiateResponse = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/instantiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            semester: calendarMode === 'preset' ? calendarBody.semester : undefined,
            year: calendarMode === 'preset' ? calendarBody.year : undefined,
            start_date: calendarMode === 'custom' ? calendarBody.start_date : undefined,
            end_date: calendarMode === 'custom' ? calendarBody.end_date : undefined,
          }),
        })
        const instantiateData = await instantiateResponse.json().catch(() => ({}))
        if (!instantiateResponse.ok) {
          throw new Error(instantiateData.error || 'Failed to create classroom from blueprint')
        }
        classroom = instantiateData.classroom
      } else {
        const createResponse = await fetch('/api/teacher/classrooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })

        const createData = await createResponse.json().catch(() => ({}))

        if (!createResponse.ok) {
          throw new Error(createData.error || 'Failed to create classroom')
        }

        classroom = createData.classroom
        calendarBody.classroom_id = classroom.id

        await fetch('/api/teacher/class-days', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(calendarBody),
        })
      }

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
  const progressSteps: WizardStep[] =
    creationMode === 'blueprint' || step === 'blueprint'
      ? ['name', 'blueprint', 'calendar']
      : ['name', 'calendar']
  const canContinueFromBlueprintStep = !!selectedBlueprintId
  const isBusy = loading || importingBlueprint

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
          {progressSteps.map((progressStep, index) => {
            const currentIndex = progressSteps.indexOf(step)
            const progressIndex = progressSteps.indexOf(progressStep)
            const isActive = progressIndex === currentIndex
            const isComplete = progressIndex < currentIndex

            return (
              <div
                key={progressStep}
                className={[
                  'flex-1 h-1 rounded',
                  index === 0 ? '' : 'ml-2',
                  isActive ? 'bg-primary' : isComplete ? 'bg-info-bg' : 'bg-surface-2',
                ].join(' ')}
              />
            )
          })}
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

        {step === 'blueprint' && (
          <div>
            <input
              ref={importInputRef}
              type="file"
              accept=".tar,.json,.course-package.tar"
              className="hidden"
              aria-label="Import course package file"
              onChange={handleImportBlueprintFile}
            />
            <FormField label="Course Blueprint" required>
              <select
                value={selectedBlueprintId}
                onChange={(e) => {
                  const nextValue = e.target.value
                  if (nextValue === CHOOSE_FILE_OPTION) {
                    importInputRef.current?.click()
                    return
                  }
                  setSelectedBlueprintId(nextValue)
                  setError('')
                }}
                disabled={isBusy}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Select a course blueprint</option>
                {availableBlueprints.map((blueprint) => (
                  <option key={blueprint.id} value={blueprint.id}>
                    {blueprint.title}
                  </option>
                ))}
                <option value={CHOOSE_FILE_OPTION}>
                  {importingBlueprint ? 'Importing package...' : 'Import course package...'}
                </option>
              </select>
            </FormField>
          </div>
        )}

        {/* Final Step: Calendar */}
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
          onClick={
            step === 'name'
              ? handleClose
              : () => {
                  if (step === 'calendar') {
                    setStep(creationMode === 'blueprint' ? 'blueprint' : 'name')
                  } else {
                    setStep('name')
                  }
                  setError('')
                }
          }
          disabled={isBusy}
          className="flex-1"
        >
          {step === 'name' ? 'Cancel' : 'Back'}
        </Button>
        {step === 'name' ? (
          <SplitButton
            label="Next"
            onPrimaryClick={() => {
              if (!title) return
              proceedFromName(initialBlueprintId ? 'blueprint' : 'blank')
            }}
            options={[
              {
                id: 'from-blueprint',
                label: 'From Course Blueprint',
                onSelect: () => {
                  if (!title) return
                  proceedFromName('blueprint')
                },
              },
            ]}
            disabled={isBusy || !title}
            className="flex-1"
            size="md"
            toggleAriaLabel="Choose classroom creation path"
            menuPlacement="up"
            primaryButtonProps={{
              className: 'min-w-0 flex-1 justify-center',
            }}
          />
        ) : step === 'blueprint' ? (
          <Button
            type="button"
            onClick={proceedFromBlueprintSource}
            disabled={isBusy || !canContinueFromBlueprintStep}
            className="flex-1"
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              if (step === 'calendar') {
                handleCreate()
              }
            }}
            disabled={isBusy || (creationMode === 'blueprint' && !selectedBlueprintId)}
            className="flex-1"
          >
            {loading ? 'Creating...' : 'Create'}
          </Button>
        )}
      </div>
    </DialogPanel>
  )
}
