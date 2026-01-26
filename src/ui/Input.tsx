'use client'

import { InputHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const inputVariants = cva(
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
