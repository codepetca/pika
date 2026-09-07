'use client'

import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Button, DialogPanel, FormField, SplitButton } from '@/ui'
import { format, parseISO } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import type { CourseBlueprint } from '@/types'
import { invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'
import { getDefaultClassroomEndDate } from '@/lib/calendar'
import { addDaysToDateString } from '@/lib/date-string'
import { fetchTeacherBlueprints, invalidateTeacherBlueprints } from '@/lib/teacher-blueprints-client'
import {
  courseBlueprintImportRequestInit,
  resolveCourseBlueprintImportOperation,
  type CourseBlueprintImportOperation,
} from '@/lib/course-blueprint-import-client'

type WizardStep = 'name' | 'blueprint' | 'calendar' | 'review'
type CreationMode = 'blank' | 'blueprint'

const CHOOSE_FILE_OPTION = '__choose-file__'

type ReadableCalendarInputProps = {
  value: string
  min?: string
  disabled?: boolean
  onChange: (value: string) => void
} & Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'required' | 'aria-required' | 'aria-invalid' | 'aria-describedby' | 'aria-errormessage' | 'aria-labelledby'
>

const ReadableCalendarInput = forwardRef<HTMLInputElement, ReadableCalendarInputProps>(
  ({ value, min, disabled, onChange, ...accessibilityProps }, ref) => {
    const readableValue = value ? format(parseISO(value), 'MMMM d, yyyy') : ''

    return (
      <div className="relative">
        <Input
          {...accessibilityProps}
          ref={ref}
          type="date"
          value={value}
          min={min}
          onChange={(event) => onChange(event.target.value)}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker?.()
            } catch {
              // The native input remains the full-size click target even when a
              // browser does not allow showPicker to be called explicitly.
            }
          }}
          disabled={disabled}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <Input
          type="text"
          value={readableValue}
          placeholder="Choose a date"
          readOnly
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none pr-10 peer-focus-visible:border-primary peer-focus-visible:ring-foundation peer-focus-visible:ring-focus"
        />
        <CalendarDays
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
      </div>
    )
  },
)

ReadableCalendarInput.displayName = 'ReadableCalendarInput'

type BlueprintCreationResult = {
  classroom: any
  overflowLessonTemplates: string[]
}

interface CreateClassroomModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (classroom: any) => void
  onBlueprintCreated?: (classroom: any) => void
  initialBlueprintId?: string | null
}

export function CreateClassroomModal({
  isOpen,
  onClose,
  onSuccess,
  onBlueprintCreated,
  initialBlueprintId = null,
}: CreateClassroomModalProps) {
  const router = useRouter()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const calendarStepRef = useRef<HTMLDivElement | null>(null)
  const blueprintLoadGenerationRef = useRef(0)
  const importInFlightRef = useRef(false)
  const importOperationRef = useRef<CourseBlueprintImportOperation | null>(null)
  const instantiateOperationRef = useRef<{ fingerprint: string; id: string } | null>(null)

  const [step, setStep] = useState<WizardStep>('name')
  const [title, setTitle] = useState('')
  const [availableBlueprints, setAvailableBlueprints] = useState<CourseBlueprint[]>([])
  const [creationMode, setCreationMode] = useState<CreationMode>(initialBlueprintId ? 'blueprint' : 'blank')
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(initialBlueprintId || '')
  const [firstClassDate, setFirstClassDate] = useState('')
  const [lastClassDate, setLastClassDate] = useState('')

  const [loading, setLoading] = useState(false)
  const [importingBlueprint, setImportingBlueprint] = useState(false)
  const [error, setError] = useState('')
  const [blueprintCreationResult, setBlueprintCreationResult] = useState<BlueprintCreationResult | null>(null)

  useEffect(() => {
    if (!isOpen) return
    let isCurrent = true
    const loadGeneration = blueprintLoadGenerationRef.current + 1
    blueprintLoadGenerationRef.current = loadGeneration
    setCreationMode(initialBlueprintId ? 'blueprint' : 'blank')
    setSelectedBlueprintId(initialBlueprintId || '')
    fetchTeacherBlueprints()
      .then((blueprints) => {
        if (isCurrent && blueprintLoadGenerationRef.current === loadGeneration) setAvailableBlueprints(blueprints)
      })
      .catch(() => {
        if (isCurrent && blueprintLoadGenerationRef.current === loadGeneration) setAvailableBlueprints([])
      })
    return () => {
      isCurrent = false
    }
  }, [initialBlueprintId, isOpen])

  useEffect(() => {
    if (step === 'review') reviewHeadingRef.current?.focus()
    if (step === 'name') nameInputRef.current?.focus()
    if (step === 'calendar') calendarStepRef.current?.focus()
  }, [step])

  function resetForm() {
    setStep('name')
    setTitle('')
    setCreationMode(initialBlueprintId ? 'blueprint' : 'blank')
    setSelectedBlueprintId(initialBlueprintId || '')
    setFirstClassDate('')
    setLastClassDate('')
    setError('')
    setBlueprintCreationResult(null)
    importOperationRef.current = null
    instantiateOperationRef.current = null
  }

  function showCalendarStep() {
    setStep('calendar')
  }

  function proceedFromName(nextMode: CreationMode) {
    setCreationMode(nextMode)
    if (nextMode === 'blank' && !initialBlueprintId) {
      setSelectedBlueprintId('')
      showCalendarStep()
    } else if (initialBlueprintId) {
      showCalendarStep()
    } else {
      setStep('blueprint')
    }
    setError('')
  }

  function proceedFromBlueprintSource() {
    showCalendarStep()
    setError('')
  }

  async function handleImportBlueprintFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (importInFlightRef.current) {
      event.target.value = ''
      return
    }
    importInFlightRef.current = true
    setImportingBlueprint(true)
    setError('')

    try {
      const operation = await resolveCourseBlueprintImportOperation(file, importOperationRef.current)
      importOperationRef.current = operation
      const response = await fetch(
        '/api/teacher/course-blueprints/import',
        courseBlueprintImportRequestInit(operation),
      )

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.errors?.join('\n') || data.error || 'Failed to import course package')
      }

      const blueprint = data.blueprint as CourseBlueprint
      importOperationRef.current = null
      invalidateTeacherBlueprints()
      blueprintLoadGenerationRef.current += 1
      setAvailableBlueprints((current) => {
        const withoutImported = current.filter((item) => item.id !== blueprint.id)
        return [blueprint, ...withoutImported]
      })
      setSelectedBlueprintId(blueprint.id)
    } catch (err: any) {
      setError(err.message || 'Failed to import course package')
    } finally {
      importInFlightRef.current = false
      setImportingBlueprint(false)
      if (event.target) event.target.value = ''
    }
  }

  async function handleCreate() {
    setError('')
    setLoading(true)

    try {
      const calendarBody = {
        classroom_id: undefined as string | undefined,
        start_date: firstClassDate,
        end_date: lastClassDate,
      }

      if (!firstClassDate || !lastClassDate || lastClassDate <= firstClassDate) {
        throw new Error('Choose a last day of class after the first day')
      }

      let classroom: any

      if (selectedBlueprintId) {
        const requestBody = {
          title,
          start_date: calendarBody.start_date,
          end_date: calendarBody.end_date,
        }
        const fingerprint = JSON.stringify({ blueprintId: selectedBlueprintId, requestBody })
        if (instantiateOperationRef.current?.fingerprint !== fingerprint) {
          instantiateOperationRef.current = { fingerprint, id: crypto.randomUUID() }
        }
        const instantiateResponse = await fetch(`/api/teacher/course-blueprints/${selectedBlueprintId}/instantiate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': instantiateOperationRef.current.id,
          },
          body: JSON.stringify(requestBody),
        })
        const instantiateData = await instantiateResponse.json().catch(() => ({}))
        if (!instantiateResponse.ok) {
          throw new Error(instantiateData.error || 'Failed to create classroom from blueprint')
        }
        classroom = instantiateData.classroom
        instantiateOperationRef.current = null
        invalidateTeacherBlueprints()
        invalidateTeacherClassrooms()
        onBlueprintCreated?.(classroom)
        setBlueprintCreationResult({
          classroom,
          overflowLessonTemplates: Array.isArray(instantiateData.lesson_mapping?.overflow_lesson_templates)
            ? instantiateData.lesson_mapping.overflow_lesson_templates
            : [],
        })
        setStep('review')
        return
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
        try {
          const calendarResponse = await fetch('/api/teacher/class-days', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(calendarBody),
          })
          if (!calendarResponse.ok) {
            const calendarData = await calendarResponse.json().catch(() => ({}))
            throw new Error(calendarData.error || 'Failed to set up class days')
          }
        } catch {
          // The classroom already exists. Finish opening it so the persistent
          // setup prompt can safely guide the teacher to retry without creating
          // a duplicate classroom.
        }
      }

      invalidateTeacherClassrooms()
      onSuccess(classroom)
      resetForm()
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  function finishBlueprintCreation(openForReview: boolean) {
    if (!blueprintCreationResult) return
    const { classroom } = blueprintCreationResult
    resetForm()
    onClose()
    if (openForReview) {
      router.push(`/classrooms/${classroom.id}?tab=assignments&reviewClassDays=1`)
    }
  }

  function handleClose() {
    if (loading || importingBlueprint) return
    if (blueprintCreationResult) return finishBlueprintCreation(false)
    resetForm()
    onClose()
  }

  const requiresBlueprintSelection = creationMode === 'blueprint' && !initialBlueprintId
  const progressSteps: WizardStep[] =
    requiresBlueprintSelection || step === 'blueprint'
      ? ['name', 'blueprint', 'calendar']
      : ['name', 'calendar']
  const currentProgressIndex = step === 'review' ? progressSteps.length : progressSteps.indexOf(step)
  const canContinueFromBlueprintStep = !!selectedBlueprintId
  const isBusy = loading || importingBlueprint
  const minimumLastClassDate = firstClassDate
    ? addDaysToDateString(firstClassDate, 1)
    : undefined
  const hasValidClassDateRange = Boolean(
    firstClassDate && lastClassDate && lastClassDate > firstClassDate,
  )
  const lastClassDateError = firstClassDate && lastClassDate && !hasValidClassDateRange
    ? 'Last day of class must be after the first day.'
    : undefined

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-lg"
      className="p-6"
      ariaLabelledBy="create-classroom-title"
    >
      <h2
        ref={reviewHeadingRef}
        id="create-classroom-title"
        tabIndex={step === 'review' ? -1 : undefined}
        className="text-xl font-bold text-text-default mb-4 flex-shrink-0 focus:outline-none"
      >
        {step === 'review' ? 'Classroom Created' : 'Create Classroom'}
      </h2>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Progress Indicator */}
        <div className="flex items-center mb-6">
          {progressSteps.map((progressStep, index) => {
            const progressIndex = progressSteps.indexOf(progressStep)
            const isActive = progressIndex === currentProgressIndex
            const isComplete = progressIndex < currentProgressIndex

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
                ref={nameInputRef}
                type="text"
                placeholder="Career Studies - Period 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={loading}
                data-modal-initial-focus
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

        {/* Final Step: Class days */}
        {step === 'calendar' && (
          <div
            ref={calendarStepRef}
            role="group"
            aria-label="Choose class dates"
            tabIndex={-1}
            className="space-y-4 focus:outline-none"
          >
            <FormField label="First day of class">
              <ReadableCalendarInput
                value={firstClassDate}
                aria-required="true"
                onChange={(nextFirstClassDate) => {
                  setFirstClassDate(nextFirstClassDate)
                  setLastClassDate(getDefaultClassroomEndDate(nextFirstClassDate))
                  setError('')
                }}
                disabled={isBusy}
              />
            </FormField>

            {firstClassDate ? (
              <FormField
                label="Last day of class"
                hint="You can modify this later in Settings."
                error={lastClassDateError}
              >
                <ReadableCalendarInput
                  value={lastClassDate}
                  min={minimumLastClassDate}
                  aria-required="true"
                  onChange={(nextLastClassDate) => {
                    setLastClassDate(nextLastClassDate)
                    setError('')
                  }}
                  disabled={isBusy}
                />
              </FormField>
            ) : null}
          </div>
        )}

        {step === 'review' && blueprintCreationResult && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-text-default">Classroom ready for review</h3>
              <p className="mt-1 text-sm text-text-muted">
                Assignments and tests are unpublished. Review their due dates and release settings before sharing classwork with students.
              </p>
            </div>

            {blueprintCreationResult.overflowLessonTemplates.length > 0 ? (
              <div className="rounded-md border border-warning bg-warning-bg px-4 py-3 text-sm text-text-default">
                <p className="font-medium">
                  {blueprintCreationResult.overflowLessonTemplates.length} lesson {blueprintCreationResult.overflowLessonTemplates.length === 1 ? 'plan was' : 'plans were'} not scheduled
                </p>
                <p className="mt-1 text-text-muted">
                  The selected calendar did not have enough class days. Add dates or schedule these lesson plans manually:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {blueprintCreationResult.overflowLessonTemplates.map((lessonTitle, index) => (
                    <li key={`${lessonTitle}-${index}`}>{lessonTitle}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
                All blueprint lesson plans fit within the selected classroom calendar.
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
        {step !== 'review' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={
              step === 'name'
                ? handleClose
                : () => {
                    if (step === 'calendar') {
                      setStep(requiresBlueprintSelection ? 'blueprint' : 'name')
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
        ) : null}
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
        ) : step === 'calendar' ? (
          <Button
            type="button"
            onClick={() => {
              if (step === 'calendar') {
                handleCreate()
              }
            }}
            disabled={
              isBusy ||
              (creationMode === 'blueprint' && !selectedBlueprintId) ||
              !hasValidClassDateRange
            }
            className="flex-1"
          >
            {loading ? 'Creating...' : 'Create'}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => finishBlueprintCreation(true)}
            className="flex-1"
          >
            Review Classroom
          </Button>
        )}
      </div>
    </DialogPanel>
  )
}
