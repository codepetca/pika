'use client'

import type { ReactNode } from 'react'
import { Card } from './Card'
import { cn } from './utils'

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
  tone?: 'default' | 'muted' | 'panel' | 'accent'
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  tone = 'panel',
}: EmptyStateProps) {
  return (
    <Card tone={tone} padding="lg" className={cn('text-center', className)}>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
        {icon ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-accent text-primary">
            {icon}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-text-default">{title}</h2>
          {description ? (
            <div className="text-sm leading-6 text-text-muted">{description}</div>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </Card>
  )
}
