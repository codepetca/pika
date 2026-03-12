'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Play, Square, CalendarClock, RotateCcw } from 'lucide-react'
import {
  getAssessmentStatusLabel,
  getQuizStatusBadgeClass,
  canActivateQuiz,
} from '@/lib/quizzes'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { Button, ConfirmDialog, Tooltip } from '@/ui'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import {
  combineScheduleDateTimeToIso,
  DEFAULT_SCHEDULE_TIME,
  getTodayInSchedulingTimezone,
  isScheduleIsoInFuture,
  isVisibleAtNow,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'
import type { QuizWithStats } from '@/types'

interface QuizCardProps {
  quiz: QuizWithStats
  isSelected: boolean
  isReadOnly: boolean
  apiBasePath?: string
  onSelect: () => void
  onQuizUpdate: () => void
}

export function QuizCard({
  quiz,
  isSelected,
  isReadOnly,
  apiBasePath = '/api/teacher/quizzes',
  onSelect,
  onQuizUpdate,
}: QuizCardProps) {
  const isDraft = quiz.status === 'draft'
  const isTest = quiz.assessment_type === 'test'
  const assessmentLabel = quiz.assessment_type === 'test' ? 'test' : 'quiz'
  const supportsScheduling =
    quiz.assessment_type === 'quiz' && apiBasePath.includes('/quizzes')
  const isScheduled =
    supportsScheduling &&
    quiz.status === 'active' &&
    !!quiz.opens_at &&
    !isVisibleAtNow(quiz.opens_at)

  const [updating, setUpdating] = useState(false)
  const [checkingActivation, setCheckingActivation] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showCancelScheduleConfirm, setShowCancelScheduleConfirm] = useState(false)
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(getTodayInSchedulingTimezone())
  const [scheduleTime, setScheduleTime] = useState(DEFAULT_SCHEDULE_TIME)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    setActionError('')
  }, [quiz.id, quiz.status, quiz.show_results, quiz.updated_at])

  async function patchQuiz(payload: Record<string, unknown>) {
    setUpdating(true)
    setActionError('')
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update quiz')
      }
      onQuizUpdate()
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: quiz.classroom_id } })
      )
    } catch (err: any) {
      setActionError(err?.message || `Failed to update ${assessmentLabel}`)
      console.error('Error updating quiz status:', err)
    } finally {
      setUpdating(false)
      setShowActivateConfirm(false)
      setShowCloseConfirm(false)
      setShowCancelScheduleConfirm(false)
    }
  }

  async function handleStatusChange(newStatus: 'active' | 'closed') {
    await patchQuiz({ status: newStatus })
  }

  async function handleRequestActivate(event: React.MouseEvent) {
    event.stopPropagation()
    if (isReadOnly || updating || checkingActivation || !activation.valid) return

    setActionError('')
    if (quiz.assessment_type !== 'test') {
      setShowActivateConfirm(true)
      return
    }

    setCheckingActivation(true)
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to validate test')
      }

      const questions = Array.isArray(data.questions) ? data.questions : []
      if (questions.length < 1) {
        setActionError('Quiz must have at least 1 question')
        return
      }

      for (let index = 0; index < questions.length; index += 1) {
        const validation = validateTestQuestionCreate(questions[index] as Record<string, unknown>)
        if (!validation.valid) {
          setActionError(`Q${index + 1}: ${validation.error}`)
          return
        }
      }

      setShowActivateConfirm(true)
    } catch (err: any) {
      setActionError(err?.message || 'Failed to validate test')
      console.error('Error validating test activation:', err)
    } finally {
      setCheckingActivation(false)
    }
  }

  async function handleScheduleConfirm() {
    if (updating || !scheduleDate || !supportsScheduling) return
    const opensAtIso = combineScheduleDateTimeToIso(scheduleDate, scheduleTime)
    if (!isScheduleIsoInFuture(opensAtIso)) return

    if (isDraft) {
      await patchQuiz({ status: 'active', opens_at: opensAtIso })
    } else {
      await patchQuiz({ opens_at: opensAtIso })
    }
    setShowSchedulePicker(false)
  }

  async function handleOpenNow() {
    if (updating) return
    if (isDraft) {
      await patchQuiz({ status: 'active' })
      return
    }
    if (supportsScheduling) {
      await patchQuiz({ opens_at: null })
    }
  }

  function openSchedulePicker() {
    if (!supportsScheduling) return
    if (quiz.opens_at && !isVisibleAtNow(quiz.opens_at)) {
      const parsed = parseScheduleIsoToParts(quiz.opens_at)
      setScheduleDate(parsed.date)
      setScheduleTime(parsed.time)
    } else {
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
    }
    setShowSchedulePicker((prev) => !prev)
  }

  async function handleToggleShowResults(e: React.MouseEvent) {
    e.stopPropagation()
    if (isReadOnly) return
    setUpdating(true)
    setActionError('')
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_results: !quiz.show_results }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update quiz')
      }
      onQuizUpdate()
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: quiz.classroom_id } })
      )
    } catch (err: any) {
      setActionError(err?.message || `Failed to update ${assessmentLabel}`)
      console.error('Error toggling show results:', err)
    } finally {
      setUpdating(false)
    }
  }

  const activation = canActivateQuiz(quiz, quiz.stats.questions_count)
  const scheduleIso = scheduleDate ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime) : ''
  const isScheduleValid = scheduleIso ? isScheduleIsoInFuture(scheduleIso) : false
  const statusLabel = isScheduled ? 'Scheduled' : getAssessmentStatusLabel(quiz.status, quiz.assessment_type)
  const statusBadgeClass = isScheduled
    ? 'bg-warning-bg text-warning'
    : getQuizStatusBadgeClass(quiz.status)

  return (
    <>
      <div
        className={[
          'w-full text-left p-3 border rounded-lg',
          isDraft
            ? 'border-border-strong bg-surface-2'
            : isScheduled
              ? 'border-warning bg-warning-bg'
              : 'border-border bg-surface',
          isSelected
            ? 'bg-info-bg border-primary'
            : isDraft
              ? 'transition hover:border-border-strong hover:bg-surface-hover'
              : isScheduled
                ? 'transition hover:border-warning hover:bg-warning-bg'
                : 'transition hover:border-primary hover:bg-info-bg',
        ].join(' ')}
      >
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          {/* Left: Title, response stats, status badge */}
          <button
            type="button"
            onClick={onSelect}
            className="min-w-0 text-left"
          >
            <h3 className={[
              'font-medium truncate',
              isDraft ? 'text-text-muted' : 'text-text-default',
            ].join(' ')}>
              {quiz.title}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
              <span>{quiz.stats.responded}/{quiz.stats.total_students} responded</span>
              <span
                className={`inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass}`}
              >
                {statusLabel}
              </span>
            </div>
            {isScheduled && quiz.opens_at && (
              <p className="text-xs text-warning mt-0.5">
                Opens {new Date(quiz.opens_at).toLocaleString('en-US', {
                  timeZone: 'America/Toronto',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            )}
            {actionError && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {actionError}
              </p>
            )}
          </button>

          {/* Right: Action buttons */}
          <div className="relative flex items-center gap-1">
            {/* Status action */}
            {quiz.status === 'draft' && (
              <Tooltip
                content={
                  activation.valid
                    ? supportsScheduling
                      ? 'Open now'
                      : `Activate ${assessmentLabel}`
                    : activation.error
                }
              >
                <Button
                  variant="success"
                  size="sm"
                  className="h-9 w-9 p-0"
                  aria-label={
                    supportsScheduling
                      ? `Open ${assessmentLabel} now`
                      : `Activate ${assessmentLabel}`
                  }
                  disabled={isReadOnly || !activation.valid || updating || checkingActivation}
                  onClick={handleRequestActivate}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
            {quiz.status === 'active' && !isScheduled && (
              <Tooltip content={`Close ${assessmentLabel}`}>
                <Button
                  variant="danger"
                  size="sm"
                  className="h-9 w-9 p-0"
                  aria-label={`Close ${assessmentLabel}`}
                  disabled={isReadOnly || updating}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowCloseConfirm(true)
                  }}
                >
                  <Square className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
            {isScheduled && (
              <>
                <Tooltip content="Open now">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1.5 text-success"
                    aria-label={`Open ${assessmentLabel} now`}
                    disabled={isReadOnly || updating}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenNow()
                    }}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
                <Tooltip content="Cancel schedule (back to draft)">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1.5"
                    aria-label="Cancel scheduled open"
                    disabled={isReadOnly || updating}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowCancelScheduleConfirm(true)
                    }}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              </>
            )}
            {quiz.status === 'closed' && (
              <Tooltip content={`Reopen ${assessmentLabel}`}>
                <Button
                  variant="success"
                  size="sm"
                  className="h-9 w-9 p-0"
                  aria-label={`Reopen ${assessmentLabel}`}
                  disabled={isReadOnly || updating}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStatusChange('active')
                  }}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
            {supportsScheduling && (quiz.status === 'draft' || isScheduled) && (
              <Tooltip content={isScheduled ? 'Reschedule open time' : 'Schedule open time'}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5"
                  aria-label={isScheduled ? 'Reschedule quiz open' : 'Schedule quiz open'}
                  disabled={isReadOnly || updating || (quiz.status === 'draft' && !activation.valid)}
                  onClick={(e) => {
                    e.stopPropagation()
                    openSchedulePicker()
                  }}
                >
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            )}

            {!isTest && (
              <Tooltip content={quiz.show_results ? 'Results visible to students' : 'Results hidden from students'}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`p-1.5 ${quiz.show_results ? 'text-primary' : ''}`}
                  aria-label={quiz.show_results ? 'Hide results from students' : 'Show results to students'}
                  disabled={isReadOnly || updating}
                  onClick={handleToggleShowResults}
                >
                  {quiz.show_results ? (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </Tooltip>
            )}
          </div>
        </div>

        {supportsScheduling && showSchedulePicker && (
          <div className="mt-3">
            <ScheduleDateTimePicker
              date={scheduleDate}
              time={scheduleTime}
              minDate={getTodayInSchedulingTimezone()}
              isFutureValid={isScheduleValid}
              onDateChange={setScheduleDate}
              onTimeChange={setScheduleTime}
              onCancel={() => setShowSchedulePicker(false)}
              onConfirm={handleScheduleConfirm}
              title="Open Time (Toronto)"
              confirmLabel={updating ? 'Saving...' : isScheduled ? 'Save schedule' : 'Schedule'}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showActivateConfirm}
        title={supportsScheduling ? `Open ${assessmentLabel} now?` : `Activate ${assessmentLabel}?`}
        description={
          supportsScheduling
            ? 'Students will be able to respond immediately.'
            : 'Once activated, students will be able to respond.'
        }
        confirmLabel={updating ? (supportsScheduling ? 'Opening...' : 'Activating...') : (supportsScheduling ? 'Open now' : 'Activate')}
        cancelLabel="Cancel"
        isConfirmDisabled={updating}
        isCancelDisabled={updating}
        onCancel={() => setShowActivateConfirm(false)}
        onConfirm={supportsScheduling ? handleOpenNow : () => handleStatusChange('active')}
      />

      <ConfirmDialog
        isOpen={showCloseConfirm}
        title={`Close ${assessmentLabel}?`}
        description="Students will no longer be able to respond."
        confirmLabel={updating ? 'Closing...' : 'Close'}
        cancelLabel="Cancel"
        isConfirmDisabled={updating}
        isCancelDisabled={updating}
        onCancel={() => setShowCloseConfirm(false)}
        onConfirm={() => handleStatusChange('closed')}
      />

      {supportsScheduling && (
        <ConfirmDialog
          isOpen={showCancelScheduleConfirm}
          title="Cancel scheduled open?"
          description="This quiz will return to draft so students cannot access it."
          confirmLabel={updating ? 'Cancelling...' : 'Revert to draft'}
          cancelLabel="Keep scheduled"
          isConfirmDisabled={updating}
          isCancelDisabled={updating}
          onCancel={() => setShowCancelScheduleConfirm(false)}
          onConfirm={() => patchQuiz({ status: 'draft', opens_at: null })}
        />
      )}
    </>
  )
}
