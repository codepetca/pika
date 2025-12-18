'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline'

export type ActionBarItem = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

const CONTROL_BASE =
  'rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed'

export const ACTIONBAR_BUTTON_CLASSNAME = `${CONTROL_BASE} px-3 py-1.5`
export const ACTIONBAR_ICON_BUTTON_CLASSNAME = `${CONTROL_BASE} px-2.5 py-1.5 inline-flex items-center justify-center`

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
  return <div className={['mt-3', className].join(' ')}>{children}</div>
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
        <EllipsisVerticalIcon className="h-5 w-5 text-gray-700 dark:text-gray-200" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden z-20"
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
              className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {item.label}
            </button>
          ))}

          {destructiveItems.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
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
                  className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
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
  className = '',
}: {
  primary: ReactNode
  actions?: ActionBarItem[]
  className?: string
}) {
  return (
    <div className={['w-full flex items-start gap-2', className].join(' ')}>
      <div className="min-w-0 flex-1">{primary}</div>

      {actions.length > 0 && (
        <>
          <div className="hidden sm:flex items-center gap-2">
            {actions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={ACTIONBAR_BUTTON_CLASSNAME}
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
    </div>
  )
}

