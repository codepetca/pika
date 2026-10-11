'use client'

import { Check, Plus, Code2, Copy, Trash2 } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  isValidElement,
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

type ClosingIcon = 'plus' | 'code' | 'copy' | 'trash'
type ClosingItem = Pick<TeacherWorkSurfaceActionItem, 'id' | 'disabled' | 'checked' | 'dividerBefore' | 'destructive'> & {
  label: string | number
  description?: string | number | null
  icon?: ClosingIcon
}

function copyClosingItems(items: TeacherWorkSurfaceActionItem[]): ClosingItem[] | null {
  const result: ClosingItem[] = []
  for (const item of items) {
    if (typeof item.label !== 'string' && typeof item.label !== 'number') return null
    if (item.description != null && typeof item.description !== 'string' && typeof item.description !== 'number') return null
    let icon: ClosingIcon | undefined
    if (item.icon != null) {
      if (!isValidElement<Record<string, unknown>>(item.icon) || item.icon.key !== null) return null
      const props = item.icon.props
      if (Object.keys(props).some((key) => key !== 'className' && key !== 'aria-hidden')
        || props.className !== 'h-4 w-4' || (props['aria-hidden'] !== true && props['aria-hidden'] !== 'true')
        || (item.icon as unknown as { ref?: unknown }).ref != null) return null
      icon = item.icon.type === Plus ? 'plus' : item.icon.type === Code2 ? 'code'
        : item.icon.type === Copy ? 'copy' : item.icon.type === Trash2 ? 'trash' : undefined
      if (!icon) return null
    }
    result.push({ id: item.id, label: item.label, description: item.description, icon,
      disabled: item.disabled, checked: item.checked, dividerBefore: item.dividerBefore, destructive: item.destructive })
  }
  return [...result.filter((item) => !item.destructive), ...result.filter((item) => item.destructive)]
}

function ClosingIconView({ icon }: { icon: ClosingIcon }) {
  const Icon = icon === 'plus' ? Plus : icon === 'code' ? Code2 : icon === 'copy' ? Copy : Trash2
  return <Icon className="h-4 w-4" aria-hidden="true" />
}

interface MenuButtonProps {
  items: TeacherWorkSurfaceActionItem[]
  disabled?: boolean
  interactionActive?: boolean
  exitMotion?: 'immediate' | 'opacity'
  menuAriaLabel?: string
  menuPlacement?: 'up' | 'down'
  menuAlign?: 'start' | 'center' | 'end'
  menuClassName?: string
  children: (props: {
    ref: Ref<HTMLButtonElement>
    id: string | undefined
    isOpen: boolean
    disabled: boolean
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
    menuId: string | undefined
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
  interactionActive = true,
  exitMotion = 'immediate',
  menuAriaLabel,
  menuPlacement = 'down',
  menuAlign = 'end',
  menuClassName,
  children,
}: MenuButtonProps) {
  const active = interactionActive && !disabled && items.length > 0
    && (exitMotion !== 'opacity' || items.some((item) => !item.disabled))
  const commandsRef = useRef({ active, open: false, generation: 0, items, exitMotion })
  const focusFrameRef = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState<{ owner: TeacherWorkSurfaceActionItem[]; items: ClosingItem[] } | null>(null)
  const cancelFocus = useCallback(() => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = null
  }, [])
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
  const resolvedDisabled = !active

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
    onClose: retireMenu,
    interactionActive: active,
  })

  const generation = commandsRef.current.generation + (commandsRef.current.active !== active || commandsRef.current.open !== isOpen ? 1 : 0)
  const closingView = active && !isOpen && closing?.owner === items && exitMotion === 'opacity' ? closing : null

  useInsertionEffect(() => {
    const current = commandsRef.current
    if (current.active !== active || current.open !== isOpen) current.generation += 1
    current.active = active
    current.open = isOpen
    current.items = items
    current.exitMotion = exitMotion
  })
  useInsertionEffect(() => () => {
    commandsRef.current.active = false
    commandsRef.current.open = false
    commandsRef.current.generation += 1
  }, [])
  useLayoutEffect(() => () => cancelFocus(), [cancelFocus])
  useLayoutEffect(() => {
    if (!active || isOpen) cancelFocus()
    if (closing && (closing.owner !== items || !active || exitMotion !== 'opacity')) setClosing(null)
  }, [active, isOpen, items, exitMotion, closing, cancelFocus])

  function retireMenu() {
    const current = commandsRef.current
    const wasOpen = current.open
    current.open = false
    current.generation += 1
    cancelFocus()
    clearActivePreview()
    const presentation = wasOpen && current.active && current.exitMotion === 'opacity' ? copyClosingItems(current.items) : null
    setClosing(presentation ? { owner: current.items, items: presentation } : null)
  }

  function live() {
    const current = commandsRef.current
    return current.active && current.open && current.generation === generation
  }

  useLayoutEffect(() => {
    if (menuRef.current) menuRef.current.inert = !isOpen
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
    return () => { live = false; window.clearTimeout(timer); media.removeEventListener('change', onMotionChange) }
  }, [closingView, isOpen])

  useLayoutEffect(() => () => {
    activePreviewRef.current?.onHoverChange?.(false)
  }, [])

  useLayoutEffect(() => {
    const activePreview = activePreviewRef.current
    if (!activePreview) return

    const currentItem = orderedItems.find((item) => item.id === activePreview.itemId)
    if (!currentItem || currentItem.disabled || !active) {
      activePreview.onHoverChange?.(false)
      activePreviewRef.current = undefined
      return
    }

    if (!currentItem.onHoverChange) {
      activePreview.onHoverChange?.(false)
      activePreviewRef.current = undefined
      return
    }

    activePreviewRef.current = {
      itemId: currentItem.id,
      onHoverChange: currentItem.onHoverChange,
    }
  }, [orderedItems, active])

  function handleItemPreview(id: string, previewActive: boolean) {
    if (!live()) return
    const item = commandsRef.current.items.find((candidate) => candidate.id === id && !candidate.disabled)
    if (!item) return
    if (previewActive) {
      if (activePreviewRef.current?.itemId === item.id) {
        activePreviewRef.current.onHoverChange = item.onHoverChange
        return
      }
      activePreviewRef.current?.onHoverChange?.(false)
      activePreviewRef.current = item.onHoverChange
        ? { itemId: item.id, onHoverChange: item.onHoverChange }
        : undefined
      item.onHoverChange?.(true)
    } else if (activePreviewRef.current?.itemId === item.id) {
      activePreviewRef.current = undefined
      item.onHoverChange?.(false)
    }
  }

  const restoreFocusIfNoNewModalOpened = useCallback((existingModals: Set<Element>) => {
    const lifetime = commandsRef.current.generation
    cancelFocus()
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!commandsRef.current.active || commandsRef.current.generation !== lifetime) return
      const currentModals = Array.from(document.querySelectorAll('[aria-modal="true"]'))
      if (currentModals.some((modal) => !existingModals.has(modal))) return
      const activeElement = document.activeElement
      if (activeElement === document.body || activeElement === null) {
        triggerRef.current?.focus()
      }
    })
  }, [cancelFocus, triggerRef])

  function handleItemSelect(id: string) {
    if (!live()) return
    const item = commandsRef.current.items.find((candidate) => candidate.id === id && !candidate.disabled)
    if (!item) return
    const existingModals = new Set(document.querySelectorAll('[aria-modal="true"]'))
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

      {(isOpen || closingView) && (
        <div
          ref={menuRef}
          id={isOpen ? menuId : undefined}
          role={isOpen ? 'menu' : undefined}
          aria-hidden={isOpen ? undefined : true}
          data-menu-closing={isOpen ? undefined : ''}
          style={{ opacity: isOpen ? 1 : 0, transition: exitMotion === 'opacity' ? 'opacity var(--motion-duration-fast) var(--motion-easing-standard)' : undefined, pointerEvents: isOpen ? undefined : 'none' }}
          aria-label={isOpen ? menuAriaLabel : undefined}
          aria-labelledby={isOpen && !menuAriaLabel ? triggerId : undefined}
          onClick={isOpen ? (event) => event.stopPropagation() : undefined}
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
          {closingView ? closingView.items.map((item, index) => (
            <Fragment key={item.id}>
              {item.dividerBefore || (item.destructive && !closingView.items[index - 1]?.destructive) ? <div className="my-1 border-t border-border" /> : null}
              <div className={cn('min-h-control w-full rounded-sm px-3 py-2 text-left text-sm text-text-default', item.disabled && 'opacity-50', item.destructive && 'text-danger')}>
                <span className="flex w-full items-start gap-2">
                  {closingView.items.some((entry) => entry.icon || entry.checked !== undefined) ? <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    {item.checked ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : item.icon ? <ClosingIconView icon={item.icon} /> : null}
                  </span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-nowrap font-medium">{item.label}</span>
                    {item.description ? <span className={cn('mt-0.5 block text-xs text-text-muted', item.destructive && 'text-danger')}>{item.description}</span> : null}
                  </span>
                </span>
              </div>
            </Fragment>
          )) : orderedItems.map((item, index) => (
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
                  handleItemSelect(item.id)
                }}
                onMouseEnter={() => handleItemPreview(item.id, true)}
                onMouseLeave={() => handleItemPreview(item.id, false)}
                onFocus={() => {
                  if (!live()) return
                  setFocusedIndex(index)
                  handleItemPreview(item.id, true)
                }}
                onBlur={() => handleItemPreview(item.id, false)}
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
  interactionActive?: boolean
  exitMotion?: 'immediate' | 'opacity'
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
  interactionActive,
  exitMotion,
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
      interactionActive={interactionActive}
      exitMotion={exitMotion}
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
  interactionActive?: boolean
  exitMotion?: 'immediate' | 'opacity'
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
  interactionActive,
  exitMotion,
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
      interactionActive={interactionActive}
      exitMotion={exitMotion}
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
