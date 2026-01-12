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
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

export function SortableAssignmentCard({
  assignment,
  isReadOnly,
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
  } = useSortable({ id: assignment.id, disabled: isReadOnly })

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
            className="flex-shrink-0 p-1 -ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing touch-none"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 min-w-0 text-left"
        >
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {assignment.title}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {assignment.stats.submitted} / {assignment.stats.total_students} submitted
            {assignment.stats.late > 0 ? ` • ${assignment.stats.late} late` : ''}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Due: {formatDueDate(assignment.due_at)}
          </p>
        </button>
        <div className="flex-shrink-0 flex items-center gap-1">
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
