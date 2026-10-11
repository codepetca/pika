'use client'

import { Check, ChevronDown } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useInsertionEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type KeyboardEvent,
} from 'react'
import { Button, type ButtonProps } from './Button'
import { cn } from './utils'

export interface SplitButtonOption {
  id: string
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
  icon?: ReactNode
  checked?: boolean
  dividerBefore?: boolean
  destructive?: boolean
  onHoverChange?: (hovered: boolean) => void
}

export interface SplitButtonProps {
  label: ReactNode
  onPrimaryClick?: () => void
  options: SplitButtonOption[]
  primaryOpensMenu?: boolean
  /** Render one menu trigger instead of separate primary and toggle buttons. */
  singleMenuTrigger?: boolean
  variant?: NonNullable<ButtonProps['variant']>
  size?: NonNullable<ButtonProps['size']>
  disabled?: boolean
  /** Close nested interaction owners without changing button presentation. */
  interactionActive?: boolean
  /** Plain-text menus may retain inert presentation after logical dismissal. */
  exitMotion?: 'immediate' | 'opacity'
  className?: string
  toggleAriaLabel?: string
  toggleButtonClassName?: string
  menuPlacement?: 'up' | 'down'
  primaryButtonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>
}

export function SplitButton({
  label,
  onPrimaryClick,
  options,
  primaryOpensMenu = false,
  singleMenuTrigger = false,
  variant = 'primary',
  size = 'sm',
  disabled = false,
  interactionActive = true,
  exitMotion = 'immediate',
  className,
  toggleAriaLabel = 'More actions',
  toggleButtonClassName,
  menuPlacement = 'up',
  primaryButtonProps,
}: SplitButtonProps) {
  const { className: primaryClassName, ...restPrimaryButtonProps } = primaryButtonProps ?? {}
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  type Presentation = Pick<SplitButtonOption, 'id' | 'disabled' | 'checked' | 'dividerBefore' | 'destructive'> & { label: string | number }
  const [closing, setClosing] = useState<{ owner: SplitButtonOption[]; items: Presentation[] } | null>(null)
  const available = interactionActive && !disabled && options.some((option) => !option.disabled)
  const interactionRef = useRef({ active: interactionActive && !disabled, available, open: false, generation: 0, options, primary: onPrimaryClick })
  const hoverRef = useRef(new Map<string, (hovered: boolean) => void>())
  const retireListenersRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(true)
  const focusFrameRef = useRef<number | null>(null)
  const tabTimeoutRef = useRef<number | null>(null)
  const menuOpen = available && isOpen
  // Predict the next committed authority fence without changing refs during render.
  // Menu availability is separate from the split primary action's authority.
  const authorityChanges = interactionRef.current.active !== (interactionActive && !disabled)
    || interactionRef.current.available !== available
  const generation = interactionRef.current.generation + (authorityChanges ? 1 : 0)
  const closingView = available && !menuOpen && closing?.owner === options && exitMotion === 'opacity' ? closing : null
  const containerRef = useRef<HTMLDivElement | null>(null)
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null)
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const focusedOnOpenRef = useRef(false)
  const menuId = useId()
  const normalOptions = options.filter((option) => !option.destructive)
  const destructiveOptions = options.filter((option) => option.destructive)
  const orderedOptions = [...normalOptions, ...destructiveOptions]
  const activeOption = orderedOptions.find((option) => option.id === activeOptionId && !option.disabled)
    ?? orderedOptions.find((option) => !option.disabled)
  const firstDestructiveOption = destructiveOptions[0] ?? null
  const hasLeadingVisual = options.some((option) => option.icon || option.checked !== undefined)
  const primaryIsMenuTrigger = primaryOpensMenu || singleMenuTrigger

  const clearOptionHover = useCallback(() => {
    const owners = Array.from(hoverRef.current.values())
    hoverRef.current.clear()
    owners.forEach((owner) => owner(false))
  }, [])

  const cancelDeferredWork = useCallback(() => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
    if (tabTimeoutRef.current !== null) window.clearTimeout(tabTimeoutRef.current)
    focusFrameRef.current = null
    tabTimeoutRef.current = null
  }, [])

  // Commit-only authority: a suspended render cannot retire the visible owner.
  useInsertionEffect(() => {
    const current = interactionRef.current
    const active = interactionActive && !disabled
    if (current.active !== active || current.available !== available) current.generation += 1
    if (!available) current.open = false
    current.active = active
    current.available = available
    current.options = options
    current.primary = onPrimaryClick
  })

  const getEnabledMenuItems = useCallback(() => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"], [role="menuitemradio"]'
      ) ?? []
    ).filter((item) => !item.disabled)
  }, [])

  const closeMenu = useCallback((settings?: { restoreFocus?: boolean; immediate?: boolean }) => {
    const current = interactionRef.current
    const wasOpen = current.open
    current.open = false
    current.generation += 1
    cancelDeferredWork()
    retireListenersRef.current?.()
    retireListenersRef.current = null
    clearOptionHover()
    const eligible = wasOpen && !settings?.immediate && current.active && exitMotion === 'opacity'
      && current.options.some((option) => !option.disabled)
      && current.options.every((option) => (typeof option.label === 'string' || typeof option.label === 'number') && option.icon == null)
    setClosing(eligible ? {
      owner: current.options,
      items: current.options.map(({ id, label, disabled, checked, dividerBefore, destructive }) => ({
        id, label: label as string | number, disabled, checked, dividerBefore, destructive,
      })),
    } : null)
    setIsOpen(false)
    focusedOnOpenRef.current = false
    if (settings?.restoreFocus && current.active) activeTriggerRef.current?.focus()
  }, [cancelDeferredWork, clearOptionHover, exitMotion])

  const restoreFocusIfNoNewModalOpened = useCallback((existingModals: Set<Element>) => {
    const generation = interactionRef.current.generation
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!mountedRef.current || !interactionRef.current.active
        || interactionRef.current.generation !== generation) return
      const currentModals = Array.from(document.querySelectorAll('[aria-modal="true"]'))
      if (currentModals.some((modal) => !existingModals.has(modal))) return
      const activeElement = document.activeElement
      if (activeElement === document.body || activeElement === null) {
        activeTriggerRef.current?.focus()
      }
    })
  }, [])

  useInsertionEffect(() => {
    const current = interactionRef.current
    return () => {
      current.active = false
      current.open = false
      current.generation += 1
    }
  }, [])

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      retireListenersRef.current?.()
      cancelDeferredWork()
      clearOptionHover()
    }
  }, [cancelDeferredWork, clearOptionHover])

  useLayoutEffect(() => {
    // Transfer same-ID inline callbacks; release only a removed or unavailable preview owner.
    for (const [id, owner] of hoverRef.current) {
      const option = options.find((candidate) => candidate.id === id && !candidate.disabled)
      if (!option?.onHoverChange) {
        hoverRef.current.delete(id)
        owner(false)
      } else if (option.onHoverChange !== owner) {
        hoverRef.current.set(id, option.onHoverChange)
      }
    }
    // Available inline command updates keep the same lifetime: both selection
    // focus handoff and native Tab dismissal must survive hover-driven rerenders.
    if (!available) cancelDeferredWork()
  }, [options, available, cancelDeferredWork])

  useLayoutEffect(() => {
    if (!available && (isOpen || closing)) closeMenu({ immediate: true })
    if (closing && (closing.owner !== options || !available || exitMotion !== 'opacity')) setClosing(null)
  }, [options, available, closing, isOpen, exitMotion, closeMenu])

  useLayoutEffect(() => {
    if (menuRef.current) menuRef.current.inert = !menuOpen
    if (!closingView) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const token = menuRef.current ? getComputedStyle(menuRef.current).getPropertyValue('--motion-duration-fast').trim() : ''
    const parsed = token.match(/^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/)
    const duration = parsed ? Number(parsed[1]) * (parsed[2] === 's' ? 1000 : 1) : 0
    let timer: number | undefined
    let live = true
    const finish = () => {
      if (!live) return
      live = false
      window.clearTimeout(timer)
      media.removeEventListener('change', onMotionChange)
      setClosing(null)
    }
    const onMotionChange = () => { if (media.matches) finish() }
    if (media.matches || !Number.isFinite(duration) || duration <= 0) { finish(); return }
    timer = window.setTimeout(finish, duration)
    media.addEventListener('change', onMotionChange)
    return () => {
      live = false
      window.clearTimeout(timer)
      media.removeEventListener('change', onMotionChange)
    }
  }, [closingView, menuOpen])

  useLayoutEffect(() => {
    if (!menuOpen) {
      focusedOnOpenRef.current = false
      return
    }

    const activeElement = document.activeElement
    const lostMenuFocus = (activeElement === document.body || menuRef.current?.contains(activeElement))
      && !getEnabledMenuItems().includes(activeElement as HTMLButtonElement)
    if (!focusedOnOpenRef.current || lostMenuFocus) {
      getEnabledMenuItems()[0]?.focus()
      focusedOnOpenRef.current = true
    }

    function handleClickOutside(event: MouseEvent) {
      if (!interactionRef.current.active || !interactionRef.current.open || !containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }

    function handleFocusOutside(event: FocusEvent) {
      if (interactionRef.current.active && interactionRef.current.open && !containerRef.current?.contains(event.target as Node)) closeMenu()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('focusin', handleFocusOutside)
    const retire = () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('focusin', handleFocusOutside)
    }
    retireListenersRef.current = retire
    return () => { retire(); if (retireListenersRef.current === retire) retireListenersRef.current = null }
  }, [closeMenu, getEnabledMenuItems, menuOpen, options])

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!liveLifetime()) return
    if (event.key === 'Tab') {
      // Allow the browser to choose the normal next/previous tab stop before
      // removing the focused menu item. Never return focus on keyboard exit.
      const generation = interactionRef.current.generation
      tabTimeoutRef.current = window.setTimeout(() => {
        tabTimeoutRef.current = null
        if (mountedRef.current && interactionRef.current.active
          && interactionRef.current.generation === generation) closeMenu()
      }, 0)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu({ restoreFocus: true })
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = getEnabledMenuItems()
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const last = items.length - 1
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
      : event.key === 'ArrowUp' ? current <= 0 ? last : current - 1
        : current < 0 || current === last ? 0 : current + 1
    items[next]?.focus()
  }

  function liveLifetime() {
    const current = interactionRef.current
    return mountedRef.current && current.active && current.open && current.generation === generation
  }

  function hoverOption(id: string, hovered: boolean) {
    if (!liveLifetime()) return
    const option = interactionRef.current.options.find((candidate) => candidate.id === id && !candidate.disabled)
    if (!option) return
    if (hovered && option.onHoverChange) {
      if (hoverRef.current.get(id) === option.onHoverChange) return
      hoverRef.current.set(id, option.onHoverChange)
      option.onHoverChange(true)
    } else {
      const owner = hoverRef.current.get(id)
      hoverRef.current.delete(id)
      owner?.(false)
    }
  }

  function handleOptionSelect(id: string) {
    if (!liveLifetime()) return
    const option = interactionRef.current.options.find((candidate) => candidate.id === id && !candidate.disabled)
    if (!option) return
    const existingModals = new Set(document.querySelectorAll('[aria-modal="true"]'))
    closeMenu()
    option.onSelect()
    restoreFocusIfNoNewModalOpened(existingModals)
  }

  function toggleMenu(trigger: HTMLButtonElement) {
    const current = interactionRef.current
    if (!mountedRef.current || !current.active || !current.options.some((option) => !option.disabled)
      || current.generation !== generation) return
    if (current.open) {
      closeMenu({ restoreFocus: true })
      return
    }
    cancelDeferredWork()
    current.generation += 1
    current.open = true
    setClosing(null)
    activeTriggerRef.current = trigger
    setActiveOptionId(null)
    setIsOpen(true)
  }

  const menuClassName = cn(
    'absolute right-0 z-popover min-w-[9rem] rounded-md border border-border-strong bg-surface p-1 shadow-xl',
    menuPlacement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'
  )

  return (
    <div ref={containerRef} onKeyDown={handleMenuKeyDown} className={cn('relative inline-flex', className)}>
      <Button
        ref={primaryButtonRef}
        type="button"
        variant={variant}
        size={size}
        aria-haspopup={primaryIsMenuTrigger ? 'menu' : undefined}
        aria-controls={primaryIsMenuTrigger ? menuId : undefined}
        aria-expanded={primaryIsMenuTrigger ? menuOpen : undefined}
        onClick={(event) => {
          if (!mountedRef.current || !interactionRef.current.active || interactionRef.current.generation !== generation) return
          if (!primaryIsMenuTrigger) {
            interactionRef.current.primary?.()
            return
          }

          event.stopPropagation()
          toggleMenu(primaryButtonRef.current ?? event.currentTarget)
        }}
        disabled={disabled || (primaryIsMenuTrigger && !options.some((option) => !option.disabled))}
        className={cn(!singleMenuTrigger && 'rounded-r-none', primaryClassName)}
        {...restPrimaryButtonProps}
      >
        {label}
      </Button>
      {!singleMenuTrigger ? (
        <Button
          ref={toggleButtonRef}
          type="button"
          variant={variant}
          size={size}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-label={toggleAriaLabel}
          onClick={(event) => {
            event.stopPropagation()
            toggleMenu(toggleButtonRef.current ?? event.currentTarget)
          }}
          disabled={disabled || !options.some((option) => !option.disabled)}
          className={cn('rounded-l-none border-l border-black/15 px-3', toggleButtonClassName)}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}

      {(menuOpen || closingView) && (
        <div
          id={menuOpen ? menuId : undefined}
          ref={menuRef}
          role={menuOpen ? 'menu' : undefined}
          aria-hidden={menuOpen ? undefined : true}
          data-menu-closing={menuOpen ? undefined : ''}
          style={{ opacity: menuOpen ? 1 : 0, transition: exitMotion === 'opacity' ? 'opacity var(--motion-duration-fast) var(--motion-easing-standard)' : undefined, pointerEvents: menuOpen ? undefined : 'none' }}
          onClick={menuOpen ? (event) => event.stopPropagation() : undefined}
          className={menuClassName}
        >
          {closingView ? (() => {
            const items = [...closingView.items.filter((item) => !item.destructive), ...closingView.items.filter((item) => item.destructive)]
            const firstDestructive = items.find((item) => item.destructive)
            const leading = items.some((item) => item.checked !== undefined)
            return items.map((item) => <Fragment key={item.id}>
              {item.dividerBefore || item === firstDestructive ? <div className="my-1 border-t border-border" /> : null}
              <div className={cn('min-h-control w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-default', item.disabled && 'opacity-50', item.destructive && 'text-danger')}>
                <span className="inline-flex w-full items-center gap-2 whitespace-nowrap">
                  {leading ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.checked ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}</span> : null}
                  <span className="min-w-0 flex-1">{item.label}</span>
                </span>
              </div>
            </Fragment>)
          })() : orderedOptions.map((option) => (
            <Fragment key={option.id}>
              {option.dividerBefore || option === firstDestructiveOption ? (
                <div role="separator" className="my-1 border-t border-border" />
              ) : null}
              <button
                type="button"
                role={option.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={option.checked === undefined ? undefined : option.checked}
                disabled={option.disabled}
                tabIndex={option === activeOption ? 0 : -1}
                onMouseEnter={() => hoverOption(option.id, true)}
                onMouseLeave={() => hoverOption(option.id, false)}
                onFocus={() => { if (liveLifetime()) { setActiveOptionId(option.id); hoverOption(option.id, true) } }}
                onBlur={() => hoverOption(option.id, false)}
                onClick={(event) => {
                  event.stopPropagation()
                  handleOptionSelect(option.id)
                }}
                className={cn(
                  'min-h-control w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-default hover:bg-surface-hover focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50',
                  option.destructive ? 'text-danger hover:bg-danger-bg' : ''
                )}
              >
                <span className="inline-flex w-full items-center gap-2 whitespace-nowrap">
                  {hasLeadingVisual ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {option.checked ? (
                        <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                      ) : (
                        option.icon
                      )}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">{option.label}</span>
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
