'use client'

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './utils'

export interface TabItem<TValue extends string> {
  value: TValue
  label: ReactNode
  disabled?: boolean
}

export interface TabsProps<TValue extends string> {
  ariaLabel: string
  items: readonly TabItem<TValue>[]
  value: TValue
  onValueChange: (value: TValue) => void
  variant?: 'underline' | 'connected'
  className?: string
  getTabId?: (value: TValue) => string
  getPanelId?: (value: TValue) => string
}

export function Tabs<TValue extends string>({
  ariaLabel,
  items,
  value,
  onValueChange,
  variant = 'underline',
  className,
  getTabId,
  getPanelId,
}: TabsProps<TValue>) {
  const generatedId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const lastLayoutRef = useRef<{ tab: HTMLElement; geometry: number[] } | null>(null)

  // Reconnect to the current tab nodes after each render, but only reveal a new
  // selection or changed layout. Scroll position is deliberately not a trigger:
  // people can browse other tabs without a rerender snapping them back.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const revealSelection = () => {
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!tab) {
        lastLayoutRef.current = null
        return
      }
      const geometry = [list.clientWidth, list.scrollWidth, tab.offsetLeft, tab.offsetWidth]
      const previous = lastLayoutRef.current
      if (previous?.tab === tab && geometry.every((size, index) => size === previous.geometry[index])) return
      lastLayoutRef.current = { tab, geometry }
      if (list.clientWidth === 0 || tab.offsetWidth === 0) return

      // Hydration or a resize can happen between pointer down and click. Keep
      // the pressed tab in place; its activation will reveal the new selection.
      if (list.querySelector('[role="tab"]:active')) return

      const viewportLeft = list.getBoundingClientRect().left + list.clientLeft
      const viewportRight = viewportLeft + list.clientWidth
      const rect = tab.getBoundingClientRect()
      const leftDelta = rect.left - viewportLeft
      const rightDelta = rect.right - viewportRight
      // An oversized label cannot fit: keep it still if it already covers the
      // viewport, otherwise reveal the nearest edge without alternating sides.
      if (leftDelta <= 0 && rightDelta >= 0) return
      const delta = rect.width > list.clientWidth
        ? leftDelta > 0 ? leftDelta : rightDelta
        : leftDelta < 0 ? leftDelta : rightDelta > 0 ? rightDelta : 0
      if (delta !== 0) list.scrollLeft += delta
    }

    revealSelection()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(revealSelection)
    observer.observe(list)
    // Earlier labels can push the selected tab out of view without changing
    // the list's width or the selected label's own size.
    list.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => observer.observe(tab))
    return () => observer.disconnect()
  })
  const enabledItems = items.filter((item) => !item.disabled)
  const activeItem = items.find((item) => item.value === value && !item.disabled)
  const tabbableValue = activeItem?.value ?? enabledItems[0]?.value

  const resolveTabId = (itemValue: TValue) =>
    getTabId?.(itemValue) ?? `${generatedId}-${itemValue}-tab`
  const resolvePanelId = (itemValue: TValue) => getPanelId?.(itemValue)

  const activateItem = (item: TabItem<TValue>) => {
    if (item.disabled) return
    document.getElementById(resolveTabId(item.value))?.focus()
    onValueChange(item.value)
  }

  const moveFrom = (index: number, direction: 1 | -1) => {
    if (items.length === 0) return

    for (let offset = 1; offset <= items.length; offset += 1) {
      const nextIndex = (index + offset * direction + items.length) % items.length
      const candidate = items[nextIndex]
      if (candidate && !candidate.disabled) {
        activateItem(candidate)
        return
      }
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (enabledItems.length === 0) return

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveFrom(index, 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveFrom(index, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      activateItem(enabledItems[0])
    } else if (event.key === 'End') {
      event.preventDefault()
      activateItem(enabledItems[enabledItems.length - 1])
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(
        variant === 'connected'
          ? 'mb-[-1px] flex min-w-0 max-w-full items-end gap-1 overflow-x-auto'
          : 'flex min-w-0 max-w-full gap-1 overflow-x-auto',
        className,
      )}
    >
      {items.map((item, index) => {
        const isActive = item.value === value
        return (
          <button
            key={item.value}
            id={resolveTabId(item.value)}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={resolvePanelId(item.value)}
            aria-disabled={item.disabled || undefined}
            tabIndex={item.value === tabbableValue ? 0 : -1}
            disabled={item.disabled}
            onClick={() => activateItem(item)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'min-h-control shrink-0 px-3 py-2 text-sm font-medium transition-colors duration-fast ease-standard motion-reduce:transition-none focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset',
              variant === 'connected'
                ? isActive
                  ? 'relative z-10 rounded-t-lg border border-border border-b-surface bg-surface text-text-default'
                  : 'rounded-t-lg border border-transparent bg-surface-2 text-text-muted hover:bg-surface-hover hover:text-text-default'
                : isActive
                  ? 'border-b-2 border-primary text-primary'
                  : 'border-b-2 border-transparent text-text-muted hover:text-text-default',
              item.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({
  id,
  labelledBy,
  children,
  className,
  focusable = false,
}: {
  id: string
  labelledBy: string
  children: ReactNode
  className?: string
  focusable?: boolean
}) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={focusable ? 0 : undefined}
      className={cn(
        'focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset',
        className,
      )}
    >
      {children}
    </div>
  )
}
