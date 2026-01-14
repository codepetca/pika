'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useRightSidebar, useMobileDrawer, useThreePanel } from './ThreePanelProvider'

export interface RightSidebarProps {
  children: ReactNode
  className?: string
  /** Title shown in mobile drawer header */
  title?: string
  /** Optional action buttons shown in header next to title */
  headerActions?: ReactNode
}

/**
 * Right sidebar (inspector panel) with configurable widths.
 * - Desktop: Docked sidebar that pushes main content
 * - Mobile: Full-screen drawer overlay with backdrop
 * - Hidden when closed (w-0, no border, overflow-hidden)
 * - No toggle button when disabled for a view
 */
export function RightSidebar({ children, className, title = 'Details', headerActions }: RightSidebarProps) {
  const { isOpen, enabled, toggle } = useRightSidebar()
  const { isRightOpen, close } = useMobileDrawer()
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null)

  // Escape key to close mobile drawer
  useEffect(() => {
    if (!isRightOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [isRightOpen, close])

  // Focus first element when mobile drawer opens
  useEffect(() => {
    if (isRightOpen) {
      firstFocusableRef.current?.focus()
    }
  }, [isRightOpen])

  // Don't render anything if right sidebar is disabled for this view
  if (!enabled) {
    return null
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        aria-expanded={isOpen}
        className={[
          'hidden lg:flex flex-col',
          'sticky top-12 h-[calc(100vh-3rem)]',
          'bg-white dark:bg-gray-900',
          'transition-opacity duration-200 ease-out',
          // When closed: completely hidden
          isOpen
            ? 'border-l border-gray-200 dark:border-gray-800 opacity-100'
            : 'border-l-0 opacity-0 overflow-hidden pointer-events-none',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Toggle button */}
        <div className="flex items-center justify-between p-2 border-b border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={toggle}
            title={isOpen ? 'Close panel' : 'Open panel'}
            aria-label={isOpen ? 'Close panel' : 'Open panel'}
            className={[
              'p-2 rounded-md text-sm',
              'text-gray-600 dark:text-gray-300',
              'hover:bg-gray-100 dark:hover:bg-gray-800',
              'hover:text-gray-900 dark:hover:text-gray-100',
              'transition-colors',
            ].join(' ')}
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          {isOpen && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate flex-1 text-center">
              {title}
            </span>
          )}
          {isOpen && headerActions ? (
            <div className="flex items-center gap-1">{headerActions}</div>
          ) : (
            <div className="w-9" /> /* Spacer for alignment */
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
      </aside>

      {/* Mobile drawer */}
      {isRightOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close panel"
            className="absolute inset-0 bg-black/40"
            onClick={close}
          />

          {/* Drawer panel - slides in from right */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={[
              'absolute inset-y-0 right-0 w-full max-w-md',
              'bg-white dark:bg-gray-900',
              'border-l border-gray-200 dark:border-gray-800',
              'shadow-xl',
              'flex flex-col',
            ].join(' ')}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex-1">
                {title}
              </span>
              {headerActions && (
                <div className="flex items-center gap-1 mx-2">{headerActions}</div>
              )}
              <button
                ref={firstFocusableRef}
                type="button"
                onClick={close}
                className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close panel"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">{children}</div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Toggle button for opening right sidebar.
 * Place this in main content area when right sidebar is closed.
 * Hidden when right sidebar is disabled for the view.
 */
export function RightSidebarToggle({ className }: { className?: string }) {
  const { isOpen, enabled, toggle } = useRightSidebar()
  const { openRight } = useMobileDrawer()

  if (!enabled) return null

  return (
    <>
      {/* Desktop toggle */}
      <button
        type="button"
        onClick={toggle}
        title={isOpen ? 'Close panel' : 'Open panel'}
        aria-label={isOpen ? 'Close panel' : 'Open panel'}
        className={[
          'hidden lg:flex items-center justify-center',
          'p-2 rounded-md text-sm',
          'text-gray-500 dark:text-gray-400',
          'hover:bg-gray-100 dark:hover:bg-gray-800',
          'hover:text-gray-700 dark:hover:text-gray-200',
          'transition-colors',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isOpen ? (
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        ) : (
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        )}
      </button>

      {/* Mobile toggle */}
      <button
        type="button"
        onClick={openRight}
        title="Open panel"
        aria-label="Open panel"
        className={[
          'lg:hidden flex items-center justify-center',
          'p-2 rounded-md text-sm',
          'text-gray-500 dark:text-gray-400',
          'hover:bg-gray-100 dark:hover:bg-gray-800',
          'hover:text-gray-700 dark:hover:text-gray-200',
          'transition-colors',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
    </>
  )
}
