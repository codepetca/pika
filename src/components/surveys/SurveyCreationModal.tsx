'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDaysToDateString } from '@/lib/date-string'
import { AssessmentSetupCheckbox } from '@/components/assessment/AssessmentSetupForm'
import {
  ClassworkContentModalShell,
  ClassworkModalPrimaryButton,
  ClassworkModalSaveStatus,
  ClassworkModalSurveyDueFields,
  ClassworkModalTopLine,
} from '@/components/classwork/ClassworkContentModal'
import { useClassworkAutosave } from '@/hooks/useClassworkAutosave'
import { isGeneratedAssessmentTitle } from '@/lib/assessment-titles'
import {
  DEFAULT_SCHEDULE_TIME,
  combineScheduleDateTimeToIso,
  getTodayInSchedulingTimezone,
} from '@/lib/scheduling'
import type { Survey, SurveyDuePolicy } from '@/types'

type SurveySettingsValues = {
  title: string
  showResults: boolean
  dynamicResponses: boolean
  dueDate: string
  dueTime: string
  duePolicy: SurveyDuePolicy
}

interface SurveyCreationModalProps {
  isOpen: boolean
  classroomId: string
  onClose: () => void
  onDraftSaved?: (survey: Survey) => void
  onSuccess: (survey: Survey) => void
}

function getDisplayedSurveyTitle(survey: Survey | null): string {
  if (!survey) return ''
  return isGeneratedAssessmentTitle(survey.title) ? '' : survey.title
}

function areSurveySettingsEqual(left: SurveySettingsValues, right: SurveySettingsValues): boolean {
  return left.title === right.title
    && left.showResults === right.showResults
    && left.dynamicResponses === right.dynamicResponses
    && left.dueDate === right.dueDate
    && left.dueTime === right.dueTime
    && left.duePolicy === right.duePolicy
}

function getDefaultSurveyValues(): SurveySettingsValues {
  return {
    title: '',
    showResults: true,
    dynamicResponses: false,
    dueDate: addDaysToDateString(getTodayInSchedulingTimezone(), 1),
    dueTime: DEFAULT_SCHEDULE_TIME,
    duePolicy: 'soft',
  }
}

export function SurveyCreationModal({
  isOpen,
  classroomId,
  onClose,
  onDraftSaved,
  onSuccess,
}: SurveyCreationModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [currentSurvey, setCurrentSurvey] = useState<Survey | null>(null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [duePolicy, setDuePolicy] = useState<SurveyDuePolicy>('soft')
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [error, setError] = useState('')

  const buildValues = useCallback((overrides?: Partial<SurveySettingsValues>): SurveySettingsValues => ({
    title,
    showResults,
    dynamicResponses,
    dueDate,
    dueTime,
    duePolicy,
    ...overrides,
  }), [dueDate, duePolicy, dueTime, dynamicResponses, showResults, title])

  const saveSurveySettings = useCallback(async (values: SurveySettingsValues) => {
    if (!currentSurvey) return values
    if (!values.dueDate || !values.dueTime) throw new Error('Due date is required')

    const update: Record<string, unknown> = {
      show_results: values.showResults,
      dynamic_responses: values.dynamicResponses,
      due_at: combineScheduleDateTimeToIso(values.dueDate, values.dueTime),
      due_policy: values.duePolicy,
    }
    const cleanTitle = values.title.trim()
    if (cleanTitle) {
      update.title = cleanTitle
    } else if (!isGeneratedAssessmentTitle(currentSurvey.title)) {
      throw new Error('Title is required')
    }

    const response = await fetch(`/api/teacher/surveys/${currentSurvey.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Failed to save survey')

    const updatedSurvey = data.survey as Survey
    setCurrentSurvey(updatedSurvey)
    onDraftSaved?.(updatedSurvey)
    return {
      title: getDisplayedSurveyTitle(updatedSurvey),
      showResults: updatedSurvey.show_results,
      dynamicResponses: updatedSurvey.dynamic_responses,
      dueDate: values.dueDate,
      dueTime: values.dueTime,
      duePolicy: updatedSurvey.due_policy ?? values.duePolicy,
    }
  }, [currentSurvey, onDraftSaved])

  const {
    status: autosaveStatus,
    reset: resetAutosave,
    schedule: scheduleAutosave,
    flush: flushAutosave,
  } = useClassworkAutosave<SurveySettingsValues>({
    disabled: creatingDraft || !currentSurvey,
    isEqual: areSurveySettingsEqual,
    onSave: saveSurveySettings,
    onError: setError,
  })

  useEffect(() => {
    if (!isOpen) return

    const defaults = getDefaultSurveyValues()
    setCurrentSurvey(null)
    setTitle(defaults.title)
    setShowResults(defaults.showResults)
    setDynamicResponses(defaults.dynamicResponses)
    setDueDate(defaults.dueDate)
    setDueTime(defaults.dueTime)
    setDuePolicy(defaults.duePolicy)
    setError('')
    setCreatingDraft(true)
    resetAutosave(null)

    setTimeout(() => {
      titleInputRef.current?.focus()
    }, 100)
  }, [isOpen, resetAutosave])

  useEffect(() => {
    if (!creatingDraft || !isOpen || currentSurvey) return

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
            due_policy: defaults.duePolicy,
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to create survey')

        const survey = data.survey as Survey
        setCurrentSurvey(survey)
        onDraftSaved?.(survey)
        resetAutosave(defaults)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create survey')
        onClose()
      } finally {
        setCreatingDraft(false)
      }
    }

    void createSurveyDraft()
  }, [classroomId, creatingDraft, currentSurvey, isOpen, onClose, onDraftSaved, resetAutosave])

  function updateValues(next: Partial<SurveySettingsValues>) {
    const values = buildValues(next)
    setError('')
    scheduleAutosave(values)
  }

  async function continueToEditor() {
    if (!currentSurvey) return
    if (!title.trim()) {
      setError('Title is required')
      titleInputRef.current?.focus()
      return
    }

    const flushed = await flushAutosave()
    if (!flushed) return
    onSuccess(currentSurvey)
    onClose()
  }

  async function handleClose() {
    if (creatingDraft) return
    const flushed = await flushAutosave()
    if (flushed) {
      onClose()
    }
  }

  const busy = creatingDraft || autosaveStatus === 'saving'

  return (
    <ClassworkContentModalShell
      isOpen={isOpen}
      onClose={() => {
        void handleClose()
      }}
      title={creatingDraft ? 'Creating Draft...' : 'New Survey'}
      titleId="survey-create-modal-title"
      closeLabel="Close survey modal"
      closeDisabled={creatingDraft}
      maxWidth="!max-w-5xl"
    >
      <div className="w-full space-y-4">
        <ClassworkModalTopLine
          title={title}
          titlePlaceholder="Enter survey title"
          titleError={error}
          titleDisabled={creatingDraft}
          titleInputRef={titleInputRef}
          titleStatus={<ClassworkModalSaveStatus status={autosaveStatus} />}
          onTitleChange={(nextTitle) => {
            setTitle(nextTitle)
            updateValues({ title: nextTitle })
          }}
          meta={(
            <ClassworkModalSurveyDueFields
              dueDate={dueDate}
              dueTime={dueTime}
              duePolicy={duePolicy}
              disabled={creatingDraft}
              onDueDateChange={(nextDate) => {
                setDueDate(nextDate)
                updateValues({ dueDate: nextDate })
              }}
              onDueTimeChange={(nextTime) => {
                setDueTime(nextTime)
                updateValues({ dueTime: nextTime })
              }}
              onDuePolicyChange={(nextPolicy) => {
                setDuePolicy(nextPolicy)
                updateValues({ duePolicy: nextPolicy })
              }}
            />
          )}
          primaryActions={(
            <ClassworkModalPrimaryButton
              disabled={busy || !currentSurvey}
              onClick={() => {
                void continueToEditor()
              }}
            >
              Edit Survey
            </ClassworkModalPrimaryButton>
          )}
        />

        <div className="max-w-xl space-y-4">
          <AssessmentSetupCheckbox
            checked={showResults}
            disabled={creatingDraft}
            onChange={(checked) => {
              setShowResults(checked)
              updateValues({ showResults: checked })
            }}
          >
            Show class results to students
          </AssessmentSetupCheckbox>

          <AssessmentSetupCheckbox
            checked={dynamicResponses}
            disabled={creatingDraft}
            onChange={(checked) => {
              setDynamicResponses(checked)
              updateValues({ dynamicResponses: checked })
            }}
          >
            Allow students to update answers while open
          </AssessmentSetupCheckbox>
        </div>
      </div>
    </ClassworkContentModalShell>
  )
}
