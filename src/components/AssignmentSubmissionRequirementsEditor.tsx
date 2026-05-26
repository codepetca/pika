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
import { Camera, FolderGit2, GripVertical, Link2, Trash2 } from 'lucide-react'
import { Button, FormField, Input, SplitButton, Tooltip, TooltipProvider, cn } from '@/ui'
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
  if (type === 'image') return <Camera className="h-4 w-4" aria-hidden="true" />
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
  onRemove: (index: number) => void
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid gap-3 px-3 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]',
        isDragging ? 'relative z-10 bg-surface shadow-lg' : ''
      )}
    >
      <div className="flex items-center gap-2 text-text-muted">
        <button
          type="button"
          className={cn(
            '-ml-1 rounded p-1 touch-none transition-colors',
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
        <RequirementIcon type={requirement.type} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
        <FormField label="Label" hideLabel>
          <Input
            value={requirement.label ?? ''}
            disabled={disabled}
            onChange={(event) => onUpdate(index, { label: event.target.value })}
            placeholder="Submission label"
          />
        </FormField>
        <FormField label="Instructions" hideLabel>
          <Input
            value={requirement.instructions ?? ''}
            disabled={disabled}
            onChange={(event) => onUpdate(index, { instructions: event.target.value })}
            placeholder="Optional helper text"
          />
        </FormField>
        <label className="flex items-end gap-2 pb-2 text-sm text-text-default">
          <input
            type="checkbox"
            checked={requirement.required !== false}
            disabled={disabled}
            onChange={(event) => onUpdate(index, { required: event.target.checked })}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          Required
        </label>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Tooltip content="Remove">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-danger"
            disabled={disabled}
            onClick={() => onRemove(index)}
            aria-label="Remove requirement"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

export function AssignmentSubmissionRequirementsEditor({
  requirements,
  onChange,
  disabled = false,
}: AssignmentSubmissionRequirementsEditorProps) {
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
  const sortableIds = requirements.map((_, index) => `requirement-${index}`)

  function updateRequirement(index: number, patch: Partial<AssignmentSubmissionRequirementDraft>) {
    onChange(requirements.map((requirement, currentIndex) =>
      currentIndex === index
        ? { ...requirement, ...patch }
        : requirement
    ))
  }

  function addRequirement(type: AssignmentSubmissionRequirementType) {
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
    onChange(
      withPositions(requirements.filter((_, currentIndex) => currentIndex !== index))
    )
  }

  function handleDragEnd(event: DragEndEvent) {
    if (disabled) return

    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = sortableIds.indexOf(String(active.id))
    const newIndex = sortableIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    onChange(withPositions(arrayMove(requirements, oldIndex, newIndex)))
  }

  return (
    <TooltipProvider>
      <div role="group" aria-label="Required submissions" className="rounded-lg border border-border-strong bg-surface">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-default">Required submissions</div>
          </div>
          <SplitButton
            label={(
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true">+</span>
                <Link2 className="h-4 w-4" aria-hidden="true" />
                link
              </span>
            )}
            onPrimaryClick={() => addRequirement('link')}
            options={TYPE_OPTIONS.map((option) => ({
              id: option.type,
              label: option.label,
              icon: <RequirementIcon type={option.type} />,
              onSelect: () => addRequirement(option.type),
            }))}
            variant="secondary"
            size="sm"
            disabled={disabled}
            menuPlacement="down"
            toggleAriaLabel="Choose submission type"
            toggleButtonClassName="!px-2"
            primaryButtonProps={{
              'aria-label': 'Add link submission',
              className: 'justify-center gap-1 !px-2',
              title: 'Add public link submission',
            }}
          />
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
                    onRemove={removeRequirement}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
