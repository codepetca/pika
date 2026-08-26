'use client'

import Link from 'next/link'
import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react'
import { PikaLogo } from '@/components/PikaLogo'
import { useLeftSidebar, useMobileDrawer } from './ThreePanelProvider'
import { ModalLayer, Tooltip } from '@/ui'

export interface LeftSidebarProps {
  children: ReactNode
  className?: string
  mobileHomeHref?: string
  onNavigateHome?: (href: string) => boolean
}

/**
 * Left sidebar with icon rail (collapsed) and full nav (expanded).
 * - Desktop: Docked sidebar that pushes main content
 * - Mobile: Full-screen drawer overlay with backdrop
 */
export function LeftSidebar({
  children,
  className,
  mobileHomeHref,
  onNavigateHome,
}: LeftSidebarProps) {
  const { isExpanded, toggle } = useLeftSidebar()
  const { isLeftOpen, close } = useMobileDrawer()
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null)

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
      <ModalLayer
        isOpen={isLeftOpen}
        onClose={close}
        ariaLabel="Navigation menu"
        initialFocusRef={firstFocusableRef}
        backdropLabel="Close navigation"
        rootClassName="lg:hidden"
        backdropClassName="bg-black/40"
        panelClassName={[
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
        <div className="flex-1 overflow-y-auto p-3">
          {mobileHomeHref && (
            <div className="mb-3 border-b border-border pb-3">
              <Link
                href={mobileHomeHref}
                onClick={(event) => {
                  const allow = onNavigateHome?.(mobileHomeHref)
                  if (allow === false) {
                    event.preventDefault()
                    return
                  }
                  close()
                }}
                className="flex h-12 w-full min-w-0 items-center gap-3 rounded-control bg-surface-2 px-3 font-medium text-text-default transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
                aria-label="All classrooms"
              >
                <PikaLogo className="h-8 w-8 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">All classrooms</span>
              </Link>
            </div>
          )}
          {children}
        </div>
      </ModalLayer>
    </>
  )
}
