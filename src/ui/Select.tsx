'use client'

import { SelectHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const selectVariants = cva(
  [
    'w-full px-3 py-2 rounded-control',
    'bg-white dark:bg-gray-800',
    'text-gray-900 dark:text-white',
    'focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
    'disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed',
  ],
  {
    variants: {
      hasError: {
        true: 'border border-red-500 dark:border-red-400',
        false: 'border border-gray-300 dark:border-gray-600',
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
