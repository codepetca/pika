'use client'

import { useState, useCallback, useEffect, useRef, useId } from 'react'

interface UseDropdownNavOptions {
  itemCount: number
  onSelect?: (index: number) => void
  onClose?: () => void
  initialFocusedIndex?: number
  isItemDisabled?: (index: number) => boolean
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
  initialFocusedIndex = 0,
  isItemDisabled = () => false,
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

  const getNextEnabledIndex = useCallback((startIndex: number, direction: 1 | -1 = 1) => {
    if (itemCount <= 0) return -1

    const normalizedStart = ((startIndex % itemCount) + itemCount) % itemCount
    for (let step = 0; step < itemCount; step += 1) {
      const candidate = ((normalizedStart + step * direction) % itemCount + itemCount) % itemCount
      if (!isItemDisabled(candidate)) {
        return candidate
      }
    }

    return -1
  }, [isItemDisabled, itemCount])

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
      setFocusedIndex(getNextEnabledIndex(initialFocusedIndex))
    }
  }, [close, getNextEnabledIndex, initialFocusedIndex, isOpen])

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
        setFocusedIndex(getNextEnabledIndex(initialFocusedIndex))
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
        setFocusedIndex((prev) => getNextEnabledIndex(prev + 1, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => getNextEnabledIndex(prev - 1, -1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < itemCount && !isItemDisabled(focusedIndex)) {
          onSelect?.(focusedIndex)
        }
        break
      case 'Tab':
        close()
        break
    }
  }, [close, focusedIndex, getNextEnabledIndex, initialFocusedIndex, isItemDisabled, isOpen, itemCount, onSelect])

  const handleItemKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => getNextEnabledIndex(prev + 1, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => getNextEnabledIndex(prev - 1, -1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < itemCount && !isItemDisabled(focusedIndex)) {
          // Click the element to trigger its native behavior (important for Links)
          itemRefs.current[focusedIndex]?.click()
        }
        break
      case 'Tab':
        close()
        break
    }
  }, [close, focusedIndex, getNextEnabledIndex, isItemDisabled, itemCount])

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
