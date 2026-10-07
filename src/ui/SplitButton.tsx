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
  className,
  toggleAriaLabel = 'More actions',
  toggleButtonClassName,
  menuPlacement = 'up',
  primaryButtonProps,
}: SplitButtonProps) {
  const { className: primaryClassName, ...restPrimaryButtonProps } = primaryButtonProps ?? {}
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const interactionRef = useRef({ active: interactionActive, generation: 0 })
  useInsertionEffect(() => {
    if (interactionRef.current.active !== interactionActive) {
      interactionRef.current = { active: interactionActive, generation: interactionRef.current.generation + 1 }
    }
    return () => {
      interactionRef.current = { active: false, generation: interactionRef.current.generation + 1 }
    }
  }, [interactionActive])
  const mountedRef = useRef(true)
  const focusFrameRef = useRef<number | null>(null)
  const tabTimeoutRef = useRef<number | null>(null)
  const menuOpen = interactionActive && isOpen
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
    options.forEach((option) => option.onHoverChange?.(false))
  }, [options])

  const getEnabledMenuItems = useCallback(() => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"], [role="menuitemradio"]'
      ) ?? []
    ).filter((item) => !item.disabled)
  }, [])

  const closeMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    clearOptionHover()
    setIsOpen(false)
    focusedOnOpenRef.current = false
    if (options?.restoreFocus && interactionRef.current.active) {
      activeTriggerRef.current?.focus()
    }
  }, [clearOptionHover])

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

  const cancelDeferredWork = useCallback(() => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
    if (tabTimeoutRef.current !== null) window.clearTimeout(tabTimeoutRef.current)
    focusFrameRef.current = null
    tabTimeoutRef.current = null
  }, [])

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelDeferredWork()
    }
  }, [cancelDeferredWork])

  useLayoutEffect(() => {
    if (!interactionActive) {
      closeMenu()
      cancelDeferredWork()
    }
  }, [cancelDeferredWork, closeMenu, interactionActive])

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
      if (!interactionRef.current.active || !containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }

    function handleFocusOutside(event: FocusEvent) {
      if (interactionRef.current.active && !containerRef.current?.contains(event.target as Node)) closeMenu()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('focusin', handleFocusOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('focusin', handleFocusOutside)
    }
  }, [closeMenu, getEnabledMenuItems, menuOpen])

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!interactionRef.current.active || !menuOpen) return
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

  function handleOptionSelect(onSelect: () => void) {
    if (!interactionRef.current.active) return
    const existingModals = new Set(document.querySelectorAll('[aria-modal="true"]'))
    closeMenu()
    onSelect()
    restoreFocusIfNoNewModalOpened(existingModals)
  }

  function toggleMenu(trigger: HTMLButtonElement) {
    if (!interactionRef.current.active) return
    if (isOpen) {
      closeMenu({ restoreFocus: true })
      return
    }
    activeTriggerRef.current = trigger
    setActiveOptionId(null)
    setIsOpen(true)
  }

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
          if (!interactionRef.current.active) return
          if (!primaryIsMenuTrigger) {
            onPrimaryClick?.()
            return
          }

          event.stopPropagation()
          toggleMenu(primaryButtonRef.current ?? event.currentTarget)
        }}
        disabled={disabled || (primaryIsMenuTrigger && options.length === 0)}
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
          disabled={disabled || options.length === 0}
          className={cn('rounded-l-none border-l border-black/15 px-3', toggleButtonClassName)}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}

      {menuOpen && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'absolute right-0 z-popover min-w-[9rem] rounded-md border border-border-strong bg-surface p-1 shadow-xl',
            menuPlacement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'
          )}
        >
          {orderedOptions.map((option) => (
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
                onMouseEnter={() => option.onHoverChange?.(true)}
                onMouseLeave={() => option.onHoverChange?.(false)}
                onFocus={() => { setActiveOptionId(option.id); option.onHoverChange?.(true) }}
                onBlur={() => option.onHoverChange?.(false)}
                onClick={(event) => {
                  event.stopPropagation()
                  handleOptionSelect(option.onSelect)
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
