'use client'

import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, GripVertical } from 'lucide-react'
import type { Classroom } from '@/types'

interface SortableClassroomRowProps {
  classroom: Classroom
  isDragDisabled?: boolean
  onOpen: () => void
  onArchive: () => void
}

interface ClassroomRowFrameProps {
  classroom: Classroom
  dragHandle: ReactNode
  action: ReactNode
  onOpen?: () => void
  className?: string
}

function ClassroomRowFrame({
  classroom,
  dragHandle,
  action,
  onOpen,
  className = '',
}: ClassroomRowFrameProps) {
  return (
    <div
      className={[
        'grid w-full grid-cols-[auto,minmax(0,1fr),auto] grid-rows-1 items-center gap-2.5 py-4 pr-4 sm:gap-4 sm:pr-5',
        className,
      ].join(' ')}
    >
      <div className="col-start-1 row-start-1 flex h-full items-center justify-center pl-1">
        {dragHandle}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="col-start-2 row-start-1 min-w-0 rounded-control -m-1.5 ml-1 p-1.5 text-left transition-colors hover:bg-surface-accent sm:ml-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 text-base font-semibold text-text-default">
            {classroom.title}
          </div>
          {classroom.term_label && (
            <div className="text-sm text-text-muted">{classroom.term_label}</div>
          )}
        </div>
        <div className="mt-1 text-sm text-text-muted">
          Code: <span className="font-mono tracking-[0.18em]">{classroom.class_code}</span>
        </div>
      </button>

      <div className="col-start-3 row-start-1 flex items-center justify-end">
        {action}
      </div>
    </div>
  )
}

export function ClassroomRowGhost({ classroom }: { classroom: Classroom }) {
  return (
    <div className="min-w-[320px] rounded-card border border-border bg-surface shadow-xl ring-1 ring-primary/40">
      <ClassroomRowFrame
        classroom={classroom}
        className="pointer-events-none"
        dragHandle={
          <div className="shrink-0 rounded-control p-1 text-text-muted">
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </div>
        }
        action={
          <div className="inline-flex h-6 w-6 items-center justify-center rounded-control text-text-muted">
            <Archive className="h-4 w-4" aria-hidden="true" />
          </div>
        }
      />
    </div>
  )
}

export function SortableClassroomRow({
  classroom,
  isDragDisabled = false,
  onOpen,
  onArchive,
}: SortableClassroomRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: classroom.id, disabled: isDragDisabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="classroom-card"
      className={[
        'rounded-card border border-border bg-surface shadow-elevated overflow-hidden',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <ClassroomRowFrame
        classroom={classroom}
        onOpen={onOpen}
        dragHandle={
          <button
            type="button"
            className={[
              'shrink-0 rounded-control p-1 touch-none transition-colors',
              isDragDisabled
                ? 'cursor-default text-text-muted'
                : 'cursor-grab text-text-muted hover:bg-surface-accent hover:text-text-default active:cursor-grabbing',
            ].join(' ')}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${classroom.title}`}
            disabled={isDragDisabled}
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        }
        action={
          <button
            type="button"
            onClick={onArchive}
            className="inline-flex h-6 w-6 -mr-1 items-center justify-center rounded-control text-text-muted transition-colors hover:text-text-default"
            aria-label={`Archive ${classroom.title}`}
            title={`Archive ${classroom.title}`}
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
    </div>
  )
}
