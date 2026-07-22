'use client'

import { InputHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const inputVariants = cva(
  [
    'min-h-11 w-full rounded-control px-3 py-2',
    'bg-surface',
    'text-text-default',
    'focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary',
    'aria-[invalid=true]:border-danger',
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
