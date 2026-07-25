'use client'

import type { ReactElement } from 'react'
import { FormField, SaveStatus, type SaveStatusState } from '@/ui'
import type { RichTextEditorProps } from './RichTextEditor'

export interface ContentFieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  hideLabel?: boolean
  className?: string
  saveStatus?: SaveStatusState
  saveErrorMessage?: string
  children: ReactElement<RichTextEditorProps>
}

/**
 * Canonical field shell for authored content.
 *
 * Keeps naming, validation, help text, and autosave feedback consistent while
 * allowing each surface to choose the appropriate RichTextEditor preset.
 */
export function ContentField({
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  saveStatus,
  saveErrorMessage,
  children,
}: ContentFieldProps) {
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      required={required}
      hideLabel={hideLabel}
      className={className}
      labelAccessory={
        saveStatus ? (
          <SaveStatus status={saveStatus} errorMessage={saveErrorMessage} />
        ) : undefined
      }
    >
      {children}
    </FormField>
  )
}
