'use client'

import { Check } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { Button, Tooltip, type ButtonProps } from '@/ui'
import { cn } from '@/ui'
import { useDropdownNav } from '@/hooks/use-dropdown-nav'

export interface TeacherWorkSurfaceActionItem {
  id: string
  label: ReactNode
  description?: ReactNode
  onSelect: () => void
  onHoverChange?: (active: boolean) => void
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
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
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
  const activePreviewRef = useRef<{
    itemId: TeacherWorkSurfaceActionItem['id']
    onHoverChange: TeacherWorkSurfaceActionItem['onHoverChange']
  }>(undefined)
  const orderedItems = useMemo(() => {
    const normalItems = items.filter((item) => !item.destructive)
    const destructiveItems = items.filter((item) => item.destructive)
    return [...normalItems, ...destructiveItems]
  }, [items])
  const destructiveItems = orderedItems.filter((item) => item.destructive)
  const firstDestructiveItem = destructiveItems[0] ?? null
  const hasLeadingVisual = items.some((item) => item.icon || item.checked !== undefined)
  const resolvedDisabled = disabled || items.length === 0

  const clearActivePreview = useCallback(() => {
    activePreviewRef.current?.onHoverChange?.(false)
    activePreviewRef.current = undefined
  }, [])

  const isItemDisabled = useCallback(
    (index: number) => orderedItems[index] ? Boolean(orderedItems[index].disabled) : true,
    [orderedItems],
  )

  const {
    isOpen,
    setIsOpen,
    focusedIndex,
    setFocusedIndex,
    triggerId,
    menuId,
    getItemId,
    handleItemKeyDown,
    handleTriggerClick,
    handleTriggerKeyDown,
    triggerRef,
    itemRefs,
    containerRef,
  } = useDropdownNav({
    itemCount: orderedItems.length,
    isItemDisabled,
    onClose: clearActivePreview,
  })

  useEffect(() => () => {
    activePreviewRef.current?.onHoverChange?.(false)
  }, [])

  useEffect(() => {
    const activePreview = activePreviewRef.current
    if (!activePreview) return

    const currentItem = orderedItems.find((item) => item.id === activePreview.itemId)
    if (!currentItem) {
      activePreview.onHoverChange?.(false)
      activePreviewRef.current = undefined
      return
    }

    activePreviewRef.current = {
      itemId: currentItem.id,
      onHoverChange: currentItem.onHoverChange,
    }
  }, [orderedItems])

  function handleItemPreview(item: TeacherWorkSurfaceActionItem, active: boolean) {
    if (active) {
      if (activePreviewRef.current?.itemId === item.id) {
        activePreviewRef.current.onHoverChange = item.onHoverChange
        return
      }
      activePreviewRef.current?.onHoverChange?.(false)
      activePreviewRef.current = { itemId: item.id, onHoverChange: item.onHoverChange }
      item.onHoverChange?.(true)
    } else if (activePreviewRef.current?.itemId === item.id) {
      activePreviewRef.current = undefined
      item.onHoverChange?.(false)
    }
  }

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

  function handleItemSelect(item: TeacherWorkSurfaceActionItem) {
    const existingModals = new Set(document.querySelectorAll('[aria-modal="true"]'))
    clearActivePreview()
    setIsOpen(false)
    setFocusedIndex(-1)
    triggerRef.current?.focus()
    item.onSelect()
    restoreFocusIfNoNewModalOpened(existingModals)
  }

  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    handleTriggerClick()
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      {children({
        ref: triggerRef,
        id: triggerId,
        isOpen,
        disabled: resolvedDisabled,
        onClick: toggleMenu,
        onKeyDown: handleTriggerKeyDown,
        menuId,
      })}

      {isOpen && (
        <div
          id={menuId}
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
          {orderedItems.map((item, index) => (
            <Fragment key={item.id}>
              {item.dividerBefore || item === firstDestructiveItem ? (
                <div role="separator" className="my-1 border-t border-border" />
              ) : null}
              <button
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                id={getItemId(index)}
                type="button"
                role={item.checked === undefined ? 'menuitem' : item.checkedRole ?? 'menuitemcheckbox'}
                aria-checked={item.checked === undefined ? undefined : item.checked}
                tabIndex={index === focusedIndex ? 0 : -1}
                disabled={item.disabled}
                onKeyDown={handleItemKeyDown}
                onClick={(event) => {
                  event.stopPropagation()
                  handleItemSelect(item)
                }}
                onMouseEnter={() => handleItemPreview(item, true)}
                onMouseLeave={() => handleItemPreview(item, false)}
                onFocus={() => {
                  setFocusedIndex(index)
                  handleItemPreview(item, true)
                }}
                onBlur={() => handleItemPreview(item, false)}
                className={cn(
                  'min-h-control w-full rounded-sm px-3 py-2 text-left text-sm text-text-default hover:bg-surface-hover focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50',
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
  const {
    className: buttonClassName,
    onKeyDown: buttonKeyDown,
    ...restButtonProps
  } = buttonProps ?? {}

  return (
    <TeacherWorkSurfaceActionMenuButton
      items={items}
      disabled={disabled}
      menuAriaLabel={menuAriaLabel}
      menuPlacement={menuPlacement}
      menuAlign={menuAlign}
      menuClassName={menuClassName}
    >
      {({ ref, id, isOpen, disabled: resolvedDisabled, onClick, onKeyDown, menuId }) => (
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
          onKeyDown={(event) => {
            buttonKeyDown?.(event)
            if (!event.defaultPrevented) onKeyDown(event)
          }}
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
  variant = 'ghost',
  size = 'sm',
  disabled,
  className,
  menuAriaLabel,
  menuPlacement,
  menuAlign,
  menuClassName,
  buttonProps,
}: TeacherWorkSurfaceIconMenuButtonProps) {
  const [isTooltipSuppressed, setIsTooltipSuppressed] = useState(false)
  const isMenuOpenRef = useRef(false)
  const {
    className: buttonClassName,
    onKeyDown: buttonKeyDown,
    ...restButtonProps
  } = buttonProps ?? {}

  return (
    <TeacherWorkSurfaceActionMenuButton
      items={items}
      disabled={disabled}
      menuAriaLabel={menuAriaLabel ?? ariaLabel}
      menuPlacement={menuPlacement}
      menuAlign={menuAlign}
      menuClassName={menuClassName}
    >
      {({ ref, id, isOpen, disabled: resolvedDisabled, onClick, onKeyDown, menuId }) => {
        isMenuOpenRef.current = isOpen
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
            onClick={(event) => {
              if (!isOpen) setIsTooltipSuppressed(true)
              onClick(event)
            }}
            onKeyDown={(event) => {
              buttonKeyDown?.(event)
              if (!event.defaultPrevented) onKeyDown(event)
            }}
            disabled={resolvedDisabled}
            className={cn('h-9 w-9 p-0', className, buttonClassName)}
            {...restButtonProps}
          >
            {icon}
          </Button>
        )

        if (!tooltip) return button

        return (
          <Tooltip content={tooltip} disabled={isOpen || isTooltipSuppressed}>
            <span
              className="inline-flex"
              onBlur={() => {
                window.requestAnimationFrame(() => {
                  if (isMenuOpenRef.current) return
                  if (document.querySelector('[aria-modal="true"]')) return
                  setIsTooltipSuppressed(false)
                })
              }}
              onPointerMove={() => {
                if (isMenuOpenRef.current) return
                if (document.querySelector('[aria-modal="true"]')) return
                setIsTooltipSuppressed(false)
              }}
            >
              {button}
            </span>
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
