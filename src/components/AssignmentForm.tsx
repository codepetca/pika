'use client'

import type { FormEvent, RefObject } from 'react'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import { DateActionBar } from '@/components/DateActionBar'
import { RichTextEditor } from '@/components/editor'
import type { TiptapContent } from '@/types'

interface AssignmentFormProps {
  title: string
  instructions: TiptapContent
  dueAt: string
  onTitleChange: (next: string) => void
  onInstructionsChange: (next: TiptapContent) => void
  onDueAtChange: (next: string) => void
  onPrevDate: () => void
  onNextDate: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
  submitLabel: string
  cancelLabel?: string
  disabled?: boolean
  error?: string
  titleInputRef?: RefObject<HTMLInputElement>
  // Optional extra action button (e.g., Release for drafts)
  extraAction?: {
    label: string
    onClick: () => void
    variant?: 'primary' | 'success'
  }
}

export function AssignmentForm({
  title,
  instructions,
  dueAt,
  onTitleChange,
  onInstructionsChange,
  onDueAtChange,
  onPrevDate,
  onNextDate,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel = 'Cancel',
  disabled = false,
  error,
  titleInputRef,
  extraAction,
}: AssignmentFormProps) {
  const isSubmitDisabled = disabled || !title || !dueAt

  return (
    <form onSubmit={onSubmit} className="space-y-3 w-full">
      <Input
        ref={titleInputRef}
        label="Title"
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        required
        disabled={disabled}
        placeholder="Assignment title"
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Instructions
        </label>
        <div className="min-h-[200px] border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
          <RichTextEditor
            content={instructions}
            onChange={onInstructionsChange}
            placeholder="Assignment instructions (optional)"
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Due Date
        </label>
        <DateActionBar value={dueAt} onChange={onDueAtChange} onPrev={onPrevDate} onNext={onNextDate} />
      </div>

      {error && <p className="text-sm text-yellow-600 dark:text-yellow-400">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitDisabled}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={disabled}>
            {cancelLabel}
          </Button>
        )}
        {extraAction && (
          <Button
            type="button"
            variant={extraAction.variant === 'success' ? 'primary' : 'secondary'}
            onClick={extraAction.onClick}
            disabled={disabled}
            className={extraAction.variant === 'success' ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {extraAction.label}
          </Button>
        )}
      </div>
    </form>
  )
}
