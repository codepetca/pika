'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ExternalLink, GripVertical, Lock, Trash2, Unlock } from 'lucide-react'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import {
  getAssessmentStatusLabel,
  getQuizStatusBadgeClass,
  getTeacherTestListDisplayStatus,
} from '@/lib/quizzes'
import { Button, Tooltip } from '@/ui'
import type { QuizWithStats } from '@/types'

interface TeacherTestCardProps {
  test: QuizWithStats
  isReadOnly: boolean
  isDragDisabled?: boolean
  editMode: boolean
  showDeleteAction?: boolean
  onSelect: () => void
  onRequestPreview: () => void
  onRequestDelete: () => void
}

export function TeacherTestCard({
  test,
  isReadOnly,
  isDragDisabled = false,
  editMode,
  showDeleteAction = true,
  onSelect,
  onRequestPreview,
  onRequestDelete,
}: TeacherTestCardProps) {
  const showEditActions = editMode && !isReadOnly
  const showDeleteButton = showEditActions && showDeleteAction
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: test.id, disabled: isReadOnly || isDragDisabled || !editMode })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  const isDraft = test.status === 'draft'
  const displayStatus = getTeacherTestListDisplayStatus(test)
  const statusLabel = getAssessmentStatusLabel(displayStatus, 'test')
  const statusBadgeClass = getQuizStatusBadgeClass(displayStatus)
  const totalStudents = test.stats.total_students || 0
  const submittedCount = test.stats.submitted ?? test.stats.responded ?? 0
  const openAccessCount = test.stats.open_access ?? (test.status === 'active' ? totalStudents : 0)
  const closedAccessCount =
    test.stats.closed_access ?? Math.max(totalStudents - openAccessCount, 0)

  return (
    <TeacherWorkItemCardFrame
      ref={setNodeRef}
      style={style}
      tone={isDraft ? 'muted' : 'default'}
      dragging={isDragging}
    >
      <div
        className={[
          'grid items-center gap-3',
          showEditActions
            ? 'grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]'
            : 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto]',
        ].join(' ')}
      >
        {showEditActions ? (
          <button
            type="button"
            className={[
              '-ml-1 touch-none p-1 text-text-muted transition-colors',
              isDragDisabled
                ? 'cursor-default'
                : 'cursor-grab hover:text-text-default active:cursor-grabbing',
            ].join(' ')}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${test.title}`}
            disabled={isDragDisabled}
            onClick={(event) => event.stopPropagation()}
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 text-left"
          aria-label={editMode ? `Open ${test.title}` : test.title}
        >
          <h3 className={['truncate font-medium', isDraft ? 'text-text-muted' : 'text-text-default'].join(' ')}>
            {test.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
            <span>{submittedCount}/{totalStudents} submitted</span>
            <span className="inline-flex items-center gap-1" aria-label={`${openAccessCount} open`}>
              {openAccessCount}
              <Unlock className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            </span>
            <span className="inline-flex items-center gap-1" aria-label={`${closedAccessCount} closed`}>
              {closedAccessCount}
              <Lock className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
            </span>
          </div>
        </button>

        <div className="flex items-center justify-start gap-2 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:text-center">
          <span
            className={`inline-flex shrink-0 items-center rounded-badge px-2.5 py-1 text-xs font-semibold ${statusBadgeClass}`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="flex items-center justify-end gap-1">
          <Tooltip content="Preview test">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 py-1.5"
              aria-label={`Preview ${test.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onRequestPreview()
              }}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span>Preview</span>
            </Button>
          </Tooltip>
          {showDeleteButton ? (
            <Tooltip content="Delete test">
              <Button
                variant="ghost"
                size="sm"
                className="p-1.5 text-danger hover:bg-danger-bg"
                aria-label={`Delete ${test.title}`}
                disabled={isReadOnly}
                onClick={(event) => {
                  event.stopPropagation()
                  if (isReadOnly) return
                  onRequestDelete()
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </TeacherWorkItemCardFrame>
  )
}
