'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react'
import { useLeftSidebar, useMobileDrawer } from './ThreePanelProvider'
import { Tooltip } from '@/ui'

export interface LeftSidebarProps {
  children: ReactNode
  className?: string
}

/**
 * Left sidebar with icon rail (collapsed) and full nav (expanded).
 * - Desktop: Docked sidebar that pushes main content
 * - Mobile: Full-screen drawer overlay with backdrop
 */
export function LeftSidebar({ children, className }: LeftSidebarProps) {
  const { isExpanded, toggle } = useLeftSidebar()
  const { isLeftOpen, close } = useMobileDrawer()
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null)

  // Escape key to close mobile drawer
  useEffect(() => {
    if (!isLeftOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [isLeftOpen, close])

  // Focus first element when mobile drawer opens
  useEffect(() => {
    if (isLeftOpen) {
      firstFocusableRef.current?.focus()
    }
  }, [isLeftOpen])

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={[
          'hidden lg:flex flex-col',
          'sticky top-12 h-[calc(100vh-3rem)]',
          'border-r border-border',
          'bg-surface',
          'transition-[width] duration-200 ease-out',
          'overflow-hidden',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Nav content */}
        <div
          className={[
            'flex-1 overflow-y-auto overflow-x-hidden',
            isExpanded ? 'p-3' : 'py-3 px-0.5',
          ].join(' ')}
        >
          {children}
        </div>

        {/* Toggle button */}
        <div
          className={[
            'border-t border-border',
            isExpanded ? 'p-3' : 'py-3 px-0.5',
          ].join(' ')}
        >
          <Tooltip content={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}>
            <button
              type="button"
              onClick={toggle}
              aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              className={[
                'flex items-center rounded-md text-sm font-medium',
                'text-text-muted',
                'hover:bg-surface-hover',
                'hover:text-text-default',
                'transition-colors',
                isExpanded
                  ? 'w-full h-12 gap-3 px-3'
                  : 'justify-center w-12 h-12 mx-auto',
              ].join(' ')}
            >
              {isExpanded ? (
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Mobile drawer */}
      {isLeftOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40"
            onClick={close}
          />

          {/* Drawer panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className={[
              'absolute inset-y-0 left-0 w-72',
              'bg-surface',
              'border-r border-border',
              'shadow-xl',
              'flex flex-col',
            ].join(' ')}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                <Menu className="h-6 w-6 text-text-muted" aria-hidden="true" />
                <span>Navigation</span>
              </div>
              <button
                ref={firstFocusableRef}
                type="button"
                onClick={close}
                className="p-2 rounded-md text-text-muted hover:bg-surface-hover"
                aria-label="Close navigation"
              >
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>

            {/* Nav content */}
            <div className="flex-1 overflow-y-auto p-3">{children}</div>
          </div>
        </div>
      )}
    </>
  )
}
