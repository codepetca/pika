'use client'

import { useState, useCallback, useEffect, useInsertionEffect, useLayoutEffect, useRef, useId } from 'react'

interface UseDropdownNavOptions {
  itemCount: number
  interactionActive?: boolean
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
  triggerId: string | undefined
  menuId: string | undefined
  getItemId: (index: number) => string | undefined
  handleTriggerKeyDown: (e: React.KeyboardEvent) => void
  handleItemKeyDown: (e: React.KeyboardEvent) => void
  handleTriggerClick: () => void
  triggerRef: React.RefObject<HTMLButtonElement>
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>
  containerRef: React.RefObject<HTMLDivElement>
}

/**
 * Shared hook for dropdown navigation with keyboard support.
 * Handles open/close state, focus management, and keyboard navigation.
 */
export function useDropdownNav({
  itemCount,
  interactionActive = true,
  onSelect,
  onClose,
  initialFocusedIndex = 0,
  isItemDisabled = () => false,
}: UseDropdownNavOptions): UseDropdownNavReturn {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null!)
  const triggerRef = useRef<HTMLButtonElement>(null!)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  // Attach client-owned relationships after hydration. Streamed trees may
  // assign different useId paths; closed server menus need no relationships.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const baseId = useId()
  const triggerId = mounted ? `${baseId}-trigger` : undefined
  const menuId = mounted ? `${baseId}-menu` : undefined
  const getItemId = (index: number) => mounted ? `${baseId}-item-${index}` : undefined

  const authorityRef = useRef({ active: interactionActive, open: false, generation: 0, itemCount, isItemDisabled, onSelect, onClose, focusedIndex })
  const tabTimeoutRef = useRef<number | null>(null)
  const listenerCleanupRef = useRef<(() => void) | null>(null)
  const generation = authorityRef.current.generation + (authorityRef.current.active !== interactionActive ? 1 : 0)
  const isOpen = interactionActive && open
  const cancelPending = useCallback(() => {
    if (tabTimeoutRef.current !== null) window.clearTimeout(tabTimeoutRef.current)
    tabTimeoutRef.current = null
    listenerCleanupRef.current?.()
    listenerCleanupRef.current = null
  }, [])
  useInsertionEffect(() => {
    const current = authorityRef.current
    if (current.active !== interactionActive) current.generation += 1
    current.active = interactionActive
    current.itemCount = itemCount
    current.isItemDisabled = isItemDisabled
    current.onSelect = onSelect
    current.onClose = onClose
    current.focusedIndex = focusedIndex
  })
  useInsertionEffect(() => () => {
    authorityRef.current.active = false
    authorityRef.current.open = false
    authorityRef.current.generation += 1
  }, [])
  useLayoutEffect(() => () => cancelPending(), [cancelPending])

  const live = useCallback((requireOpen = true) => {
    const current = authorityRef.current
    return current.active && current.generation === generation && (!requireOpen || current.open)
  }, [generation])

  const getNextEnabledIndex = useCallback((startIndex: number, direction: 1 | -1 = 1) => {
    const current = authorityRef.current
    if (current.itemCount <= 0) return -1
    const normalizedStart = ((startIndex % current.itemCount) + current.itemCount) % current.itemCount
    for (let step = 0; step < current.itemCount; step += 1) {
      const candidate = ((normalizedStart + step * direction) % current.itemCount + current.itemCount) % current.itemCount
      if (!current.isItemDisabled(candidate)) return candidate
    }
    return -1
  }, [])

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    const current = authorityRef.current
    const wasOpen = current.open
    current.open = false
    current.generation += 1
    cancelPending()
    setOpen(false)
    setFocusedIndex(-1)
    if (wasOpen) current.onClose?.()
    if (options?.restoreFocus && current.active) triggerRef.current?.focus()
  }, [cancelPending])

  useLayoutEffect(() => {
    if (!interactionActive) {
      if (authorityRef.current.open || open) close()
      else cancelPending()
    }
  }, [interactionActive, open, close, cancelPending])

  function setIsOpen(nextOpen: boolean) {
    if (!live(false)) return
    if (!nextOpen) { close(); return }
    cancelPending()
    authorityRef.current.generation += 1
    authorityRef.current.open = true
    setOpen(true)
  }

  function handleTriggerClick() {
    if (!live(false)) return
    if (authorityRef.current.open) close({ restoreFocus: true })
    else { setIsOpen(true); setFocusedIndex(getNextEnabledIndex(initialFocusedIndex)) }
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (!live(false)) return
    if (!authorityRef.current.open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(getNextEnabledIndex(initialFocusedIndex))
      }
      return
    }
    handleNavigationKeyDown(e, false)
  }

  function handleNavigationKeyDown(e: React.KeyboardEvent, clickItem: boolean) {
    if (!live()) return
    const current = authorityRef.current
    switch (e.key) {
      case 'Escape':
        e.preventDefault(); e.stopPropagation(); close({ restoreFocus: true }); break
      case 'ArrowDown':
        e.preventDefault(); setFocusedIndex((prev) => getNextEnabledIndex(prev + 1, 1)); break
      case 'ArrowUp':
        e.preventDefault(); setFocusedIndex((prev) => getNextEnabledIndex(prev - 1, -1)); break
      case 'Home':
        e.preventDefault(); setFocusedIndex(getNextEnabledIndex(0, 1)); break
      case 'End':
        e.preventDefault(); setFocusedIndex(getNextEnabledIndex(current.itemCount - 1, -1)); break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (current.focusedIndex >= 0 && current.focusedIndex < current.itemCount && !current.isItemDisabled(current.focusedIndex)) {
          if (clickItem) itemRefs.current[current.focusedIndex]?.click()
          else current.onSelect?.(current.focusedIndex)
        }
        break
      case 'Tab': {
        // Let native Tab choose its destination before removing the focused item.
        const lifetime = current.generation
        if (tabTimeoutRef.current !== null) window.clearTimeout(tabTimeoutRef.current)
        tabTimeoutRef.current = window.setTimeout(() => {
          tabTimeoutRef.current = null
          if (current.active && current.open && current.generation === lifetime) close()
        }, 0)
        break
      }
    }
  }

  function handleItemKeyDown(e: React.KeyboardEvent) { handleNavigationKeyDown(e, true) }

  useEffect(() => {
    const current = authorityRef.current
    if (isOpen && current.active && current.open && current.generation === generation && focusedIndex >= 0) {
      itemRefs.current[focusedIndex]?.focus()
    }
  }, [isOpen, focusedIndex, generation])

  useLayoutEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (!live()) return
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close({ restoreFocus: true })
    }
    document.addEventListener('mousedown', handleClickOutside)
    const retire = () => document.removeEventListener('mousedown', handleClickOutside)
    listenerCleanupRef.current = retire
    return () => {
      retire()
      if (listenerCleanupRef.current === retire) listenerCleanupRef.current = null
    }
  }, [close, isOpen, generation, live])

  useEffect(() => { itemRefs.current = itemRefs.current.slice(0, itemCount) }, [itemCount])

  return {
    isOpen,
    setIsOpen,
    focusedIndex,
    setFocusedIndex: (index) => { if (live()) setFocusedIndex(index) },
    triggerId,
    menuId,
    getItemId,
    handleTriggerKeyDown,
    handleItemKeyDown,
    handleTriggerClick,
    triggerRef,
    itemRefs,
    containerRef,
  }
}
