'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'

export type ActionBarItem = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  primary?: boolean
}

const CONTROL_BASE =
  'rounded-md border border-primary bg-info-bg text-base font-medium text-text-default hover:bg-info-bg-hover disabled:opacity-50 disabled:cursor-not-allowed'

const CONTROL_SECONDARY_BASE =
  'rounded-md border border-border bg-surface text-base font-medium text-text-default hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed'

const CONTROL_PRIMARY_BASE =
  'rounded-md border border-transparent bg-primary text-base font-medium text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed'

export const ACTIONBAR_BUTTON_CLASSNAME = `${CONTROL_BASE} px-3 py-2`
export const ACTIONBAR_BUTTON_PRIMARY_CLASSNAME = `${CONTROL_PRIMARY_BASE} px-3 py-2`
export const ACTIONBAR_BUTTON_SECONDARY_CLASSNAME = `${CONTROL_SECONDARY_BASE} px-3 py-2`
export const ACTIONBAR_ICON_BUTTON_CLASSNAME = `${CONTROL_BASE} px-2.5 py-2 inline-flex items-center justify-center`

export function PageLayout({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={['w-full', className].join(' ')}>{children}</div>
}

export function PageContent({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={['mt-2', className].join(' ')}>{children}</div>
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
          className="absolute right-0 mt-2 w-56 rounded-md border border-border bg-surface shadow-lg overflow-hidden z-20"
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
  if (actionsAlign === 'start') {
    return (
      <div className={['w-full flex items-start gap-2', className].join(' ')}>
        <div className="min-w-0">{primary}</div>

        {actions.length > 0 && (
          <>
            <div className="hidden sm:flex flex-wrap items-center justify-start gap-2">
              {actions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    item.primary
                      ? ACTIONBAR_BUTTON_PRIMARY_CLASSNAME
                      : ACTIONBAR_BUTTON_CLASSNAME,
                    item.destructive
                      ? 'border-danger bg-danger-bg text-danger hover:bg-danger-bg-hover'
                      : '',
                  ].join(' ')}
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
    )
  }

  return (
    <div className={['w-full flex items-start gap-2', className].join(' ')}>
      <div className="min-w-0 flex-1">{primary}</div>

      {actions.length > 0 && (
        <>
          <div className="hidden sm:flex flex-wrap items-center justify-end gap-2">
            {actions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={[
                  item.primary
                    ? ACTIONBAR_BUTTON_PRIMARY_CLASSNAME
                    : ACTIONBAR_BUTTON_CLASSNAME,
                  item.destructive
                    ? 'border-danger bg-danger-bg text-danger hover:bg-danger-bg-hover'
                    : '',
                ].join(' ')}
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
  )
}
