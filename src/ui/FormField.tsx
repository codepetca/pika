'use client'

import { cloneElement, isValidElement, useId, type ReactElement } from 'react'
import { cn } from './utils'

type FormControlProps = {
  id?: string
  required?: boolean
  'aria-required'?: boolean | 'true' | 'false'
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
  'aria-describedby'?: string
  'aria-errormessage'?: string
  'aria-labelledby'?: string
}

export interface FormFieldProps {
  /** Label text displayed above the control */
  label: string
  /** Override the htmlFor attribute (auto-generated if not provided) */
  htmlFor?: string
  /** Error message displayed below the control */
  error?: string
  /** Hint text displayed below the control */
  hint?: string
  /** Show required indicator (*) after label */
  required?: boolean
  /** Keep the label available to assistive tech without showing it visually */
  hideLabel?: boolean
  /** Exactly one form control (Input, Select, Textarea, etc.) */
  children: ReactElement<FormControlProps>
  /** Additional class names for the wrapper */
  className?: string
}

// Styles are kept inline as they're simple and don't need CVA variants
const labelStyles = 'block text-sm font-medium text-text-default mb-1'
const errorStyles = 'mt-1 text-sm text-danger'
const hintStyles = 'mt-1 text-sm text-text-muted'
const requiredMarkerStyles = 'text-danger ml-1'

function mergeIdRefs(...values: Array<string | undefined>): string | undefined {
  const ids = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? [])
  return ids.length > 0 ? Array.from(new Set(ids)).join(' ') : undefined
}

/**
 * FormField wraps form controls with consistent label and error styling.
 * This is the canonical pattern for all form inputs in the app.
 *
 * @example
 * <FormField label="Email" error={errors.email} required>
 *   <Input type="email" value={email} onChange={...} />
 * </FormField>
 *
 * @example
 * <FormField label="Country" hint="Select your country of residence">
 *   <Select options={countries} value={country} onChange={...} />
 * </FormField>
 */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  hideLabel,
  children,
  className,
}: FormFieldProps) {
  const generatedId = useId()
  const child = isValidElement<FormControlProps>(children) ? children : null
  const fieldId = htmlFor || child?.props.id || generatedId
  const labelId = `${fieldId}-label`
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = mergeIdRefs(child?.props['aria-describedby'], hintId, errorId)
  const labelledBy = mergeIdRefs(labelId, child?.props['aria-labelledby'])

  const enhancedChild = child
    ? cloneElement(child, {
        id: fieldId,
        required: required || child.props.required || undefined,
        'aria-required': required ? true : child.props['aria-required'],
        'aria-invalid': error ? true : child.props['aria-invalid'],
        'aria-describedby': describedBy,
        'aria-errormessage': errorId ?? child.props['aria-errormessage'],
        'aria-labelledby': labelledBy,
      })
    : children

  return (
    <div className={cn('w-full', className)}>
      <label id={labelId} htmlFor={fieldId} className={cn(labelStyles, hideLabel && 'sr-only')}>
        {label}
        {required && <span className={requiredMarkerStyles} aria-hidden="true">*</span>}
      </label>
      {enhancedChild}
      {hint && (
        <p id={hintId} className={hintStyles}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={errorStyles} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
