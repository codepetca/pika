'use client'

import { Check } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { Button, Tooltip, type ButtonProps } from '@/ui'
import { cn } from '@/ui/utils'

export interface TeacherWorkSurfaceActionItem {
  id: string
  label: ReactNode
  description?: ReactNode
  onSelect: () => void
  disabled?: boolean
  icon?: ReactNode
  checked?: boolean
  checkedRole?: 'menuitemcheckbox' | 'menuitemradio'
  dividerBefore?: boolean
  destructive?: boolean
}

interface MenuButtonProps {
  items: TeacherWorkSurfaceActionItem[]
  disabled?: boolean
  menuAriaLabel?: string
  menuPlacement?: 'up' | 'down'
  menuAlign?: 'start' | 'center' | 'end'
  menuClassName?: string
  children: (props: {
    ref: Ref<HTMLButtonElement>
    id: string
    isOpen: boolean
    disabled: boolean
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
    menuId: string
  }) => ReactNode
}

export function TeacherWorkSurfaceActionCluster({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex max-w-[calc(100vw-2rem)] items-center justify-center gap-1.5', className)}>
      {children}
    </div>
  )
}

function TeacherWorkSurfaceActionMenuButton({
  items,
  disabled = false,
  menuAriaLabel,
  menuPlacement = 'down',
  menuAlign = 'end',
  menuClassName,
  children,
}: MenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerId = useId()
  const menuId = useId()
  const normalItems = items.filter((item) => !item.destructive)
  const destructiveItems = items.filter((item) => item.destructive)
  const orderedItems = [...normalItems, ...destructiveItems]
  const firstDestructiveItem = destructiveItems[0] ?? null
  const hasLeadingVisual = items.some((item) => item.icon || item.checked !== undefined)
  const resolvedDisabled = disabled || items.length === 0

  const getEnabledMenuItems = useCallback(() => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
      ) ?? []
    ).filter((item) => !item.disabled)
  }, [])

  const closeMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    setIsOpen(false)
    if (options?.restoreFocus) {
      triggerRef.current?.focus()
    }
  }, [])

  const restoreFocusIfNoNewModalOpened = useCallback((existingModals: Set<Element>) => {
    window.requestAnimationFrame(() => {
      const currentModals = Array.from(document.querySelectorAll('[aria-modal="true"]'))
      if (currentModals.some((modal) => !existingModals.has(modal))) return
      const activeElement = document.activeElement
      if (activeElement === document.body || activeElement === null) {
        triggerRef.current?.focus()
      }
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    getEnabledMenuItems()[0]?.focus()

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        closeMenu({ restoreFocus: true })
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeMenu({ restoreFocus: true })
        return
      }

      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

      const enabledItems = getEnabledMenuItems()
      if (enabledItems.length === 0) return

      event.preventDefault()
      const currentIndex = enabledItems.indexOf(document.activeElement as HTMLButtonElement)
      const lastIndex = enabledItems.length - 1
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? lastIndex
            : event.key === 'ArrowUp'
              ? currentIndex <= 0
                ? lastIndex
                : currentIndex - 1
              : currentIndex === -1 || currentIndex === lastIndex
                ? 0
                : currentIndex + 1

      enabledItems[nextIndex]?.focus()
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenu, getEnabledMenuItems, isOpen])

  function handleItemSelect(item: TeacherWorkSurfaceActionItem) {
    const existingModals = new Set(document.querySelectorAll('[aria-modal="true"]'))
    closeMenu()
    item.onSelect()
    restoreFocusIfNoNewModalOpened(existingModals)
  }

  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (isOpen) {
      closeMenu({ restoreFocus: true })
      return
    }
    setIsOpen(true)
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      {children({
        ref: triggerRef,
        id: triggerId,
        isOpen,
        disabled: resolvedDisabled,
        onClick: toggleMenu,
        menuId,
      })}

      {isOpen && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={menuAriaLabel}
          aria-labelledby={menuAriaLabel ? undefined : triggerId}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'absolute z-50 min-w-56 rounded-md border border-border-strong bg-surface p-1 shadow-xl',
            menuPlacement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1',
            menuAlign === 'end'
              ? 'right-0'
              : menuAlign === 'center'
                ? 'left-1/2 -translate-x-1/2'
                : 'left-0',
            menuClassName,
          )}
        >
          {orderedItems.map((item) => (
            <Fragment key={item.id}>
              {item.dividerBefore || item === firstDestructiveItem ? (
                <div role="separator" className="my-1 border-t border-border" />
              ) : null}
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : item.checkedRole ?? 'menuitemcheckbox'}
                aria-checked={item.checked === undefined ? undefined : item.checked}
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  handleItemSelect(item)
                }}
                className={cn(
                  'w-full rounded-sm px-3 py-2 text-left text-sm text-text-default hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
                  item.destructive ? 'text-danger hover:bg-danger-bg' : '',
                )}
              >
                <span className="flex w-full items-start gap-2">
                  {hasLeadingVisual ? (
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {item.checked ? (
                        <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                      ) : (
                        item.icon
                      )}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-nowrap font-medium">{item.label}</span>
                    {item.description ? (
                      <span className={cn('mt-0.5 block text-xs text-text-muted', item.destructive ? 'text-danger' : '')}>
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

interface TeacherWorkSurfaceMenuButtonProps {
  label: ReactNode
  items: TeacherWorkSurfaceActionItem[]
  variant?: NonNullable<ButtonProps['variant']>
  size?: NonNullable<ButtonProps['size']>
  disabled?: boolean
  className?: string
  menuAriaLabel?: string
  menuPlacement?: 'up' | 'down'
  menuAlign?: 'start' | 'center' | 'end'
  menuClassName?: string
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>
}

export function TeacherWorkSurfaceMenuButton({
  label,
  items,
  variant = 'primary',
  size = 'sm',
  disabled,
  className,
  menuAriaLabel,
  menuPlacement,
  menuAlign,
  menuClassName,
  buttonProps,
}: TeacherWorkSurfaceMenuButtonProps) {
  const { className: buttonClassName, ...restButtonProps } = buttonProps ?? {}

  return (
    <TeacherWorkSurfaceActionMenuButton
      items={items}
      disabled={disabled}
      menuAriaLabel={menuAriaLabel}
      menuPlacement={menuPlacement}
      menuAlign={menuAlign}
      menuClassName={menuClassName}
    >
      {({ ref, id, isOpen, disabled: resolvedDisabled, onClick, menuId }) => (
        <Button
          ref={ref}
          id={id}
          type="button"
          variant={variant}
          size={size}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={isOpen}
          onClick={onClick}
          disabled={resolvedDisabled}
          className={cn(className, buttonClassName)}
          {...restButtonProps}
        >
          {label}
        </Button>
      )}
    </TeacherWorkSurfaceActionMenuButton>
  )
}

interface TeacherWorkSurfaceIconMenuButtonProps {
  icon: ReactNode
  items: TeacherWorkSurfaceActionItem[]
  ariaLabel: string
  tooltip?: ReactNode
  variant?: NonNullable<ButtonProps['variant']>
  size?: NonNullable<ButtonProps['size']>
  disabled?: boolean
  className?: string
  menuAriaLabel?: string
  menuPlacement?: 'up' | 'down'
  menuAlign?: 'start' | 'center' | 'end'
  menuClassName?: string
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type' | 'aria-label'>
}

export function TeacherWorkSurfaceIconMenuButton({
  icon,
  items,
  ariaLabel,
  tooltip,
  variant = 'surface',
  size = 'sm',
  disabled,
  className,
  menuAriaLabel,
  menuPlacement,
  menuAlign,
  menuClassName,
  buttonProps,
}: TeacherWorkSurfaceIconMenuButtonProps) {
  const { className: buttonClassName, ...restButtonProps } = buttonProps ?? {}

  return (
    <TeacherWorkSurfaceActionMenuButton
      items={items}
      disabled={disabled}
      menuAriaLabel={menuAriaLabel ?? ariaLabel}
      menuPlacement={menuPlacement}
      menuAlign={menuAlign}
      menuClassName={menuClassName}
    >
      {({ ref, id, isOpen, disabled: resolvedDisabled, onClick, menuId }) => {
        const button = (
          <Button
            ref={ref}
            id={id}
            type="button"
            variant={variant}
            size={size}
            aria-label={ariaLabel}
            aria-haspopup="menu"
            aria-controls={menuId}
            aria-expanded={isOpen}
            onClick={onClick}
            disabled={resolvedDisabled}
            className={cn('h-9 w-9 p-0', className, buttonClassName)}
            {...restButtonProps}
          >
            {icon}
          </Button>
        )

        if (!tooltip || isOpen) return button

        return (
          <Tooltip content={tooltip}>
            <span className="inline-flex">{button}</span>
          </Tooltip>
        )
      }}
    </TeacherWorkSurfaceActionMenuButton>
  )
}

interface TeacherWorkSurfaceIconButtonProps {
  icon: ReactNode
  ariaLabel: string
  onClick: () => void
  tooltip?: ReactNode
  variant?: NonNullable<ButtonProps['variant']>
  size?: NonNullable<ButtonProps['size']>
  disabled?: boolean
  pressed?: boolean
  className?: string
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type' | 'aria-label' | 'aria-pressed'>
}

export function TeacherWorkSurfaceIconButton({
  icon,
  ariaLabel,
  onClick,
  tooltip,
  variant = 'surface',
  size = 'sm',
  disabled,
  pressed,
  className,
  buttonProps,
}: TeacherWorkSurfaceIconButtonProps) {
  const { className: buttonClassName, ...restButtonProps } = buttonProps ?? {}
  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn('h-9 w-9 p-0', pressed ? 'border-primary bg-info-bg text-primary' : '', className, buttonClassName)}
      {...restButtonProps}
    >
      {icon}
    </Button>
  )

  if (!tooltip) return button

  return (
    <Tooltip content={tooltip}>
      <span className="inline-flex">{button}</span>
    </Tooltip>
  )
}
