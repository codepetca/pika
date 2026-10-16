'use client'

import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react'
import { forwardRef } from 'react'
import { cn } from '@/ui'

export type TeacherWorkItemCardTone = 'default' | 'muted' | 'scheduled' | 'selected'

interface TeacherWorkItemCardFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  tone?: TeacherWorkItemCardTone
  interactive?: boolean
  dragging?: boolean
  dragTone?: 'primary' | 'neutral'
  className?: string
  style?: CSSProperties
}

export const TeacherWorkItemCardFrame = forwardRef(function TeacherWorkItemCardFrame(
  {
    children,
    tone = 'default',
    interactive = true,
    dragging = false,
    dragTone = 'primary',
    className,
    ...props
  }: TeacherWorkItemCardFrameProps,
  ref: Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'w-full rounded-card p-3.5 text-left shadow-elevated',
        tone === 'selected'
          ? 'bg-surface-selected shadow-panel'
          : tone === 'scheduled'
            ? 'bg-warning-bg'
            : tone === 'muted'
              ? 'bg-surface-2'
              : 'bg-surface-panel',
        dragging
          ? [
              'z-50 scale-[1.02] border opacity-95 shadow-panel',
              dragTone === 'neutral' ? 'border-border' : 'border-primary',
            ].join(' ')
          : interactive && tone === 'scheduled'
            ? 'transition hover:bg-warning-bg'
            : interactive && tone === 'muted'
              ? 'transition hover:bg-surface-3'
              : interactive && tone === 'default'
                ? 'transition hover:-translate-y-px hover:bg-info-bg hover:shadow-panel'
                : '',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})
