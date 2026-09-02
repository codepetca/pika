'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FolderGit2, GripVertical, ImageIcon, Link2, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, ConfirmDialog, Input, SplitButton, Tooltip, TooltipProvider, cn } from '@/ui'
import {
  DEFAULT_REQUIREMENT_LABELS,
  type AssignmentSubmissionRequirementDraft,
} from '@/lib/assignment-submission-requirements'
import type { AssignmentSubmissionRequirementType } from '@/types'

interface AssignmentSubmissionRequirementsEditorProps {
  requirements: AssignmentSubmissionRequirementDraft[]
  onChange: (requirements: AssignmentSubmissionRequirementDraft[]) => void
  disabled?: boolean
}

const TYPE_OPTIONS: Array<{
  type: AssignmentSubmissionRequirementType
  label: string
}> = [
  { type: 'link', label: 'Link' },
  { type: 'repo_link', label: 'Repo' },
  { type: 'image', label: 'Image' },
]

function RequirementIcon({ type }: { type: AssignmentSubmissionRequirementType }) {
  if (type === 'repo_link') return <FolderGit2 className="h-4 w-4" aria-hidden="true" />
  if (type === 'image') return <ImageIcon className="h-4 w-4" aria-hidden="true" />
  return <Link2 className="h-4 w-4" aria-hidden="true" />
}

function withPositions(requirements: AssignmentSubmissionRequirementDraft[]) {
  return requirements.map((requirement, position) => ({ ...requirement, position }))
}

interface SortableRequirementRowProps {
  sortableId: string
  requirement: AssignmentSubmissionRequirementDraft
  index: number
  totalRequirements: number
  disabled: boolean
  onUpdate: (index: number, patch: Partial<AssignmentSubmissionRequirementDraft>) => void
  onRemove: (index: number, sortableId: string) => void
}

function SortableRequirementRow({
  sortableId,
  requirement,
  index,
  totalRequirements,
  disabled,
  onUpdate,
  onRemove,
}: SortableRequirementRowProps) {
  const isDragDisabled = disabled || totalRequirements < 2
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: isDragDisabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }
  const imageLimitsId = `${sortableId}-image-limits`

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid grid-cols-[2.75rem_1.5rem_minmax(0,1fr)_2.75rem] items-center gap-1 px-1 py-1',
        isDragging ? 'relative z-10 bg-surface shadow-lg' : ''
      )}
    >
      <button
        type="button"
        className={cn(
          'flex h-11 w-11 touch-none items-center justify-center rounded text-text-muted transition-colors',
          isDragDisabled
            ? 'cursor-default opacity-50'
            : 'cursor-grab hover:bg-surface-hover hover:text-text-default active:cursor-grabbing'
        )}
        disabled={isDragDisabled}
        aria-label={`Drag to reorder ${requirement.label || DEFAULT_REQUIREMENT_LABELS[requirement.type]}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        className="flex items-center justify-center text-text-muted"
        aria-label={`${DEFAULT_REQUIREMENT_LABELS[requirement.type]} attachment type`}
      >
        <RequirementIcon type={requirement.type} />
      </span>
      <div className="min-w-0">
        <Input
          value={requirement.label ?? ''}
          disabled={disabled}
          onChange={(event) => onUpdate(index, { label: event.target.value })}
          placeholder={DEFAULT_REQUIREMENT_LABELS[requirement.type]}
          aria-label={`${DEFAULT_REQUIREMENT_LABELS[requirement.type]} label`}
          aria-describedby={requirement.type === 'image' ? imageLimitsId : undefined}
        />
        {requirement.type === 'image' ? (
          <span id={imageLimitsId} className="sr-only">PNG, JPG, GIF, WebP · maximum 10 MB</span>
        ) : null}
      </div>
      <Tooltip content="Remove">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 w-11 p-0 text-danger"
          disabled={disabled}
          onClick={() => onRemove(index, sortableId)}
          aria-label="Remove attachment"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  )
}

export function AssignmentSubmissionRequirementsEditor({
  requirements,
  onChange,
  disabled = false,
}: AssignmentSubmissionRequirementsEditorProps) {
  const nextSortableIdRef = useRef(0)
  const sortableIdsRef = useRef<string[]>([])
  const [pendingRemoval, setPendingRemoval] = useState<{ sortableId: string; label: string } | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  if (sortableIdsRef.current.length < requirements.length) {
    sortableIdsRef.current = [
      ...sortableIdsRef.current,
      ...Array.from({ length: requirements.length - sortableIdsRef.current.length }, () => {
        const id = `requirement-${nextSortableIdRef.current}`
        nextSortableIdRef.current += 1
        return id
      }),
    ]
  } else if (sortableIdsRef.current.length > requirements.length) {
    sortableIdsRef.current = sortableIdsRef.current.slice(0, requirements.length)
  }

  const sortableIds = sortableIdsRef.current

  function updateRequirement(index: number, patch: Partial<AssignmentSubmissionRequirementDraft>) {
    onChange(requirements.map((requirement, currentIndex) =>
      currentIndex === index
        ? { ...requirement, ...patch }
        : requirement
    ))
  }

  function addRequirement(type: AssignmentSubmissionRequirementType) {
    const sortableId = `requirement-${nextSortableIdRef.current}`
    nextSortableIdRef.current += 1
    sortableIdsRef.current = [...sortableIdsRef.current, sortableId]
    onChange([
      ...requirements,
      {
        type,
        label: DEFAULT_REQUIREMENT_LABELS[type],
        instructions: '',
        required: true,
        position: requirements.length,
        validation_policy_json: {},
      },
    ])
  }

  function removeRequirement(index: number) {
    sortableIdsRef.current = sortableIdsRef.current.filter((_, currentIndex) => currentIndex !== index)
    onChange(
      withPositions(requirements.filter((_, currentIndex) => currentIndex !== index))
    )
  }

  function requestRemoveRequirement(index: number, sortableId: string) {
    const requirement = requirements[index]
    if (!requirement) return

    if (requirement.id) {
      setPendingRemoval({
        sortableId,
        label: requirement.label || DEFAULT_REQUIREMENT_LABELS[requirement.type],
      })
      return
    }

    removeRequirement(index)
  }

  function confirmPendingRemoval() {
    if (!pendingRemoval) return

    const index = sortableIdsRef.current.indexOf(pendingRemoval.sortableId)
    setPendingRemoval(null)
    if (index === -1) return

    removeRequirement(index)
  }

  function handleDragEnd(event: DragEndEvent) {
    if (disabled) return

    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = sortableIds.indexOf(String(active.id))
    const newIndex = sortableIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    sortableIdsRef.current = arrayMove(sortableIdsRef.current, oldIndex, newIndex)
    onChange(withPositions(arrayMove(requirements, oldIndex, newIndex)))
  }

  return (
    <TooltipProvider>
      <div role="group" aria-label="Submission Requirement" className="rounded-lg border border-border-strong bg-surface">
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-default">Submission Requirement</div>
          </div>
          <Tooltip content="Add submission requirement" side="left">
            <span className="inline-flex shrink-0">
              <SplitButton
                label={<Plus className="h-4 w-4" aria-hidden="true" />}
                singleMenuTrigger
                options={TYPE_OPTIONS.map((option) => ({
                  id: option.type,
                  label: option.label,
                  icon: <RequirementIcon type={option.type} />,
                  onSelect: () => addRequirement(option.type),
                }))}
                variant="success"
                size="sm"
                disabled={disabled}
                menuPlacement="down"
                primaryButtonProps={{
                  'aria-label': 'Add submission requirement',
                  className: 'h-11 w-11 p-0',
                }}
              />
            </span>
          </Tooltip>
        </div>

        {requirements.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-border border-t border-border">
                {requirements.map((requirement, index) => (
                  <SortableRequirementRow
                    key={sortableIds[index]}
                    sortableId={sortableIds[index]}
                    requirement={requirement}
                    index={index}
                    totalRequirements={requirements.length}
                    disabled={disabled}
                    onUpdate={updateRequirement}
                    onRemove={requestRemoveRequirement}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : null}
      </div>
      <ConfirmDialog
        isOpen={Boolean(pendingRemoval)}
        title="Remove attachment?"
        description={pendingRemoval ? `This removes "${pendingRemoval.label}" from the assignment.` : undefined}
        confirmLabel="Remove"
        cancelLabel="Keep"
        confirmVariant="danger"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={confirmPendingRemoval}
      />
    </TooltipProvider>
  )
}
