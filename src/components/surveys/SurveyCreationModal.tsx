'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDaysToDateString } from '@/lib/date-string'
import { AssessmentSetupCheckbox } from '@/components/assessment/AssessmentSetupForm'
import {
  ClassworkContentModalShell,
  ClassworkModalSaveStatus,
  ClassworkModalSplitAction,
  ClassworkModalSurveyDueFields,
  ClassworkModalTopLine,
} from '@/components/classwork/ClassworkContentModal'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { TeacherSurveyWorkspace } from '@/components/surveys/TeacherSurveyWorkspace'
import { useClassworkAutosave } from '@/hooks/useClassworkAutosave'
import { isGeneratedAssessmentTitle } from '@/lib/assessment-titles'
import {
  DEFAULT_SCHEDULE_TIME,
  combineScheduleDateTimeToIso,
  getTodayInSchedulingTimezone,
  isScheduleIsoInFuture,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'
import { getSurveyStatusBadgeClass, getSurveyStatusLabel } from '@/lib/surveys'
import { DialogPanel } from '@/ui'
import type { Survey, SurveyWithStats } from '@/types'

type SurveySettingsValues = {
  title: string
  showResults: boolean
  dynamicResponses: boolean
  dueDate: string
  dueTime: string
}

interface SurveyCreationModalProps {
  isOpen: boolean
  classroomId: string
  surveyId?: string | null
  survey?: Survey | null
  isReadOnly?: boolean
  initialEditMode?: 'edit' | 'markdown' | 'preview'
  autoEditTitle?: boolean
  onClose: () => void
  onDraftSaved?: (survey: Survey) => void
  onSurveyUpdated?: (survey: Survey) => void
  onQuestionCountChanged?: (surveyId: string, questionsCount: number) => void
  onSurveyDeleted?: (surveyId: string) => void
}

function getDisplayedSurveyTitle(survey: Survey | null): string {
  if (!survey) return ''
  return isGeneratedAssessmentTitle(survey.title) ? '' : survey.title
}

function getDefaultSurveyValues(): SurveySettingsValues {
  return {
    title: '',
    showResults: true,
    dynamicResponses: false,
    dueDate: addDaysToDateString(getTodayInSchedulingTimezone(), 1),
    dueTime: DEFAULT_SCHEDULE_TIME,
  }
}

function getSurveyValues(survey: Survey): SurveySettingsValues {
  const defaults = getDefaultSurveyValues()
  const due = survey.due_at ? parseScheduleIsoToParts(survey.due_at) : null

  return {
    title: getDisplayedSurveyTitle(survey),
    showResults: survey.show_results,
    dynamicResponses: survey.dynamic_responses,
    dueDate: due?.date ?? defaults.dueDate,
    dueTime: due?.time ?? defaults.dueTime,
  }
}

function getSurveyQuestionsCount(survey: Survey | null | undefined): number {
  const stats = (survey as SurveyWithStats | null | undefined)?.stats
  return stats?.questions_count ?? 0
}

function areSurveySettingsEqual(left: SurveySettingsValues, right: SurveySettingsValues): boolean {
  return left.title === right.title
    && left.showResults === right.showResults
    && left.dynamicResponses === right.dynamicResponses
    && left.dueDate === right.dueDate
    && left.dueTime === right.dueTime
}

export function SurveyCreationModal({
  isOpen,
  classroomId,
  surveyId,
  survey,
  isReadOnly = false,
  initialEditMode,
  autoEditTitle = false,
  onClose,
  onDraftSaved,
  onSurveyUpdated,
  onQuestionCountChanged,
  onSurveyDeleted,
}: SurveyCreationModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [currentSurvey, setCurrentSurvey] = useState<Survey | null>(survey ?? null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')
  const [questionsCount, setQuestionsCount] = useState(getSurveyQuestionsCount(survey))
  const [scheduleDate, setScheduleDate] = useState(getTodayInSchedulingTimezone())
  const [scheduleTime, setScheduleTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const initializedSurveyKeyRef = useRef<string | null>(null)

  const isCreateMode = !surveyId
  const activeSurveyId = surveyId ?? currentSurvey?.id ?? null

  const buildValues = useCallback((overrides?: Partial<SurveySettingsValues>): SurveySettingsValues => ({
    title,
    showResults,
    dynamicResponses,
    dueDate,
    dueTime,
    ...overrides,
  }), [dueDate, dueTime, dynamicResponses, showResults, title])

  const saveSurveySettings = useCallback(async (values: SurveySettingsValues) => {
    if (!currentSurvey) return values
    if (!values.dueDate || !values.dueTime) throw new Error('Due date is required')

    const cleanTitle = values.title.trim()
    if (!cleanTitle && !isGeneratedAssessmentTitle(currentSurvey.title)) {
      throw new Error('Title is required')
    }

    const update: Record<string, unknown> = {
      show_results: values.showResults,
      dynamic_responses: values.dynamicResponses,
      due_at: combineScheduleDateTimeToIso(values.dueDate, values.dueTime),
      due_policy: 'soft',
    }
    if (cleanTitle) {
      update.title = cleanTitle
    }

    const response = await fetch(`/api/teacher/surveys/${currentSurvey.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Failed to save survey')

    const updatedSurvey = data.survey as Survey
    const savedValues = getSurveyValues(updatedSurvey)
    setCurrentSurvey(updatedSurvey)
    onSurveyUpdated?.(updatedSurvey)
    return savedValues
  }, [currentSurvey, onSurveyUpdated])

  const {
    status: autosaveStatus,
    reset: resetAutosave,
    schedule: scheduleAutosave,
    flush: flushAutosave,
  } = useClassworkAutosave<SurveySettingsValues>({
    disabled: creatingDraft || isReadOnly || !currentSurvey,
    isEqual: areSurveySettingsEqual,
    onSave: saveSurveySettings,
    onError: setError,
  })

  useEffect(() => {
    if (!isOpen) {
      initializedSurveyKeyRef.current = null
      return
    }

    const initializationKey = isCreateMode ? 'new-survey' : surveyId ?? survey?.id ?? null
    if (!initializationKey || initializedSurveyKeyRef.current === initializationKey) return
    if (!isCreateMode && !survey) return
    initializedSurveyKeyRef.current = initializationKey

    setError('')
    setActionBusy(false)
    setShowScheduleModal(false)

    if (isCreateMode) {
      const defaults = getDefaultSurveyValues()
      setCurrentSurvey(null)
      setTitle(defaults.title)
      setShowResults(defaults.showResults)
      setDynamicResponses(defaults.dynamicResponses)
      setDueDate(defaults.dueDate)
      setDueTime(defaults.dueTime)
      setQuestionsCount(0)
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
      setCreatingDraft(!isReadOnly)
      resetAutosave(null)
    } else {
      setCreatingDraft(false)
      setQuestionsCount(getSurveyQuestionsCount(survey))
      if (survey) {
        const nextValues = getSurveyValues(survey)
        setCurrentSurvey(survey)
        setTitle(nextValues.title)
        setShowResults(nextValues.showResults)
        setDynamicResponses(nextValues.dynamicResponses)
        setDueDate(nextValues.dueDate)
        setDueTime(nextValues.dueTime)
        if (survey.opens_at && isScheduleIsoInFuture(survey.opens_at)) {
          const scheduled = parseScheduleIsoToParts(survey.opens_at)
          setScheduleDate(scheduled.date)
          setScheduleTime(scheduled.time)
        } else {
          setScheduleDate(getTodayInSchedulingTimezone())
          setScheduleTime(DEFAULT_SCHEDULE_TIME)
        }
        resetAutosave(nextValues)
      } else {
        const defaults = getDefaultSurveyValues()
        setCurrentSurvey(null)
        setTitle(defaults.title)
        setShowResults(defaults.showResults)
        setDynamicResponses(defaults.dynamicResponses)
        setDueDate(defaults.dueDate)
        setDueTime(defaults.dueTime)
        setScheduleDate(getTodayInSchedulingTimezone())
        setScheduleTime(DEFAULT_SCHEDULE_TIME)
        resetAutosave(null)
      }
    }

    setTimeout(() => {
      titleInputRef.current?.focus()
      if (autoEditTitle || isCreateMode) {
        titleInputRef.current?.select()
      }
    }, 100)
  }, [autoEditTitle, isCreateMode, isOpen, isReadOnly, resetAutosave, survey, surveyId])

  useEffect(() => {
    if (!creatingDraft || !isOpen || currentSurvey || !isCreateMode || isReadOnly) return

    async function createSurveyDraft() {
      const defaults = getDefaultSurveyValues()
      try {
        const response = await fetch('/api/teacher/surveys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroomId,
            title: '',
            show_results: defaults.showResults,
            dynamic_responses: defaults.dynamicResponses,
            due_at: combineScheduleDateTimeToIso(defaults.dueDate, defaults.dueTime),
            due_policy: 'soft',
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to create survey')

        const createdSurvey = data.survey as Survey
        setCurrentSurvey(createdSurvey)
        setTitle(getDisplayedSurveyTitle(createdSurvey))
        setShowResults(createdSurvey.show_results)
        setDynamicResponses(createdSurvey.dynamic_responses)
        resetAutosave(getSurveyValues(createdSurvey))
        onDraftSaved?.(createdSurvey)
        onSurveyUpdated?.(createdSurvey)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create survey')
        onClose()
      } finally {
        setCreatingDraft(false)
      }
    }

    void createSurveyDraft()
  }, [classroomId, creatingDraft, currentSurvey, isCreateMode, isOpen, isReadOnly, onClose, onDraftSaved, onSurveyUpdated, resetAutosave])

  function updateValues(next: Partial<SurveySettingsValues>) {
    const values = buildValues(next)
    setError('')
    scheduleAutosave(values)
  }

  async function ensureReadyToOpen() {
    if (!currentSurvey) return false
    if (!title.trim()) {
      setError('Title is required')
      titleInputRef.current?.focus()
      return false
    }
    if (questionsCount < 1) {
      setError('Add at least one question before opening the survey.')
      return false
    }
    return flushAutosave()
  }

  async function patchSurvey(update: Record<string, unknown>, options?: { closeAfter?: boolean }): Promise<boolean> {
    if (!currentSurvey || actionBusy) return false

    setActionBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/teacher/surveys/${currentSurvey.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to update survey')

      const updatedSurvey = data.survey as Survey
      setCurrentSurvey(updatedSurvey)
      onSurveyUpdated?.(updatedSurvey)
      if (options?.closeAfter) onClose()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update survey')
      return false
    } finally {
      setActionBusy(false)
    }
  }

  async function openSurveyNow() {
    const ready = await ensureReadyToOpen()
    if (!ready) return
    await patchSurvey({ status: 'active', opens_at: null }, { closeAfter: true })
  }

  function openScheduleModal() {
    if (currentSurvey?.opens_at && isScheduleIsoInFuture(currentSurvey.opens_at)) {
      const scheduled = parseScheduleIsoToParts(currentSurvey.opens_at)
      setScheduleDate(scheduled.date)
      setScheduleTime(scheduled.time)
    } else {
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
    }
    setShowScheduleModal(true)
  }

  async function scheduleSurveyOpen() {
    const ready = await ensureReadyToOpen()
    if (!ready) return
    const scheduled = await patchSurvey({
      status: 'active',
      opens_at: combineScheduleDateTimeToIso(scheduleDate, scheduleTime),
    }, { closeAfter: true })
    if (scheduled) setShowScheduleModal(false)
  }

  async function closeSurvey() {
    await patchSurvey({ status: 'closed' })
  }

  async function handleClose() {
    if (creatingDraft || actionBusy) return
    const flushed = await flushAutosave()
    if (flushed) {
      onClose()
    }
  }

  function handleWorkspaceSurveyUpdated(updatedSurvey: Survey) {
    setCurrentSurvey((previous) => {
      if (!previous || previous.id !== updatedSurvey.id) {
        const nextValues = getSurveyValues(updatedSurvey)
        setTitle(nextValues.title)
        setShowResults(nextValues.showResults)
        setDynamicResponses(nextValues.dynamicResponses)
        setDueDate(nextValues.dueDate)
        setDueTime(nextValues.dueTime)
        resetAutosave(nextValues)
      }
      return updatedSurvey
    })
    onSurveyUpdated?.(updatedSurvey)
  }

  function handleQuestionCountChanged(nextSurveyId: string, nextQuestionsCount: number) {
    setQuestionsCount(nextQuestionsCount)
    onQuestionCountChanged?.(nextSurveyId, nextQuestionsCount)
  }

  const busy = creatingDraft || actionBusy || autosaveStatus === 'saving'
  const isSurveyScheduled = currentSurvey?.status === 'active'
    && !!currentSurvey.opens_at
    && isScheduleIsoInFuture(currentSurvey.opens_at)
  const isSurveyOpen = currentSurvey?.status === 'active' && !isSurveyScheduled
  const statusBadge = currentSurvey ? (
    <span className={`rounded-badge px-2.5 py-1 text-xs font-semibold ${
      isSurveyScheduled ? 'bg-warning-bg text-warning' : getSurveyStatusBadgeClass(currentSurvey.status)
    }`}>
      {isSurveyScheduled ? 'Scheduled' : getSurveyStatusLabel(currentSurvey.status)}
    </span>
  ) : null
  const canOpenSurvey = questionsCount > 0
  const primaryActionLabel = actionBusy
    ? 'Saving...'
    : isSurveyScheduled
      ? 'Save schedule'
      : isSurveyOpen
      ? 'Close Poll'
      : 'Open Poll'

  return (
    <>
      <ClassworkContentModalShell
        isOpen={isOpen}
        onClose={() => {
          void handleClose()
        }}
        title={
          creatingDraft
            ? 'Creating Draft...'
            : isSurveyScheduled
              ? 'Edit Scheduled Survey'
              : currentSurvey
                ? 'Edit Survey'
                : 'New Survey'
        }
        titleId="survey-create-modal-title"
        closeLabel="Close survey modal"
        closeDisabled={creatingDraft || actionBusy}
        maxWidth="!max-w-6xl"
      >
        <div className="w-full space-y-4">
          <ClassworkModalTopLine
            title={title}
            titlePlaceholder="Enter survey title"
            titleError={error}
            titleDisabled={creatingDraft || isReadOnly}
            titleInputRef={titleInputRef}
            titleStatus={(
              <span className="inline-flex items-center gap-2">
                <ClassworkModalSaveStatus status={autosaveStatus} />
                {statusBadge}
              </span>
            )}
            onTitleChange={(nextTitle) => {
              setTitle(nextTitle)
              updateValues({ title: nextTitle })
            }}
            onTitleBlur={() => {
              void flushAutosave()
            }}
            meta={(
              <ClassworkModalSurveyDueFields
                dueDate={dueDate}
                dueTime={dueTime}
                disabled={creatingDraft || isReadOnly}
                onDueDateChange={(nextDate) => {
                  setDueDate(nextDate)
                  updateValues({ dueDate: nextDate })
                }}
                onDueTimeChange={(nextTime) => {
                  setDueTime(nextTime)
                  updateValues({ dueTime: nextTime })
                }}
              />
            )}
            primaryActions={currentSurvey ? (
              <ClassworkModalSplitAction
                label={primaryActionLabel}
                intent={isSurveyOpen || isSurveyScheduled ? 'primary' : 'publish'}
                disabled={busy || isReadOnly || (!isSurveyOpen && !isSurveyScheduled && !canOpenSurvey)}
                onPrimaryClick={() => {
                  if (isSurveyScheduled) {
                    void scheduleSurveyOpen()
                  } else if (isSurveyOpen) {
                    void closeSurvey()
                  } else {
                    void openSurveyNow()
                  }
                }}
                toggleAriaLabel="Choose survey action"
                options={
                  isSurveyScheduled
                    ? [
                        {
                          id: 'schedule',
                          label: 'Schedule...',
                          onSelect: openScheduleModal,
                          disabled: busy || isReadOnly || !canOpenSurvey,
                        },
                        {
                          id: 'open-now',
                          label: 'Open now',
                          onSelect: () => {
                            void openSurveyNow()
                          },
                          disabled: busy || isReadOnly || !canOpenSurvey,
                        },
                      ]
                    : isSurveyOpen
                    ? [
                        {
                          id: 'close',
                          label: 'Close poll',
                          onSelect: () => {
                            void closeSurvey()
                          },
                          disabled: busy || isReadOnly,
                        },
                      ]
                    : [
                        {
                          id: 'open-now',
                          label: 'Open now',
                          onSelect: () => {
                            void openSurveyNow()
                          },
                          disabled: busy || isReadOnly || !canOpenSurvey,
                        },
                        {
                          id: 'schedule',
                          label: 'Schedule...',
                          onSelect: openScheduleModal,
                          disabled: busy || isReadOnly || !canOpenSurvey,
                        },
                      ]
                }
                primaryButtonProps={{
                  className: 'min-w-[6.5rem]',
                }}
              />
            ) : null}
          />

          <div className="flex max-w-xl flex-col gap-3 sm:flex-row sm:flex-wrap">
            <AssessmentSetupCheckbox
              checked={showResults}
              disabled={creatingDraft || isReadOnly}
              onChange={(checked) => {
                setShowResults(checked)
                updateValues({ showResults: checked })
              }}
            >
              Show class results to students
            </AssessmentSetupCheckbox>

            <AssessmentSetupCheckbox
              checked={dynamicResponses}
              disabled={creatingDraft || isReadOnly}
              onChange={(checked) => {
                setDynamicResponses(checked)
                updateValues({ dynamicResponses: checked })
              }}
            >
              Allow students to update answers while open
            </AssessmentSetupCheckbox>
          </div>

          {activeSurveyId ? (
            <TeacherSurveyWorkspace
              classroomId={classroomId}
              surveyId={activeSurveyId}
              isReadOnly={isReadOnly}
              initialEditMode={initialEditMode ?? 'edit'}
              autoEditTitle={false}
              embedded
              hideSettingsHeader
              surveyOverride={currentSurvey}
              onBack={onClose}
              onSurveyUpdated={handleWorkspaceSurveyUpdated}
              onQuestionCountChanged={handleQuestionCountChanged}
              onSurveyDeleted={(deletedSurveyId) => {
                onSurveyDeleted?.(deletedSurveyId)
                onClose()
              }}
            />
          ) : (
            <div className="flex min-h-[16rem] items-center justify-center text-sm text-text-muted">
              Creating survey...
            </div>
          )}
        </div>
      </ClassworkContentModalShell>

      <DialogPanel
        isOpen={showScheduleModal}
        onClose={() => {
          if (actionBusy) return
          setShowScheduleModal(false)
        }}
        maxWidth="max-w-sm"
        className="p-4"
        ariaLabelledBy="survey-modal-schedule-title"
      >
        <h3 id="survey-modal-schedule-title" className="mb-2 text-sm font-semibold text-text-default">
          Schedule Survey
        </h3>
        <ScheduleDateTimePicker
          date={scheduleDate}
          time={scheduleTime}
          minDate={getTodayInSchedulingTimezone()}
          isFutureValid={
            !!scheduleDate &&
            isScheduleIsoInFuture(combineScheduleDateTimeToIso(scheduleDate, scheduleTime))
          }
          onDateChange={setScheduleDate}
          onTimeChange={setScheduleTime}
          onCancel={() => setShowScheduleModal(false)}
          onConfirm={() => {
            void scheduleSurveyOpen()
          }}
          confirmLabel={actionBusy ? 'Scheduling...' : 'Schedule'}
          dateLabel="Open date"
          timeLabel="Open time"
          showHeader={false}
          showTimezoneLabel={false}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </DialogPanel>
    </>
  )
}
