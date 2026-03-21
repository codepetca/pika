'use client'

import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { buttonVariants } from '@/ui/Button'
import { cn } from '@/ui/utils'

export type PageDensity = 'default' | 'teacher' | 'student'

const PageDensityContext = createContext<PageDensity>('default')

export type ActionBarItem = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  primary?: boolean
}

export const ACTIONBAR_BUTTON_CLASSNAME = cn(
  buttonVariants({ variant: 'subtle', size: 'sm' }),
  'min-h-10'
)
export const ACTIONBAR_BUTTON_PRIMARY_CLASSNAME = cn(
  buttonVariants({ variant: 'primary', size: 'sm' }),
  'min-h-10'
)
export const ACTIONBAR_BUTTON_SECONDARY_CLASSNAME = cn(
  buttonVariants({ variant: 'secondary', size: 'sm' }),
  'min-h-10'
)
export const ACTIONBAR_ICON_BUTTON_CLASSNAME = cn(
  buttonVariants({ variant: 'subtle', size: 'sm' }),
  'h-10 w-10 p-0'
)
export const ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME = cn(
  buttonVariants({ variant: 'subtle', size: 'sm' }),
  'min-h-10 px-4'
)

export function PageLayout({
  children,
  className = '',
  bleedX = true,
}: {
  children: ReactNode
  className?: string
  bleedX?: boolean
}) {
  const density = useContext(PageDensityContext)
  const frameClass =
    !bleedX
      ? ''
      : density === 'teacher'
        ? '-mx-3'
        : density === 'student'
          ? '-mx-4'
          : '-mx-4'

  return <div className={cn('w-auto flex flex-col', frameClass, className)}>{children}</div>
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
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const density = useContext(PageDensityContext)
  const spacingClass =
    density === 'teacher'
      ? 'px-3 pt-3'
      : density === 'student'
        ? 'px-4 pt-4'
        : 'px-4 pt-2'

  return <div className={cn(spacingClass, className)}>{children}</div>
}

export function PageStack({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const density = useContext(PageDensityContext)
  const spacingClass =
    density === 'teacher' ? 'space-y-3' : density === 'student' ? 'space-y-4' : 'space-y-4'

  return <div className={cn(spacingClass, className)}>{children}</div>
}

function ActionBarMenu({ items }: { items: ActionBarItem[] }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current) return
      if (e.target instanceof Node && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const { normalItems, destructiveItems } = useMemo(() => {
    return {
      normalItems: items.filter((i) => !i.destructive),
      destructiveItems: items.filter((i) => !!i.destructive),
    }
  }, [items])

  if (items.length === 0) return null

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={ACTIONBAR_ICON_BUTTON_CLASSNAME}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open actions menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5 text-text-default" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          {normalItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="w-full text-left px-3 py-2 text-sm text-text-default hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
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
                    setOpen(false)
                    item.onSelect()
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-danger-bg disabled:opacity-50 disabled:cursor-not-allowed"
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

export function PageActionBar({
  primary,
  actions = [],
  actionsAlign = 'end',
  trailing,
  className = '',
}: {
  primary: ReactNode
  actions?: ActionBarItem[]
  actionsAlign?: 'start' | 'end'
  trailing?: ReactNode
  className?: string
}) {
  const density = useContext(PageDensityContext)
  const frameClass =
    density === 'teacher'
      ? 'px-3'
      : density === 'student'
        ? 'px-4'
        : 'px-4'
  const outerClass = cn(
    'mt-header-compact w-full bg-page',
    frameClass,
    className,
  )

  if (actionsAlign === 'start') {
    return (
      <div className={outerClass}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0">{primary}</div>

        {actions.length > 0 && (
          <>
            <div className="hidden sm:flex flex-wrap items-center justify-start gap-2">
              {actions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    item.primary
                      ? ACTIONBAR_BUTTON_PRIMARY_CLASSNAME
                      : ACTIONBAR_BUTTON_CLASSNAME,
                    item.primary
                      ? ''
                      : item.destructive
                        ? 'border-danger bg-danger-bg text-danger hover:bg-danger-bg-hover'
                        : ''
                  )}
                  onClick={item.onSelect}
                  disabled={item.disabled}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="sm:hidden">
              <ActionBarMenu items={actions} />
            </div>
          </>
        )}

        <div className="flex-1" />
        {trailing}
        </div>
      </div>
    )
  }

  return (
    <div className={outerClass}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">{primary}</div>

      {actions.length > 0 && (
        <>
          <div className="hidden sm:flex flex-wrap items-center justify-end gap-2">
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
          <div className="sm:hidden">
            <ActionBarMenu items={actions} />
          </div>
        </>
      )}
      {trailing}
      </div>
    </div>
  )
}
