'use client'

import { useState, useCallback, useEffect, useRef, useId } from 'react'

interface UseDropdownNavOptions {
  itemCount: number
  onSelect?: (index: number) => void
  onClose?: () => void
}

interface UseDropdownNavReturn {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  triggerId: string
  menuId: string
  getItemId: (index: number) => string
  handleTriggerKeyDown: (e: React.KeyboardEvent) => void
  handleItemKeyDown: (e: React.KeyboardEvent) => void
  handleTriggerClick: () => void
  handleMouseEnter: () => void
  handleMouseLeave: () => void
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>
  containerRef: React.RefObject<HTMLDivElement>
}

/**
 * Shared hook for dropdown navigation with keyboard support.
 * Handles open/close state, focus management, and keyboard navigation.
 */
export function useDropdownNav({
  itemCount,
  onSelect,
  onClose,
}: UseDropdownNavOptions): UseDropdownNavReturn {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null!)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  // Generate unique IDs for ARIA relationships
  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const menuId = `${baseId}-menu`
  const getItemId = (index: number) => `${baseId}-item-${index}`

  const close = useCallback(() => {
    setIsOpen(false)
    setFocusedIndex(-1)
    onClose?.()
  }, [onClose])

  const handleTriggerClick = useCallback(() => {
    if (isOpen) {
      close()
    } else {
      setIsOpen(true)
      setFocusedIndex(0)
    }
  }, [isOpen, close])

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsOpen(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      close()
    }, 150)
  }, [close])

  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(0)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < itemCount) {
          onSelect?.(focusedIndex)
        }
        break
      case 'Tab':
        close()
        break
    }
  }, [isOpen, focusedIndex, itemCount, onSelect, close])

  const handleItemKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < itemCount) {
          // Click the element to trigger its native behavior (important for Links)
          itemRefs.current[focusedIndex]?.click()
        }
        break
      case 'Tab':
        close()
        break
    }
  }, [focusedIndex, itemCount, close])

  // Focus the currently focused option
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus()
    }
  }, [isOpen, focusedIndex])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [close])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Reset refs array when item count changes
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, itemCount)
  }, [itemCount])

  return {
    isOpen,
    setIsOpen,
    focusedIndex,
    setFocusedIndex,
    triggerId,
    menuId,
    getItemId,
    handleTriggerKeyDown,
    handleItemKeyDown,
    handleTriggerClick,
    handleMouseEnter,
    handleMouseLeave,
    itemRefs,
    containerRef,
  }
}
