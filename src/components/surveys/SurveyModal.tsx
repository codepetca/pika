'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { addDaysToDateString } from '@/lib/date-string'
import { AssessmentSetupCheckbox } from '@/components/assessment/AssessmentSetupForm'
import {
  ClassworkContentModalShell,
  ClassworkModalTopLine,
  DateTimeFields,
  SurveyDuePolicySelect,
} from '@/components/classwork/ClassworkContentModal'
import {
  DEFAULT_SCHEDULE_TIME,
  combineScheduleDateTimeToIso,
  getTodayInSchedulingTimezone,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'
import { Button } from '@/ui'
import type { Survey, SurveyDuePolicy } from '@/types'

interface SurveyModalProps {
  isOpen: boolean
  survey: Survey
  onClose: () => void
  onSuccess: (survey: Survey) => void
}

export function SurveyModal({
  isOpen,
  survey,
  onClose,
  onSuccess,
}: SurveyModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [showResults, setShowResults] = useState(true)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [duePolicy, setDuePolicy] = useState<SurveyDuePolicy>('soft')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setTitle(survey.title)
    setShowResults(survey.show_results)
    setDynamicResponses(survey.dynamic_responses)
    if (survey.due_at) {
      const due = parseScheduleIsoToParts(survey.due_at)
      setDueDate(due.date)
      setDueTime(due.time)
    } else {
      setDueDate(addDaysToDateString(getTodayInSchedulingTimezone(), 1))
      setDueTime(DEFAULT_SCHEDULE_TIME)
    }
    setDuePolicy(survey.due_policy ?? 'soft')
    setError('')

    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 100)
  }, [isOpen, survey])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    if (!dueDate || !dueTime) {
      setError('Due date is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await fetch(`/api/teacher/surveys/${survey.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          show_results: showResults,
          dynamic_responses: dynamicResponses,
          due_at: combineScheduleDateTimeToIso(dueDate, dueTime),
          due_policy: duePolicy,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save survey')
      onSuccess(data.survey)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save survey')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ClassworkContentModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Survey"
      titleId="survey-modal-title"
      closeLabel="Close survey modal"
      closeDisabled={saving}
      maxWidth="!max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <ClassworkModalTopLine
          title={title}
          titlePlaceholder="Enter survey title"
          titleError={error}
          titleDisabled={saving}
          titleInputRef={titleInputRef}
          onTitleChange={setTitle}
          meta={(
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(12rem,1fr)_11rem] lg:w-[30rem] lg:items-end">
              <DateTimeFields
                label="Due"
                date={dueDate}
                time={dueTime}
                disabled={saving}
                required
                onDateChange={setDueDate}
                onTimeChange={setDueTime}
              />
              <SurveyDuePolicySelect
                value={duePolicy}
                disabled={saving}
                onChange={setDuePolicy}
              />
            </div>
          )}
          primaryActions={(
            <Button
              type="submit"
              variant="primary"
              className="w-[5.75rem] justify-center font-semibold"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        />

        <div className="space-y-4">
          <AssessmentSetupCheckbox
            checked={showResults}
            disabled={saving}
            onChange={setShowResults}
          >
            Show class results to students
          </AssessmentSetupCheckbox>

          <AssessmentSetupCheckbox
            checked={dynamicResponses}
            disabled={saving}
            onChange={setDynamicResponses}
          >
            Allow students to update answers while open
          </AssessmentSetupCheckbox>
        </div>
      </form>
    </ClassworkContentModalShell>
  )
}
