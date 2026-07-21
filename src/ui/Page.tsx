'use client'

import type { ElementType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { buttonVariants } from './Button'
import { cn } from './utils'

export type PageDensity = 'default' | 'teacher' | 'student'
export type PageWidth = 'reading' | 'standard' | 'wide' | 'full'

const PageDensityContext = createContext<PageDensity>('default')

const PAGE_WIDTH_CLASSES: Record<PageWidth, string> = {
  reading: 'max-w-2xl',
  standard: 'max-w-4xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
}

const PAGE_DENSITY_CLASSES: Record<
  PageDensity,
  { gutter: string; bleed: string; contentTop: string; stackGap: string }
> = {
  default: {
    gutter: 'px-3',
    bleed: '-mx-3',
    contentTop: 'pt-2',
    stackGap: 'space-y-3',
  },
  teacher: {
    gutter: 'px-3',
    bleed: '-mx-3',
    contentTop: 'pt-2',
    stackGap: 'space-y-3',
  },
  student: {
    gutter: 'px-4',
    bleed: '-mx-4',
    contentTop: 'pt-3',
    stackGap: 'space-y-4',
  },
}

export type ActionBarItem = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  primary?: boolean
}

export const ACTIONBAR_BUTTON_CLASSNAME = buttonVariants({ variant: 'subtle', size: 'sm' })
export const ACTIONBAR_BUTTON_PRIMARY_CLASSNAME = buttonVariants({ variant: 'primary', size: 'sm' })
export const ACTIONBAR_BUTTON_SECONDARY_CLASSNAME = buttonVariants({ variant: 'secondary', size: 'sm' })
export const ACTIONBAR_ICON_BUTTON_CLASSNAME = cn(
  buttonVariants({ variant: 'subtle', size: 'sm' }),
  'h-11 w-11 p-0',
)
export const ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME = cn(
  buttonVariants({ variant: 'subtle', size: 'sm' }),
  'px-4',
)

export interface PageLayoutProps {
  children: ReactNode
  className?: string
  bleedX?: boolean
  density?: PageDensity
  width?: PageWidth
}

export function PageLayout({
  children,
  className,
  bleedX = true,
  density,
  width = 'full',
}: PageLayoutProps) {
  const inheritedDensity = useContext(PageDensityContext)
  const resolvedDensity = density ?? inheritedDensity
  const densityClasses = PAGE_DENSITY_CLASSES[resolvedDensity]
  const constrained = width !== 'full'

  const page = (
    <div
      className={cn(
        'flex w-auto min-w-0 flex-col',
        bleedX && !constrained ? densityClasses.bleed : '',
        constrained ? 'mx-auto w-full' : '',
        PAGE_WIDTH_CLASSES[width],
        className,
      )}
    >
      {children}
    </div>
  )

  if (!density) return page

  return (
    <PageDensityContext.Provider value={resolvedDensity}>
      {page}
    </PageDensityContext.Provider>
  )
}

export function PageDensityProvider({
  children,
  density,
}: {
  children: ReactNode
  density: PageDensity
}) {
  return (
    <PageDensityContext.Provider value={density}>
      {children}
    </PageDensityContext.Provider>
  )
}

export function PageContent({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const density = useContext(PageDensityContext)
  const densityClasses = PAGE_DENSITY_CLASSES[density]

  return (
    <div className={cn(densityClasses.gutter, densityClasses.contentTop, className)}>
      {children}
    </div>
  )
}

export function PageStack({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const density = useContext(PageDensityContext)

  return <div className={cn(PAGE_DENSITY_CLASSES[density].stackGap, className)}>{children}</div>
}

export interface PageHeadingProps {
  title: ReactNode
  description?: ReactNode
  level?: 'h1' | 'h2' | 'h3'
  size?: 'page' | 'section'
  className?: string
}

export function PageHeading({
  title,
  description,
  level = 'h1',
  size = 'page',
  className,
}: PageHeadingProps) {
  const Heading = level as ElementType

  return (
    <div className={cn('min-w-0', className)}>
      <Heading
        className={cn(
          'truncate text-text-default',
          size === 'page'
            ? 'text-2xl font-semibold leading-8'
            : 'text-sm font-semibold leading-5',
        )}
      >
        {title}
      </Heading>
      {description ? (
        <div
          className={cn(
            'text-text-muted',
            size === 'page' ? 'mt-1 text-sm leading-5' : 'text-xs leading-5',
          )}
        >
          {description}
        </div>
      ) : null}
    </div>
  )
}

function ActionBarMenu({ items }: { items: ActionBarItem[] }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  const getEnabledMenuItems = useCallback(() => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    ).filter((item) => !item.disabled)
  }, [])

  const closeMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    setOpen(false)
    if (options?.restoreFocus) {
      buttonRef.current?.focus()
    }
  }, [])

  const handleMenuKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      closeMenu({ restoreFocus: true })
      return
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return

    const enabledItems = getEnabledMenuItems()
    if (enabledItems.length === 0) return

    e.preventDefault()
    const currentIndex = enabledItems.indexOf(document.activeElement as HTMLButtonElement)
    const lastIndex = enabledItems.length - 1
    const nextIndex =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? lastIndex
          : e.key === 'ArrowUp'
            ? currentIndex <= 0
              ? lastIndex
              : currentIndex - 1
            : currentIndex === -1 || currentIndex === lastIndex
              ? 0
              : currentIndex + 1

    enabledItems[nextIndex]?.focus()
  }, [closeMenu, getEnabledMenuItems])

  useEffect(() => {
    if (!open) return

    const enabledItems = getEnabledMenuItems()
    enabledItems[0]?.focus()

    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current) return
      if (e.target instanceof Node && !containerRef.current.contains(e.target)) {
        closeMenu({ restoreFocus: true })
      }
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [closeMenu, getEnabledMenuItems, open])

  const { normalItems, destructiveItems } = useMemo(() => {
    return {
      normalItems: items.filter((item) => !item.destructive),
      destructiveItems: items.filter((item) => item.destructive),
    }
  }, [items])

  if (items.length === 0) return null

  const menuItemClassName =
    'min-h-11 w-full px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={ACTIONBAR_ICON_BUTTON_CLASSNAME}
        onClick={() => {
          if (open) {
            closeMenu({ restoreFocus: true })
            return
          }
          setOpen(true)
        }}
        aria-label="Open actions menu"
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5 text-text-default" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          {normalItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                closeMenu({ restoreFocus: true })
                item.onSelect()
              }}
              className={cn(menuItemClassName, 'text-text-default hover:bg-surface-hover')}
            >
              {item.label}
            </button>
          ))}

          {destructiveItems.length > 0 && (
            <div className="border-t border-border">
              {destructiveItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    closeMenu({ restoreFocus: true })
                    item.onSelect()
                  }}
                  className={cn(menuItemClassName, 'text-danger hover:bg-danger-bg')}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface PageActionBarProps {
  primary: ReactNode
  actions?: ActionBarItem[]
  actionsAlign?: 'start' | 'end'
  trailing?: ReactNode
  className?: string
}

export function PageActionBar({
  primary,
  actions = [],
  actionsAlign = 'end',
  trailing,
  className,
}: PageActionBarProps) {
  const density = useContext(PageDensityContext)
  const actionAlignment = actionsAlign === 'start' ? 'justify-start' : 'justify-end'

  return (
    <div className={cn('w-full bg-page', PAGE_DENSITY_CLASSES[density].gutter, className)}>
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn('min-w-0', actionsAlign === 'end' ? 'flex-1' : '')}>{primary}</div>

        {actions.length > 0 && (
          <>
            <div className={cn('hidden flex-wrap items-center gap-2 sm:flex', actionAlignment)}>
              {actions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    item.primary
                      ? ACTIONBAR_BUTTON_PRIMARY_CLASSNAME
                      : ACTIONBAR_BUTTON_CLASSNAME,
                    item.destructive
                      ? 'border-danger bg-danger-bg text-danger hover:bg-danger-bg-hover'
                      : '',
                  )}
                  onClick={item.onSelect}
                  disabled={item.disabled}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="shrink-0 sm:hidden">
              <ActionBarMenu items={actions} />
            </div>
          </>
        )}

        {actionsAlign === 'start' ? <div className="flex-1" /> : null}
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </div>
  )
}
