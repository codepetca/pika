'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import { getSurveyStatusBadgeClass, getSurveyStatusLabel } from '@/lib/surveys'
import { Button, Tooltip } from '@/ui'
import type { SurveyWithStats } from '@/types'

interface SortableSurveyCardProps {
  survey: SurveyWithStats
  isReadOnly: boolean
  isDragDisabled?: boolean
  editMode: boolean
  onOpen: () => void
  onDelete: () => void
}

export function SortableSurveyCard({
  survey,
  isReadOnly,
  isDragDisabled = false,
  editMode,
  onOpen,
  onDelete,
}: SortableSurveyCardProps) {
  const showEditActions = editMode && !isReadOnly
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: survey.id, disabled: isReadOnly || isDragDisabled || !editMode })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  const statusLabel = getSurveyStatusLabel(survey.status)
  const statusClassName = getSurveyStatusBadgeClass(survey.status)

  return (
    <TeacherWorkItemCardFrame
      ref={setNodeRef}
      style={style}
      onClick={onOpen}
      tone={survey.status === 'draft' ? 'muted' : 'default'}
      dragging={isDragging}
      dragTone="neutral"
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
            aria-label="Drag to reorder survey"
            disabled={isDragDisabled}
            onClick={(event) => event.stopPropagation()}
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left"
          aria-label={survey.title}
        >
          <span className="min-w-0">
            <span
              className={[
                'block truncate font-medium',
                survey.status === 'draft' ? 'text-text-muted' : 'text-text-default',
              ].join(' ')}
            >
              {survey.title}
            </span>
            <span className="block text-xs text-primary">
              Survey{survey.dynamic_responses ? ' · Dynamic' : ''}
            </span>
          </span>

          <span className="flex items-center gap-2 whitespace-nowrap px-2 text-center">
            <span className={`inline-flex items-center rounded-badge px-2.5 py-1 text-xs font-semibold ${statusClassName}`}>
              {statusLabel}
            </span>
            {survey.status !== 'draft' && (
              <span className="text-sm text-text-muted">
                {survey.stats.responded}/{survey.stats.total_students}
              </span>
            )}
          </span>
        </button>

        {showEditActions && (
          <Tooltip content="Delete survey">
            <Button
              variant="ghost"
              size="sm"
              className="p-1.5 text-danger hover:bg-danger-bg"
              aria-label={`Delete ${survey.title}`}
              disabled={isReadOnly}
              onClick={(event) => {
                event.stopPropagation()
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
