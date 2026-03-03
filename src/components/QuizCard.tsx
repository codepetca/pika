'use client'

import { useState } from 'react'
import { Trash2, Eye, EyeOff, Play, Square } from 'lucide-react'
import { getQuizStatusLabel, getQuizStatusBadgeClass, canActivateQuiz } from '@/lib/quizzes'
import { Button, ConfirmDialog, Tooltip } from '@/ui'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import type { QuizWithStats } from '@/types'

interface QuizCardProps {
  quiz: QuizWithStats
  isSelected: boolean
  isReadOnly: boolean
  apiBasePath?: string
  onSelect: () => void
  onDelete: () => void
  onQuizUpdate: () => void
}

export function QuizCard({
  quiz,
  isSelected,
  isReadOnly,
  apiBasePath = '/api/teacher/quizzes',
  onSelect,
  onDelete,
  onQuizUpdate,
}: QuizCardProps) {
  const isDraft = quiz.status === 'draft'
  const assessmentLabel = quiz.assessment_type === 'test' ? 'test' : 'quiz'
  const [updating, setUpdating] = useState(false)
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  async function handleStatusChange(newStatus: 'active' | 'closed') {
    setUpdating(true)
    try {
      const res = await fetch(`${apiBasePath}/${quiz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update quiz')
      }
      onQuizUpdate()
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: quiz.classroom_id } })
      )
    } catch (err) {
      console.error('Error updating quiz status:', err)
    } finally {
      setUpdating(false)
      setShowActivateConfirm(false)
      setShowCloseConfirm(false)
    }
  }

  async function handleToggleShowResults(e: React.MouseEvent) {
    e.stopPropagation()
    if (isReadOnly) return
    setUpdating(true)
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
    } catch (err) {
      console.error('Error toggling show results:', err)
    } finally {
      setUpdating(false)
    }
  }

  const activation = canActivateQuiz(quiz, quiz.stats.questions_count)

  return (
    <>
      <div
        className={[
          'w-full text-left p-3 border rounded-lg',
          isDraft
            ? 'border-border-strong bg-surface-2'
            : 'border-border bg-surface',
          isSelected
            ? 'bg-info-bg border-primary'
            : isDraft
              ? 'transition hover:border-border-strong hover:bg-surface-hover'
              : 'transition hover:border-primary hover:bg-info-bg',
        ].join(' ')}
      >
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          {/* Left: Title, status badge, response stats */}
          <button
            type="button"
            onClick={onSelect}
            className="min-w-0 text-left"
          >
            <div className="flex items-center gap-2">
              <h3 className={[
                'font-medium truncate',
                isDraft ? 'text-text-muted' : 'text-text-default',
              ].join(' ')}>
                {quiz.title}
              </h3>
              <span
                className={`inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getQuizStatusBadgeClass(quiz.status)}`}
              >
                {getQuizStatusLabel(quiz.status)}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {quiz.stats.responded}/{quiz.stats.total_students} responded
            </p>
          </button>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-1">
            {/* Status action */}
            {quiz.status === 'draft' && (
              <Tooltip content={activation.valid ? 'Activate' : activation.error}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5 text-success"
                  aria-label="Activate quiz"
                  disabled={isReadOnly || !activation.valid || updating}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowActivateConfirm(true)
                  }}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
            {quiz.status === 'active' && (
              <Tooltip content="Close quiz">
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5"
                  aria-label="Close quiz"
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
            {quiz.status === 'closed' && (
              <Tooltip content="Reopen quiz">
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5 text-success"
                  aria-label="Reopen quiz"
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

            {/* Show/hide results */}
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

            {/* Delete */}
            <Tooltip content={`Delete ${assessmentLabel}`}>
              <Button
                variant="ghost"
                size="sm"
                className="p-1.5 text-danger hover:bg-danger-bg"
                aria-label={`Delete ${quiz.title}`}
                disabled={isReadOnly}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showActivateConfirm}
        title={`Activate ${assessmentLabel}?`}
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
        title={`Close ${assessmentLabel}?`}
        description="Students will no longer be able to respond. If results are enabled, students who responded will be able to see results after closing."
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
