'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDaysToDateString } from '@/lib/date-string'
import { AssessmentSetupCheckbox } from '@/components/assessment/AssessmentSetupForm'
import {
  ClassworkContentModalShell,
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
  parseScheduleIsoToParts,
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

interface SurveyModalProps {
  isOpen: boolean
  survey: Survey
  onClose: () => void
  onSuccess: (survey: Survey) => void
}

function getDisplayedSurveyTitle(survey: Survey): string {
  return isGeneratedAssessmentTitle(survey.title) ? '' : survey.title
}

function getSurveyValues(survey: Survey): SurveySettingsValues {
  const due = survey.due_at
    ? parseScheduleIsoToParts(survey.due_at)
    : {
        date: addDaysToDateString(getTodayInSchedulingTimezone(), 1),
        time: DEFAULT_SCHEDULE_TIME,
      }

  return {
    title: getDisplayedSurveyTitle(survey),
    showResults: survey.show_results,
    dynamicResponses: survey.dynamic_responses,
    dueDate: due.date,
    dueTime: due.time,
    duePolicy: survey.due_policy ?? 'soft',
  }
}

function areSurveySettingsEqual(left: SurveySettingsValues, right: SurveySettingsValues): boolean {
  return left.title === right.title
    && left.showResults === right.showResults
    && left.dynamicResponses === right.dynamicResponses
    && left.dueDate === right.dueDate
    && left.dueTime === right.dueTime
    && left.duePolicy === right.duePolicy
}

export function SurveyModal({
  isOpen,
  survey,
  onClose,
  onSuccess,
}: SurveyModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [currentSurvey, setCurrentSurvey] = useState(survey)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [duePolicy, setDuePolicy] = useState<SurveyDuePolicy>('soft')
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
    if (!values.dueDate || !values.dueTime) throw new Error('Due date is required')

    const cleanTitle = values.title.trim()
    if (!cleanTitle && !isGeneratedAssessmentTitle(currentSurvey.title)) {
      throw new Error('Title is required')
    }

    const update: Record<string, unknown> = {
      show_results: values.showResults,
      dynamic_responses: values.dynamicResponses,
      due_at: combineScheduleDateTimeToIso(values.dueDate, values.dueTime),
      due_policy: values.duePolicy,
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
    setCurrentSurvey(updatedSurvey)
    onSuccess(updatedSurvey)
    return {
      title: getDisplayedSurveyTitle(updatedSurvey),
      showResults: updatedSurvey.show_results,
      dynamicResponses: updatedSurvey.dynamic_responses,
      dueDate: values.dueDate,
      dueTime: values.dueTime,
      duePolicy: updatedSurvey.due_policy ?? values.duePolicy,
    }
  }, [currentSurvey, onSuccess])

  const {
    status: autosaveStatus,
    reset: resetAutosave,
    schedule: scheduleAutosave,
    flush: flushAutosave,
  } = useClassworkAutosave<SurveySettingsValues>({
    isEqual: areSurveySettingsEqual,
    onSave: saveSurveySettings,
    onError: setError,
  })

  useEffect(() => {
    if (!isOpen) return

    const values = getSurveyValues(survey)
    setCurrentSurvey(survey)
    setTitle(values.title)
    setShowResults(values.showResults)
    setDynamicResponses(values.dynamicResponses)
    setDueDate(values.dueDate)
    setDueTime(values.dueTime)
    setDuePolicy(values.duePolicy)
    setError('')
    resetAutosave(values)

    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 100)
  }, [isOpen, resetAutosave, survey])

  function updateValues(next: Partial<SurveySettingsValues>) {
    const values = buildValues(next)
    setError('')
    scheduleAutosave(values)
  }

  async function handleClose() {
    const flushed = await flushAutosave()
    if (flushed) {
      onClose()
    }
  }

  return (
    <ClassworkContentModalShell
      isOpen={isOpen}
      onClose={() => {
        void handleClose()
      }}
      title="Edit Survey"
      titleId="survey-modal-title"
      closeLabel="Close survey modal"
      maxWidth="!max-w-5xl"
    >
      <div className="w-full space-y-4">
        <ClassworkModalTopLine
          title={title}
          titlePlaceholder="Enter survey title"
          titleError={error}
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
        />

        <div className="space-y-4">
          <AssessmentSetupCheckbox
            checked={showResults}
            onChange={(checked) => {
              setShowResults(checked)
              updateValues({ showResults: checked })
            }}
          >
            Show class results to students
          </AssessmentSetupCheckbox>

          <AssessmentSetupCheckbox
            checked={dynamicResponses}
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
