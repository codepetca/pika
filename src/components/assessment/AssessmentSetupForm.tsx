'use client'

import type { FormEvent, ReactNode, Ref } from 'react'
import { Button, FormField, Input } from '@/ui'

interface AssessmentSetupFormProps {
  isCompact?: boolean
  title: string
  titlePlaceholder: string
  titleError?: string
  titleInputRef?: Ref<HTMLInputElement>
  saving?: boolean
  submitLabel: string
  onTitleChange: (value: string) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children?: ReactNode
}

interface AssessmentSetupCheckboxProps {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}

export function AssessmentSetupForm({
  isCompact = false,
  title,
  titlePlaceholder,
  titleError,
  titleInputRef,
  saving = false,
  submitLabel,
  onTitleChange,
  onCancel,
  onSubmit,
  children,
}: AssessmentSetupFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={
        isCompact
          ? 'min-h-0 flex-1 space-y-4 overflow-y-auto'
          : 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'
      }
    >
      <FormField label="Title" error={titleError}>
        <Input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={titlePlaceholder}
          disabled={saving}
        />
      </FormField>

      {children}

      <div className={isCompact ? 'flex gap-3 pt-2' : 'mt-auto flex justify-end gap-3 border-t border-border pt-4'}>
        <Button
          type="button"
          variant="secondary"
          className={isCompact ? 'flex-1' : 'min-w-28'}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" className={isCompact ? 'flex-1' : 'min-w-28'} disabled={saving}>
          {saving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function AssessmentSetupCheckbox({
  checked,
  disabled = false,
  onChange,
  children,
}: AssessmentSetupCheckboxProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-text-default">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
      />
      <span className="leading-5">{children}</span>
    </label>
  )
}
