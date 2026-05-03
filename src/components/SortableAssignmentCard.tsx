'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import { formatDueDate } from '@/lib/assignments'
import { isVisibleAtNow } from '@/lib/scheduling'
import { Button, Tooltip } from '@/ui'
import type { Assignment, AssignmentStats } from '@/types'

interface AssignmentWithStats extends Assignment {
  stats: AssignmentStats
}

interface SortableAssignmentCardProps {
  assignment: AssignmentWithStats
  isReadOnly: boolean
  isDragDisabled?: boolean
  editMode: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}

function formatScheduledRelease(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .replace(/^([A-Za-z]{3}),\s/, '$1 ')
    .replace(/\s([AP]M)$/, '$1')
}

export function SortableAssignmentCard({
  assignment,
  isReadOnly,
  isDragDisabled = false,
  editMode,
  onOpen,
  onEdit,
  onDelete,
}: SortableAssignmentCardProps) {
  const showEditActions = editMode && !isReadOnly
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: assignment.id, disabled: isReadOnly || isDragDisabled || !editMode })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  const isDraft = assignment.is_draft
  const isScheduled =
    !assignment.is_draft &&
    !!assignment.released_at &&
    !isVisibleAtNow(assignment.released_at)
  const scheduledOpenLabel =
    isScheduled && assignment.released_at
      ? formatScheduledRelease(assignment.released_at)
      : ''
  const handleCardAction = () => {
    if (editMode) {
      onEdit()
    } else {
      onOpen()
    }
  }

  return (
    <TeacherWorkItemCardFrame
      ref={setNodeRef}
      style={style}
      onClick={handleCardAction}
      tone={isDraft || isScheduled ? 'muted' : 'default'}
      dragging={isDragging}
      className="cursor-pointer"
    >
      <div
        className={[
          'grid items-center gap-3',
          showEditActions
            ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
            : 'grid-cols-[minmax(0,1fr)]',
        ].join(' ')}
      >
        {showEditActions && (
          <button
            type="button"
            className={[
              'p-1 -ml-1 touch-none transition-colors',
              isDragDisabled
                ? 'text-text-muted cursor-default'
                : 'text-text-muted hover:text-text-default cursor-grab active:cursor-grabbing',
            ].join(' ')}
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            disabled={isDragDisabled}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleCardAction()
          }}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left"
          aria-label={editMode ? `Edit ${assignment.title}` : assignment.title}
        >
          <span className="min-w-0">
            <span className={[
              'block truncate font-medium',
              isDraft || isScheduled ? 'text-text-muted' : 'text-text-default'
            ].join(' ')}>
              {assignment.title}
            </span>
            <span className="block text-xs text-text-muted">
              Due: {formatDueDate(assignment.due_at)}
            </span>
            {isScheduled && (
              <span className="block text-xs text-warning">{scheduledOpenLabel}</span>
            )}
          </span>

          <span className="whitespace-nowrap px-2 text-center">
            {isDraft ? (
              <span className="inline-flex items-center rounded-badge bg-surface-3 px-2.5 py-1 text-xs font-semibold text-text-muted">
                Draft
              </span>
            ) : isScheduled ? (
              <span className="inline-flex items-center rounded-badge bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning">
                Scheduled
              </span>
            ) : (
              <span className="text-sm text-text-muted">
                {assignment.stats.submitted}/{assignment.stats.total_students}
              </span>
            )}
          </span>
        </button>

        {showEditActions && (
          <Tooltip content="Delete assignment">
            <Button
              variant="ghost"
              size="sm"
              className="p-1.5 text-danger hover:bg-danger-bg"
              aria-label={`Delete ${assignment.title}`}
              disabled={isReadOnly}
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </div>
    </TeacherWorkItemCardFrame>
  )
}
