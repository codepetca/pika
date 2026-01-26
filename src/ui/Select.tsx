'use client'

import { SelectHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const selectVariants = cva(
  [
    'w-full px-3 py-2 rounded-control',
    'bg-surface',
    'text-text-default',
    'focus:ring-2 focus:ring-primary focus:border-primary',
    'disabled:bg-surface-2 disabled:cursor-not-allowed',
  ],
  {
    variants: {
      hasError: {
        true: 'border border-danger',
        false: 'border border-border',
      },
    },
    defaultVariants: {
      hasError: false,
    },
  }
)

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>,
    VariantProps<typeof selectVariants> {
  options: SelectOption[]
  placeholder?: string
}

/**
 * Select component with consistent styling.
 * Always wrap with FormField for labels and error messages.
 *
 * @example
 * <FormField label="Country" error={errors.country}>
 *   <Select
 *     options={[
 *       { value: 'us', label: 'United States' },
 *       { value: 'ca', label: 'Canada' },
 *     ]}
 *     value={country}
 *     onChange={(e) => setCountry(e.target.value)}
 *   />
 * </FormField>
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, hasError, className, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(selectVariants({ hasError }), className)}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }
)

Select.displayName = 'Select'
