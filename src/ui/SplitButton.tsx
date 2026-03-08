'use client'

import { ChevronDown } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { Button, type ButtonProps } from './Button'
import { cn } from './utils'

export interface SplitButtonOption {
  id: string
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
}

export interface SplitButtonProps {
  label: ReactNode
  onPrimaryClick: () => void
  options: SplitButtonOption[]
  variant?: NonNullable<ButtonProps['variant']>
  size?: NonNullable<ButtonProps['size']>
  disabled?: boolean
  className?: string
  toggleAriaLabel?: string
  primaryButtonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>
}

export function SplitButton({
  label,
  onPrimaryClick,
  options,
  variant = 'primary',
  size = 'sm',
  disabled = false,
  className,
  toggleAriaLabel = 'More actions',
  primaryButtonProps,
}: SplitButtonProps) {
  const { className: primaryClassName, ...restPrimaryButtonProps } = primaryButtonProps ?? {}
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className={cn('relative inline-flex', className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={onPrimaryClick}
        disabled={disabled}
        className={cn('rounded-r-none', primaryClassName)}
        {...restPrimaryButtonProps}
      >
        {label}
      </Button>
      <Button
        type="button"
        variant={variant}
        size={size}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-label={toggleAriaLabel}
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled || options.length === 0}
        className="rounded-l-none border-l border-black/15 px-3"
      >
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </Button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-1 min-w-[9rem] rounded-md border border-border-strong bg-surface p-1 shadow-xl"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              disabled={option.disabled}
              onClick={() => {
                option.onSelect()
                setIsOpen(false)
              }}
              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-default hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
