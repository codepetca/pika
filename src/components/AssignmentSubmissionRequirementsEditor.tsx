'use client'

import { Camera, ChevronDown, ChevronUp, FolderGit2, GripVertical, Link2, Plus, Trash2 } from 'lucide-react'
import { Button, FormField, Input, Tooltip, TooltipProvider } from '@/ui'
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
  description: string
}> = [
  { type: 'repo_link', label: 'Repo link', description: 'GitHub repository URL' },
  { type: 'link', label: 'Public link', description: 'Public URL' },
  { type: 'image', label: 'Image', description: 'Screenshot upload' },
]

function RequirementIcon({ type }: { type: AssignmentSubmissionRequirementType }) {
  if (type === 'repo_link') return <FolderGit2 className="h-4 w-4" aria-hidden="true" />
  if (type === 'image') return <Camera className="h-4 w-4" aria-hidden="true" />
  return <Link2 className="h-4 w-4" aria-hidden="true" />
}

export function AssignmentSubmissionRequirementsEditor({
  requirements,
  onChange,
  disabled = false,
}: AssignmentSubmissionRequirementsEditorProps) {
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
      requirements
        .filter((_, currentIndex) => currentIndex !== index)
        .map((requirement, position) => ({ ...requirement, position }))
    )
  }

  function moveRequirement(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= requirements.length) return
    const next = [...requirements]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    onChange(next.map((requirement, position) => ({ ...requirement, position })))
  }

  return (
    <TooltipProvider>
    <div className="rounded-lg border border-border-strong bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-sm font-medium text-text-default">Required submissions</div>
          <div className="text-xs text-text-muted">Shown to students as a turn-in checklist.</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map((option) => (
            <Tooltip key={option.type} content={option.description}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                disabled={disabled}
                onClick={() => addRequirement(option.type)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {option.label}
              </Button>
            </Tooltip>
          ))}
        </div>
      </div>

      {requirements.length === 0 ? (
        <div className="px-3 py-4 text-sm text-text-muted">
          No structured submissions required.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {requirements.map((requirement, index) => (
            <div key={`${requirement.id ?? requirement.type}:${index}`} className="grid gap-3 px-3 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
              <div className="flex items-center gap-2 text-text-muted">
                <GripVertical className="h-4 w-4" aria-hidden="true" />
                <RequirementIcon type={requirement.type} />
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
                <FormField label="Label">
                  <Input
                    value={requirement.label ?? ''}
                    disabled={disabled}
                    onChange={(event) => updateRequirement(index, { label: event.target.value })}
                  />
                </FormField>
                <FormField label="Instructions">
                  <Input
                    value={requirement.instructions ?? ''}
                    disabled={disabled}
                    onChange={(event) => updateRequirement(index, { instructions: event.target.value })}
                    placeholder="Optional helper text"
                  />
                </FormField>
                <label className="flex items-end gap-2 pb-2 text-sm text-text-default">
                  <input
                    type="checkbox"
                    checked={requirement.required !== false}
                    disabled={disabled}
                    onChange={(event) => updateRequirement(index, { required: event.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  Required
                </label>
              </div>
              <div className="flex items-center justify-end gap-1">
                <Tooltip content="Move up">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    disabled={disabled || index === 0}
                    onClick={() => moveRequirement(index, -1)}
                    aria-label="Move requirement up"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
                <Tooltip content="Move down">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    disabled={disabled || index === requirements.length - 1}
                    onClick={() => moveRequirement(index, 1)}
                    aria-label="Move requirement down"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
                <Tooltip content="Remove">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-2 text-danger"
                    disabled={disabled}
                    onClick={() => removeRequirement(index)}
                    aria-label="Remove requirement"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}
