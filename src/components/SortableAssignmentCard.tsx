'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, PenSquare, Trash2, Send } from 'lucide-react'
import { formatDueDate } from '@/lib/assignments'
import type { Assignment, AssignmentStats } from '@/types'

interface AssignmentWithStats extends Assignment {
  stats: AssignmentStats
}

interface SortableAssignmentCardProps {
  assignment: AssignmentWithStats
  isReadOnly: boolean
  isDragDisabled?: boolean
  isReleasing?: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onRelease?: () => void
}

export function SortableAssignmentCard({
  assignment,
  isReadOnly,
  isDragDisabled = false,
  isReleasing = false,
  onSelect,
  onEdit,
  onDelete,
  onRelease,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900',
        isDragging
          ? 'shadow-xl scale-[1.02] z-50 border-blue-400 dark:border-blue-500 opacity-90'
          : 'transition hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        {!isReadOnly && (
          <button
            type="button"
            className={[
              'flex-shrink-0 p-1 -ml-1 touch-none transition-colors',
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
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
              {assignment.title}
            </h3>
            {assignment.is_draft && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                Draft
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {assignment.stats.submitted} / {assignment.stats.total_students} submitted
            {assignment.stats.late > 0 ? ` • ${assignment.stats.late} late` : ''}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Due: {formatDueDate(assignment.due_at)}
          </p>
        </button>
        <div className="flex-shrink-0 flex items-center gap-1">
          {assignment.is_draft && onRelease && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isReadOnly || isReleasing) return
                onRelease()
              }}
              className={[
                'p-2 rounded-md text-blue-600 hover:text-blue-800 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-200 dark:hover:bg-blue-900/20',
                isReadOnly || isReleasing ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
              aria-label={`Release ${assignment.title}`}
              disabled={isReadOnly || isReleasing}
            >
              <Send className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isReadOnly) return
              onEdit()
            }}
            className={[
              'p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800',
              isReadOnly ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
            aria-label={`Edit ${assignment.title}`}
            disabled={isReadOnly}
          >
            <PenSquare className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isReadOnly) return
              onDelete()
            }}
            className={[
              'p-2 rounded-md text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-200 dark:hover:bg-red-900/20',
              isReadOnly ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
            aria-label={`Delete ${assignment.title}`}
            disabled={isReadOnly}
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
