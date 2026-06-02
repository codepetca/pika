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
import { FolderGit2, GripVertical, ImageIcon, Link2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, ConfirmDialog, FormField, Input, Select, SplitButton, Tooltip, TooltipProvider, cn } from '@/ui'
import {
  DEFAULT_REQUIREMENT_LABELS,
  LINK_VALIDATION_MODE_LABELS,
  normalizeAssignmentSubmissionValidationPolicy,
  type AssignmentLinkValidationMode,
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

const LINK_VALIDATION_OPTIONS: Array<{ value: AssignmentLinkValidationMode; label: string }> = [
  { value: 'format_only', label: LINK_VALIDATION_MODE_LABELS.format_only },
  { value: 'reachable', label: LINK_VALIDATION_MODE_LABELS.reachable },
  { value: 'expected_domain', label: LINK_VALIDATION_MODE_LABELS.expected_domain },
]

function RequirementIcon({ type }: { type: AssignmentSubmissionRequirementType }) {
  if (type === 'repo_link') return <FolderGit2 className="h-4 w-4" aria-hidden="true" />
  if (type === 'image') return <ImageIcon className="h-4 w-4" aria-hidden="true" />
  return <Link2 className="h-4 w-4" aria-hidden="true" />
}

function AddRequirementLabel({ type, label }: {
  type: AssignmentSubmissionRequirementType
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true">+</span>
      {label}
      <RequirementIcon type={type} />
    </span>
  )
}

function withPositions(requirements: AssignmentSubmissionRequirementDraft[]) {
  return requirements.map((requirement, position) => ({ ...requirement, position }))
}

function buildLinkValidationPolicyPatch(
  mode: AssignmentLinkValidationMode,
  expectedDomain: string
): Record<string, unknown> {
  if (mode === 'format_only') return {}
  if (mode === 'reachable') return { mode }
  return {
    mode,
    expected_domains: expectedDomain.trim() ? [expectedDomain.trim()] : [],
  }
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
  const linkPolicy = normalizeAssignmentSubmissionValidationPolicy(
    requirement.type,
    requirement.validation_policy_json
  )
  const rawMode = typeof requirement.validation_policy_json?.mode === 'string'
    ? requirement.validation_policy_json.mode
    : ''
  const linkValidationMode = LINK_VALIDATION_OPTIONS.some((option) => option.value === rawMode)
    ? rawMode as AssignmentLinkValidationMode
    : linkPolicy.mode
  const rawExpectedDomains = Array.isArray(requirement.validation_policy_json?.expected_domains)
    ? requirement.validation_policy_json.expected_domains
    : []
  const expectedDomain = typeof rawExpectedDomains[0] === 'string'
    ? rawExpectedDomains[0]
    : linkPolicy.expected_domains[0] ?? ''

  function updateLinkValidationMode(mode: AssignmentLinkValidationMode) {
    onUpdate(index, {
      validation_policy_json: buildLinkValidationPolicyPatch(mode, expectedDomain),
    })
  }

  function updateExpectedDomain(domain: string) {
    onUpdate(index, {
      validation_policy_json: buildLinkValidationPolicyPatch('expected_domain', domain),
    })
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
      <div className="grid gap-2">
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
        {requirement.type === 'link' ? (
          <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-2 sm:grid-cols-[minmax(9rem,0.4fr)_minmax(0,1fr)]">
            <FormField label="Check">
              <Select
                value={linkValidationMode}
                options={LINK_VALIDATION_OPTIONS}
                disabled={disabled}
                onChange={(event) => updateLinkValidationMode(event.target.value as AssignmentLinkValidationMode)}
              />
            </FormField>
            {linkValidationMode === 'expected_domain' ? (
              <FormField label="Expected domain">
                <Input
                  value={expectedDomain}
                  disabled={disabled}
                  placeholder="codehs.com"
                  onChange={(event) => updateExpectedDomain(event.target.value)}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-1">
        <Tooltip content="Remove">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-danger"
            disabled={disabled}
            onClick={() => onRemove(index, sortableId)}
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
      <div role="group" aria-label="Required submissions" className="rounded-lg border border-border-strong bg-surface">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-default">Required submissions</div>
          </div>
          <SplitButton
            label={(
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true">+</span>
                Add
              </span>
            )}
            primaryOpensMenu
            options={TYPE_OPTIONS.map((option) => ({
              id: option.type,
              label: <AddRequirementLabel type={option.type} label={option.label} />,
              onSelect: () => addRequirement(option.type),
            }))}
            variant="success"
            size="sm"
            disabled={disabled}
            menuPlacement="down"
            toggleAriaLabel="Choose submission type"
            toggleButtonClassName="!px-2"
            primaryButtonProps={{
              'aria-label': 'Add submission',
              className: 'justify-center gap-1 !px-2',
              title: 'Add required submission',
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
        title="Remove required submission?"
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
