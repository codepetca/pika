'use client'

import { type ReactNode } from 'react'
import { useThreePanel } from './ThreePanelProvider'

export interface ThreePanelShellProps {
  children: ReactNode
  className?: string
}

/**
 * CSS Grid container for 3-panel layout.
 * Uses grid-template-columns with transitions for smooth resizing.
 *
 * Desktop: [left-sidebar] [main-content] [right-sidebar]
 * Mobile: Full-width main content with overlay drawers
 */
export function ThreePanelShell({ children, className }: ThreePanelShellProps) {
  const { widths, config, rightSidebar } = useThreePanel()

  // Calculate grid template columns
  // On desktop (lg+): left sidebar, 1fr main, right sidebar
  // The right sidebar is 0 width when closed or disabled
  const rightWidth =
    config.rightSidebar.enabled && rightSidebar.isOpen ? widths.right : '0px'

  return (
    <div
      className={[
        'min-h-[calc(100vh-3rem)]', // Full height minus 48px header
        'bg-page',
        // Mobile: single column
        'grid grid-cols-1',
        // Desktop: 3-column grid with transitions
        'lg:grid-cols-[var(--left-width)_1fr_var(--right-width)]',
        'lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--left-width': `${widths.left}px`,
          '--right-width': rightWidth,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}
