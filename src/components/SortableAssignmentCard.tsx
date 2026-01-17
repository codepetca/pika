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
          ? 'border-gray-400 dark:border-gray-500 bg-gray-200 dark:bg-gray-700'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900',
        isDragging
          ? 'shadow-xl scale-[1.02] z-50 border-blue-400 dark:border-blue-500 opacity-90'
          : isDraft
            ? 'transition hover:border-gray-500 dark:hover:border-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
            : 'transition hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
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
                ? 'text-gray-300 dark:text-gray-600 cursor-default'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing',
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
            isDraft ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'
          ].join(' ')}>
            {assignment.title}
          </h3>
          <p className={[
            'text-xs',
            isDraft ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'
          ].join(' ')}>
            Due: {formatDueDate(assignment.due_at)}
          </p>
        </button>

        {/* Middle: Status */}
        <div className="text-center whitespace-nowrap px-4">
          {isDraft ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-300">
              Draft
            </span>
          ) : (
            <span className={[
              'text-sm',
              isDraft ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'
            ].join(' ')}>
              {assignment.stats.submitted}/{assignment.stats.total_students}
              {assignment.stats.late > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400 ml-1">
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
              'p-1.5 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800',
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
              'p-1.5 rounded-md text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-200 dark:hover:bg-red-900/20',
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
