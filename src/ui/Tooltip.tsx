'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { type ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from './utils'

// Tooltip content styles with CVA
const tooltipContentStyles = cva([
  'z-50 max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border px-3 py-2 text-xs leading-relaxed pointer-events-none',
  'bg-surface',
  'text-text-default',
  'shadow-lg border-border-strong',
])

export interface TooltipProps {
  /** The content to display in the tooltip */
  content: ReactNode
  /** The element that triggers the tooltip */
  children: ReactNode
  /** Whether the tooltip content itself can be hovered/clicked */
  interactive?: boolean
  /** Delay in ms before showing tooltip (default: 100) */
  delayDuration?: number
  /** Side of the trigger to render tooltip (default: 'bottom') */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment of tooltip relative to trigger (default: 'center') */
  align?: 'start' | 'center' | 'end'
  /** Optional Tailwind classes for the tooltip content wrapper */
  className?: string
}

/**
 * Fast tooltip component using Radix UI.
 * Replaces native title attributes with customizable delay and consistent styling.
 *
 * @example
 * <Tooltip content="Open panel">
 *   <button><PanelRight /></button>
 * </Tooltip>
 */
export function Tooltip({
  content,
  children,
  interactive = false,
  delayDuration = 100,
  side = 'bottom',
  align = 'center',
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration} disableHoverableContent={!interactive}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={4}
          className={cn(tooltipContentStyles(), interactive && 'pointer-events-auto', className)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/**
 * Provider that enables tooltips throughout the app.
 * Wrap your app or layout with this component.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={100} skipDelayDuration={300} disableHoverableContent>
      {children}
    </TooltipPrimitive.Provider>
  )
}
