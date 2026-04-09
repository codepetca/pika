'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, PenSquare, Trash2 } from 'lucide-react'
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
  onSelect: () => void
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
  onSelect,
  onEdit,
  onDelete,
}: SortableAssignmentCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: assignment.id, disabled: isReadOnly || isDragDisabled })

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'w-full rounded-card border p-3.5 text-left shadow-elevated',
        isDraft || isScheduled
          ? 'border-border-strong bg-surface-2'
          : 'border-border bg-surface-panel',
        isDragging
          ? 'z-50 scale-[1.02] border-primary opacity-95 shadow-panel'
          : isDraft || isScheduled
            ? 'transition hover:border-border-strong hover:bg-surface-3'
            : 'transition hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel',
      ].join(' ')}
    >
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3">
        {/* Drag handle */}
        {!isReadOnly && (
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
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {/* Left: Title and due date */}
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 text-left"
        >
          <h3 className={[
            'font-medium truncate',
            isDraft || isScheduled ? 'text-text-muted' : 'text-text-default'
          ].join(' ')}>
            {assignment.title}
          </h3>
          <p className="text-xs text-text-muted">
            Due: {formatDueDate(assignment.due_at)}
          </p>
          {isScheduled && (
            <p className="text-xs text-warning">{scheduledOpenLabel}</p>
          )}
        </button>

        {/* Middle: Status */}
        <div className="whitespace-nowrap px-4 text-center">
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
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1">
          <Tooltip content="Edit assignment">
            <Button
              variant="ghost"
              size="sm"
              className="p-1.5"
              aria-label={`Edit ${assignment.title}`}
              disabled={isReadOnly}
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
            >
              <PenSquare className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
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
        </div>
      </div>
    </div>
  )
}
