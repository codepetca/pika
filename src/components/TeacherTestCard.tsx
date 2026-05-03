'use client'

import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import { getAssessmentStatusLabel, getQuizStatusBadgeClass, canActivateQuiz } from '@/lib/quizzes'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { Button, ConfirmDialog, Tooltip } from '@/ui'
import type { AssessmentWorkspaceSummaryPatch, QuizWithStats } from '@/types'

interface TeacherTestCardProps {
  test: QuizWithStats
  isReadOnly: boolean
  onSelect: () => void
  onUpdate: (update: AssessmentWorkspaceSummaryPatch) => void
}

export function TeacherTestCard({
  test,
  isReadOnly,
  onSelect,
  onUpdate,
}: TeacherTestCardProps) {
  const [updating, setUpdating] = useState(false)
  const [checkingActivation, setCheckingActivation] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    setActionError('')
  }, [test.id, test.status, test.updated_at])

  async function patchTest(payload: Record<string, unknown>) {
    setUpdating(true)
    setActionError('')
    try {
      const response = await fetch(`/api/teacher/tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update test')
      }

      const nextStatus =
        data?.test?.status === 'draft' || data?.test?.status === 'active' || data?.test?.status === 'closed'
          ? data.test.status
          : payload.status === 'draft' || payload.status === 'active' || payload.status === 'closed'
            ? payload.status
            : undefined

      onUpdate({
        status: nextStatus,
        title: typeof data?.test?.title === 'string' ? data.test.title : undefined,
        show_results: typeof data?.test?.show_results === 'boolean' ? data.test.show_results : undefined,
        questions_count:
          typeof data?.test?.stats?.questions_count === 'number' ? data.test.stats.questions_count : undefined,
      })
    } catch (error: any) {
      setActionError(error?.message || 'Failed to update test')
    } finally {
      setUpdating(false)
      setShowActivateConfirm(false)
      setShowCloseConfirm(false)
    }
  }

  async function handleStatusChange(newStatus: 'active' | 'closed') {
    await patchTest({ status: newStatus })
  }

  async function handleRequestActivate(event: React.MouseEvent) {
    event.stopPropagation()
    if (isReadOnly || updating || checkingActivation || !activation.valid) return

    setCheckingActivation(true)
    setActionError('')
    try {
      const response = await fetch(`/api/teacher/tests/${test.id}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to validate test')
      }

      const questions = Array.isArray(data.questions) ? data.questions : []
      if (questions.length < 1) {
        setActionError('Test must have at least 1 question')
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
    } catch (error: any) {
      setActionError(error?.message || 'Failed to validate test')
    } finally {
      setCheckingActivation(false)
    }
  }

  const activation = canActivateQuiz(test, test.stats.questions_count)
  const isDraft = test.status === 'draft'
  const statusLabel = getAssessmentStatusLabel(test.status, 'test')
  const statusBadgeClass = getQuizStatusBadgeClass(test.status)

  return (
    <>
      <TeacherWorkItemCardFrame tone={isDraft ? 'muted' : 'default'}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <button type="button" onClick={onSelect} className="min-w-0 text-left">
            <h3 className={['truncate font-medium', isDraft ? 'text-text-muted' : 'text-text-default'].join(' ')}>
              {test.title}
            </h3>
            <p className="mt-0.5 text-xs text-text-muted">
              {isDraft ? 'Draft test' : `${test.stats.responded}/${test.stats.total_students} responded`}
            </p>
            {actionError ? (
              <p className="mt-1 text-xs text-danger" role="alert">
                {actionError}
              </p>
            ) : null}
          </button>

          <div className="flex items-center justify-start gap-2 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:text-center">
            <span
              className={`inline-flex shrink-0 items-center rounded-badge px-2.5 py-1 text-xs font-semibold ${statusBadgeClass}`}
            >
              {statusLabel}
            </span>
            {!isDraft ? (
              <span className="text-sm text-text-muted">
                {test.stats.responded}/{test.stats.total_students}
              </span>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-1">
            {test.status === 'draft' ? (
              <Tooltip content={activation.valid ? 'Open test' : activation.error}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5 text-success hover:bg-success-bg-muted"
                  aria-label="Open test"
                  disabled={isReadOnly || !activation.valid || updating || checkingActivation}
                  onClick={handleRequestActivate}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            ) : null}

            {test.status === 'active' ? (
              <Tooltip content="Close test">
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5 text-danger hover:bg-danger-bg"
                  aria-label="Close test"
                  disabled={isReadOnly || updating}
                  onClick={(event) => {
                    event.stopPropagation()
                    setShowCloseConfirm(true)
                  }}
                >
                  <Square className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            ) : null}

            {test.status === 'closed' ? (
              <Tooltip content="Reopen test">
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5 text-success hover:bg-success-bg-muted"
                  aria-label="Reopen test"
                  disabled={isReadOnly || updating}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleStatusChange('active')
                  }}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </TeacherWorkItemCardFrame>

      <ConfirmDialog
        isOpen={showActivateConfirm}
        title="Activate test?"
        description="Once activated, students will be able to respond."
        confirmLabel={updating ? 'Activating...' : 'Activate'}
        cancelLabel="Cancel"
        isConfirmDisabled={updating}
        isCancelDisabled={updating}
        onCancel={() => setShowActivateConfirm(false)}
        onConfirm={() => handleStatusChange('active')}
      />

      <ConfirmDialog
        isOpen={showCloseConfirm}
        title="Close test?"
        description="Students will no longer be able to respond."
        confirmLabel={updating ? 'Closing...' : 'Close'}
        cancelLabel="Cancel"
        isConfirmDisabled={updating}
        isCancelDisabled={updating}
        onCancel={() => setShowCloseConfirm(false)}
        onConfirm={() => handleStatusChange('closed')}
      />
    </>
  )
}
