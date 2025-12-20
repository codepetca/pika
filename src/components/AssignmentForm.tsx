'use client'

import type { FormEvent } from 'react'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import { DateActionBar } from '@/components/DateActionBar'

interface AssignmentFormProps {
  title: string
  description: string
  dueAt: string
  onTitleChange: (next: string) => void
  onDescriptionChange: (next: string) => void
  onDueAtChange: (next: string) => void
  onPrevDate: () => void
  onNextDate: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
  submitLabel: string
  cancelLabel?: string
  disabled?: boolean
  error?: string
}

export function AssignmentForm({
  title,
  description,
  dueAt,
  onTitleChange,
  onDescriptionChange,
  onDueAtChange,
  onPrevDate,
  onNextDate,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel = 'Cancel',
  disabled = false,
  error,
}: AssignmentFormProps) {
  const isSubmitDisabled = disabled || !title || !dueAt

  return (
    <form onSubmit={onSubmit} className="space-y-3 w-full">
      <Input
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
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Assignment instructions (optional)"
          disabled={disabled}
        />
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
      </div>
    </form>
  )
}
