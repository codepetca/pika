'use client'

import { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const cardVariants = cva(
  [
    'bg-surface',
    'border border-border',
    'rounded-card shadow-elevated',
  ],
  {
    variants: {
      padding: {
        none: '',
        sm: 'p-4',
        md: 'p-card',
        lg: 'p-6',
      },
    },
    defaultVariants: {
      padding: 'md',
    },
  }
)

export interface CardProps extends VariantProps<typeof cardVariants> {
  children: ReactNode
  className?: string
}

/**
 * Card component with consistent styling for content containers.
 *
 * @example
 * <Card>
 *   <h2>Title</h2>
 *   <p>Content goes here</p>
 * </Card>
 *
 * @example
 * <Card padding="lg" className="max-w-md">
 *   <form>...</form>
 * </Card>
 */
export function Card({ children, padding, className }: CardProps) {
  return (
    <div className={cn(cardVariants({ padding }), className)}>
      {children}
    </div>
  )
}
