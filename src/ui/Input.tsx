'use client'

import { InputHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const inputVariants = cva(
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

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

/**
 * Bare input component without label or error message.
 * Always wrap with FormField for labels and error messages.
 *
 * @example
 * <FormField label="Email" error={errors.email}>
 *   <Input type="email" value={email} onChange={...} />
 * </FormField>
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ hasError, className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(inputVariants({ hasError }), className)}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
