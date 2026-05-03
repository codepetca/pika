'use client'

import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react'
import { forwardRef } from 'react'
import { cn } from '@/ui/utils'

export type TeacherWorkItemCardTone = 'default' | 'muted' | 'scheduled' | 'selected'

interface TeacherWorkItemCardFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  tone?: TeacherWorkItemCardTone
  interactive?: boolean
  dragging?: boolean
  className?: string
  style?: CSSProperties
}

export const TeacherWorkItemCardFrame = forwardRef(function TeacherWorkItemCardFrame(
  {
    children,
    tone = 'default',
    interactive = true,
    dragging = false,
    className,
    ...props
  }: TeacherWorkItemCardFrameProps,
  ref: Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'w-full rounded-card border p-3.5 text-left shadow-elevated',
        tone === 'selected'
          ? 'border-primary bg-surface-selected shadow-panel'
          : tone === 'scheduled'
            ? 'border-warning bg-warning-bg'
            : tone === 'muted'
              ? 'border-border-strong bg-surface-2'
              : 'border-border bg-surface-panel',
        dragging
          ? 'z-50 scale-[1.02] border-primary opacity-95 shadow-panel'
          : interactive && tone === 'scheduled'
            ? 'transition hover:border-warning hover:bg-warning-bg'
            : interactive && tone === 'muted'
              ? 'transition hover:border-border-strong hover:bg-surface-3'
              : interactive && tone === 'default'
                ? 'transition hover:-translate-y-px hover:border-border-strong hover:bg-surface-accent hover:shadow-panel'
                : '',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})
