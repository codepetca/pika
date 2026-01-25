'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { type ReactNode } from 'react'

interface TooltipProps {
  /** The content to display in the tooltip */
  content: ReactNode
  /** The element that triggers the tooltip */
  children: ReactNode
  /** Delay in ms before showing tooltip (default: 100) */
  delayDuration?: number
  /** Side of the trigger to render tooltip (default: 'top') */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment of tooltip relative to trigger (default: 'center') */
  align?: 'start' | 'center' | 'end'
}

/**
 * Fast tooltip component using Radix UI.
 * Replaces native title attributes with customizable delay and consistent styling.
 *
 * @example
 * <Tooltip content="Open panel (⌘\)">
 *   <button><PanelRight /></button>
 * </Tooltip>
 */
export function Tooltip({
  content,
  children,
  delayDuration = 100,
  side = 'top',
  align = 'center',
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-50 rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs text-white dark:text-gray-900 shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-gray-900 dark:fill-gray-100" />
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
    <TooltipPrimitive.Provider delayDuration={100} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  )
}
