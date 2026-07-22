'use client'

import { useRef, type ReactNode } from 'react'
import { ArrowLeft, PanelRight, PanelRightClose } from 'lucide-react'
import { useRightSidebar, useMobileDrawer, useThreePanel } from './ThreePanelProvider'
import { useKeyboardShortcutHint } from '@/hooks/use-keyboard-shortcut-hint'
import { ModalLayer, Tooltip } from '@/ui'

export interface RightSidebarProps {
  children: ReactNode
  className?: string
  /** Title shown in mobile drawer header */
  title?: ReactNode
  /** Optional action buttons shown in header next to title */
  headerActions?: ReactNode
  /** Hide the desktop header while keeping the mobile drawer header */
  hideDesktopHeader?: boolean
  /** Simplify the mobile drawer header to just the back control */
  minimalMobileHeader?: boolean
}

/**
 * Right sidebar (inspector panel) with configurable widths.
 * - Desktop: Docked sidebar that pushes main content
 * - Mobile: Full-screen drawer overlay with backdrop
 * - Hidden when closed (w-0, no border, overflow-hidden)
 * - No toggle button when disabled for a view
 */
export function RightSidebar({
  children,
  className,
  title = 'Details',
  headerActions,
  hideDesktopHeader = false,
  minimalMobileHeader = false,
}: RightSidebarProps) {
  const showHeader = !!(title || headerActions)
  const showDesktopHeader = showHeader && !hideDesktopHeader
  const mobileAriaLabel = typeof title === 'string' && title.trim().length > 0 ? title : 'Details'
  const { isOpen, enabled } = useRightSidebar()
  const { isRightOpen, close } = useMobileDrawer()
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null)

  // Don't render anything if right sidebar is disabled for this view
  if (!enabled) {
    return null
  }

  return (
    <>
      {/* Desktop sidebar - only render when open */}
      {isOpen && (
        <aside
          className={[
            'hidden lg:flex flex-col',
            'sticky top-12 h-[calc(100vh-3rem)]',
            'bg-surface',
            'border-l border-border',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {/* Header */}
          {showDesktopHeader && (
            <div className="flex items-center justify-between p-2 border-b border-border">
              <span className="truncate flex-1 px-2 text-sm font-semibold text-text-default">
                {title}
              </span>
              {headerActions && (
                <div className="flex items-center gap-1">{headerActions}</div>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
        </aside>
      )}

      {/* Mobile drawer */}
      <ModalLayer
        isOpen={isRightOpen}
        onClose={close}
        ariaLabel={mobileAriaLabel}
        initialFocusRef={firstFocusableRef}
        backdropLabel="Close panel"
        rootClassName="lg:hidden"
        backdropClassName="bg-black/40"
        panelClassName={[
          'absolute inset-y-0 right-0 w-full max-w-md',
          'bg-surface',
          'border-l border-border',
          'shadow-xl',
          'flex flex-col',
        ].join(' ')}
      >
        {minimalMobileHeader ? (
          <div className="flex justify-end p-3">
            <button
              ref={firstFocusableRef}
              type="button"
              onClick={close}
              className="p-2 rounded-md text-text-muted hover:bg-surface-hover"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 border-b border-border">
            <span className="text-sm font-semibold text-text-default truncate flex-1">
              {title}
            </span>
            {headerActions && (
              <div className="flex items-center gap-1 mx-2">{headerActions}</div>
            )}
            <button
              ref={firstFocusableRef}
              type="button"
              onClick={close}
              className="p-2 rounded-md text-text-muted hover:bg-surface-hover"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </ModalLayer>
    </>
  )
}

/**
 * Toggle button for opening right sidebar.
 * Place this in main content area when right sidebar is closed.
 * Hidden when right sidebar is disabled for the view.
 * Hidden on desktop when desktopAlwaysOpen is true.
 */
export function RightSidebarToggle({ className }: { className?: string }) {
  const { isOpen, enabled, toggle, desktopAlwaysOpen } = useRightSidebar()
  const { openRight } = useMobileDrawer()
  const { rightPanel } = useKeyboardShortcutHint()

  if (!enabled) return null

  const openTitle = `Open panel (${rightPanel})`
  const closeTitle = `Close panel (${rightPanel})`

  return (
    <>
      {/* Desktop toggle - hidden when desktopAlwaysOpen */}
      {!desktopAlwaysOpen && (
        <Tooltip content={isOpen ? closeTitle : openTitle}>
          <button
            type="button"
            onClick={toggle}
            aria-label={isOpen ? 'Close panel' : 'Open panel'}
            className={[
              'hidden lg:flex items-center justify-center',
              'p-2 rounded-md text-sm',
              'text-text-muted',
              'hover:bg-surface-hover',
              'hover:text-text-default',
              'transition-colors',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {isOpen ? (
              <PanelRightClose className="h-5 w-5" aria-hidden="true" />
            ) : (
              <PanelRight className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      )}

      {/* Mobile toggle */}
      <Tooltip content="Open panel">
        <button
          type="button"
          onClick={openRight}
          aria-label="Open panel"
          className={[
            'lg:hidden flex items-center justify-center',
            'p-2 rounded-md text-sm',
            'text-text-muted',
            'hover:bg-surface-hover',
            'hover:text-text-default',
            'transition-colors',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <PanelRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </Tooltip>
    </>
  )
}
