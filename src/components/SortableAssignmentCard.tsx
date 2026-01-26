'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, PenSquare, Trash2 } from 'lucide-react'
import { formatDueDate } from '@/lib/assignments'
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'w-full text-left p-3 border rounded-lg',
        isDraft
          ? 'border-border-strong bg-surface-2'
          : 'border-border bg-surface',
        isDragging
          ? 'shadow-xl scale-[1.02] z-50 border-primary opacity-90'
          : isDraft
            ? 'transition hover:border-border-strong hover:bg-surface-hover'
            : 'transition hover:border-primary hover:bg-info-bg',
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
            isDraft ? 'text-text-muted' : 'text-text-default'
          ].join(' ')}>
            {assignment.title}
          </h3>
          <p className={[
            'text-xs',
            isDraft ? 'text-text-muted' : 'text-text-muted'
          ].join(' ')}>
            Due: {formatDueDate(assignment.due_at)}
          </p>
        </button>

        {/* Middle: Status */}
        <div className="text-center whitespace-nowrap px-4">
          {isDraft ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-2 text-text-muted">
              Draft
            </span>
          ) : (
            <span className={[
              'text-sm',
              isDraft ? 'text-text-muted' : 'text-text-muted'
            ].join(' ')}>
              {assignment.stats.submitted}/{assignment.stats.total_students}
              {assignment.stats.late > 0 && (
                <span className="text-warning ml-1">
                  ({assignment.stats.late} late)
                </span>
              )}
            </span>
          )}
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isReadOnly) return
              onEdit()
            }}
            className={[
              'p-1.5 rounded-md text-text-muted hover:text-text-default hover:bg-surface-hover',
              isReadOnly ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
            aria-label={`Edit ${assignment.title}`}
            disabled={isReadOnly}
          >
            <PenSquare className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isReadOnly) return
              onDelete()
            }}
            className={[
              'p-1.5 rounded-md text-danger hover:text-danger-hover hover:bg-danger-bg',
              isReadOnly ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
            aria-label={`Delete ${assignment.title}`}
            disabled={isReadOnly}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
