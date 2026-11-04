'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CheckCircle2, Eye, GripVertical, Trash2 } from 'lucide-react'
import { format, isValid, parseISO } from 'date-fns'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import {
  getAssessmentStatusLabel,
  getTestStatusBadgeClass,
  getTeacherTestListDisplayStatus,
} from '@/lib/tests'
import { Button, IconButton, Tooltip } from '@/ui'
import { getTodayInToronto } from '@/lib/timezone'
import type { TestAssessment, TestAssessmentWithStats } from '@/types'

interface TeacherTestCardProps {
  test: TestAssessment | TestAssessmentWithStats
  statsPending?: boolean
  statsUnavailable?: boolean
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
  statsPending = false,
  statsUnavailable = false,
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
  const statusBadgeClass = getTestStatusBadgeClass(displayStatus)
  const stats = 'stats' in test ? test.stats : undefined
  const totalStudents = stats?.total_students || 0
  const submittedCount = stats?.submitted ?? stats?.responded ?? 0
  const date = test.test_date ? parseISO(test.test_date) : null
  const futureDate = date && isValid(date) && test.test_date! > getTodayInToronto() ? date : null

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
          disabled={statsPending}
          className={`min-w-0 text-left row-start-1 sm:row-auto sm:col-auto ${showEditActions ? 'col-start-2' : 'col-start-1'}`}
          aria-label={`${editMode ? `Open ${test.title}` : test.title}${futureDate ? `, test date ${format(futureDate, 'MMMM d, yyyy')}` : ''}`}
        >
          <h3 className={['truncate font-medium', isDraft ? 'text-text-muted' : 'text-text-default'].join(' ')}>
            {test.title}
          </h3>
          {futureDate ? <span className="mt-1 block text-xs text-text-muted">{format(futureDate, 'MMM d, yyyy')}</span> : null}
        </button>

        <div className={`row-start-2 flex flex-wrap items-center justify-start gap-2 sm:row-auto sm:col-auto sm:justify-center sm:px-4 ${showEditActions ? 'col-start-2' : 'col-start-1'}`}>
          <span role="img" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-text-muted" aria-label={statsPending ? (statsUnavailable ? 'Submitted count unavailable' : 'Submitted count loading') : `${submittedCount} of ${totalStudents} submitted`}>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {statsPending ? '—/—' : `${submittedCount}/${totalStudents}`}
          </span>
          <span
            className={`inline-flex shrink-0 items-center rounded-badge px-2.5 py-1 text-xs font-semibold ${statsPending && !isDraft ? 'bg-surface-2 text-text-muted' : statusBadgeClass}`}
          >
            {statsPending && !isDraft ? (statsUnavailable ? 'Access unavailable' : 'Checking access') : statusLabel}
          </span>
        </div>

        <div className={`row-start-1 flex items-center justify-end gap-1 sm:row-auto sm:col-auto ${showEditActions ? 'col-start-3' : 'col-start-2'}`}>
          <IconButton
            icon={Eye}
            label={`Preview ${test.title}`}
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation()
              onRequestPreview()
            }}
          />
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
