'use client'

import { ReactNode, useId, Children, cloneElement, isValidElement } from 'react'
import { cn } from './utils'

export interface FormFieldProps {
  /** Label text displayed above the control */
  label: string
  /** Override the htmlFor attribute (auto-generated if not provided) */
  htmlFor?: string
  /** Error message displayed below the control */
  error?: string
  /** Hint text displayed below the control (hidden if error is present) */
  hint?: string
  /** Show required indicator (*) after label */
  required?: boolean
  /** The form control (Input, Select, Textarea, etc.) */
  children: ReactNode
  /** Additional class names for the wrapper */
  className?: string
}

// Styles are kept inline as they're simple and don't need CVA variants
const labelStyles = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
const errorStyles = 'mt-1 text-sm text-red-600 dark:text-red-400'
const hintStyles = 'mt-1 text-sm text-gray-500 dark:text-gray-400'
const requiredMarkerStyles = 'text-red-500 ml-1'

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
  children,
  className,
}: FormFieldProps) {
  const generatedId = useId()
  const fieldId = htmlFor || generatedId

  // Clone child to inject id and hasError props
  const enhancedChildren = Children.map(children, (child) => {
    if (isValidElement(child)) {
      return cloneElement(child, {
        id: fieldId,
        hasError: !!error,
        'aria-invalid': error ? 'true' : undefined,
        'aria-describedby': error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined,
      } as any)
    }
    return child
  })

  return (
    <div className={cn('w-full', className)}>
      <label htmlFor={fieldId} className={labelStyles}>
        {label}
        {required && <span className={requiredMarkerStyles}>*</span>}
      </label>
      {enhancedChildren}
      {error && (
        <p id={`${fieldId}-error`} className={errorStyles} role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${fieldId}-hint`} className={hintStyles}>
          {hint}
        </p>
      )}
    </div>
  )
}
