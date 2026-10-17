'use client'

import { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const cardVariants = cva(
  [
    'rounded-card shadow-elevated',
  ],
  {
    variants: {
      tone: {
        default: 'bg-surface',
        muted: 'bg-surface-2',
        panel: 'bg-surface-panel',
        accent: 'bg-info-bg',
        selected: 'bg-surface-selected',
      },
      padding: {
        none: '',
        sm: 'p-card-compact',
        md: 'p-card',
        lg: 'p-card-cozy',
      },
      interactive: {
        true: 'transition-colors duration-fast ease-standard motion-reduce:transition-none hover:bg-surface-hover',
        false: '',
      },
    },
    defaultVariants: {
      tone: 'default',
      padding: 'md',
      interactive: false,
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
export function Card({ children, tone, padding, interactive, className }: CardProps) {
  return (
    <div className={cn(cardVariants({ tone, padding, interactive }), className)}>
      {children}
    </div>
  )
}
