'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { type ReactNode } from 'react'
import { cva } from 'class-variance-authority'

// Tooltip content styles with CVA
const tooltipContentStyles = cva([
  'z-50 rounded px-2 py-1 text-[11px] leading-tight pointer-events-none',
  'bg-surface-2',
  'text-text-default',
  'shadow-sm border border-border',
])

export interface TooltipProps {
  /** The content to display in the tooltip */
  content: ReactNode
  /** The element that triggers the tooltip */
  children: ReactNode
  /** Delay in ms before showing tooltip (default: 100) */
  delayDuration?: number
  /** Side of the trigger to render tooltip (default: 'bottom') */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment of tooltip relative to trigger (default: 'center') */
  align?: 'start' | 'center' | 'end'
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
  delayDuration = 100,
  side = 'bottom',
  align = 'center',
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={4}
          className={tooltipContentStyles()}
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
