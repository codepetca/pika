'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { useDropdownNav } from '@/hooks/use-dropdown-nav'

interface ClassroomDropdownProps {
  classrooms: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
  currentTab?: string
  className?: string
  onBeforeNavigate?: (href: string) => boolean
}

/**
 * Classroom selector dropdown for quick switching between classrooms.
 * Click to reveal available classrooms in a floating menu.
 * Supports keyboard navigation (Arrow keys, Enter, Escape).
 */
export function ClassroomDropdown({
  classrooms,
  currentClassroomId,
  currentTab,
  className = '',
  onBeforeNavigate,
}: ClassroomDropdownProps) {
  const router = useRouter()
  const touchedRef = useRef(false)

  const currentClassroom = classrooms.find((c) => c.id === currentClassroomId) || classrooms[0]
  const firstSelectableIndex = classrooms.findIndex((c) => c.id !== currentClassroom?.id)

  const handleSelect = useCallback((index: number) => {
    const classroomId = classrooms[index]?.id
    if (!classroomId || classroomId === currentClassroom?.id) return

    const nextUrl = currentTab
      ? `/classrooms/${classroomId}?tab=${encodeURIComponent(currentTab)}`
      : `/classrooms/${classroomId}`
    const allowNavigation = onBeforeNavigate?.(nextUrl)
    if (allowNavigation === false) return
    router.push(nextUrl)
  }, [classrooms, currentClassroom?.id, currentTab, onBeforeNavigate, router])

  const {
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
    itemRefs,
    containerRef,
  } = useDropdownNav({
    itemCount: classrooms.length,
    onSelect: handleSelect,
    initialFocusedIndex: firstSelectableIndex >= 0 ? firstSelectableIndex : 0,
    isItemDisabled: (index) => classrooms[index]?.id === currentClassroom?.id,
  })

  // Handle touch to prevent double-firing with click
  const handleTouchStart = useCallback(() => {
    touchedRef.current = true
    if (!isOpen) {
      setIsOpen(true)
      setFocusedIndex(firstSelectableIndex >= 0 ? firstSelectableIndex : 0)
    }
  }, [firstSelectableIndex, isOpen, setIsOpen, setFocusedIndex])

  const handleClick = useCallback(() => {
    // Skip if this click was triggered by a touch event
    if (touchedRef.current) {
      touchedRef.current = false
      return
    }
    handleTriggerClick()
  }, [handleTriggerClick])

  if (classrooms.length === 0) {
    return null
  }

  // If only one classroom, show as plain text
  if (classrooms.length === 1) {
    return (
      <div className={`text-xl font-bold text-text-default truncate max-w-xs ${className}`}>
        {classrooms[0].title}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
    >
      {/* Trigger */}
      <button
        id={triggerId}
        type="button"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onKeyDown={handleTriggerKeyDown}
        className="px-2 py-1 -mx-2 text-xl font-bold text-text-default truncate max-w-xs rounded-md transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-label="Select classroom"
      >
        {currentClassroom?.title}
      </button>

      {/* Dropdown menu with animation */}
      <div
        id={menuId}
        className={`absolute top-full left-0 mt-1 min-w-[200px] max-w-xs bg-surface rounded-lg shadow-lg border border-border py-1 z-50 transition-all duration-200 origin-top ${
          isOpen && classrooms.length > 0
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
        }`}
        role="listbox"
        aria-labelledby={triggerId}
      >
        {classrooms.map((classroom, index) => {
          const isCurrent = classroom.id === currentClassroom?.id

          return (
          <button
            key={classroom.id}
            id={getItemId(index)}
            ref={(el) => { itemRefs.current[index] = el }}
            type="button"
            onClick={() => handleSelect(index)}
            onMouseEnter={() => {
              if (!isCurrent) setFocusedIndex(index)
            }}
            onKeyDown={handleItemKeyDown}
            disabled={isCurrent}
            className={`w-full px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none ${
              isCurrent
                ? 'cursor-default text-text-muted bg-surface-2'
                : focusedIndex === index
                  ? 'bg-surface-2 text-text-default'
                  : 'text-text-default hover:bg-surface-hover'
            }`}
            role="option"
            aria-selected={isCurrent}
            aria-current={isCurrent ? 'page' : undefined}
            tabIndex={isOpen && !isCurrent ? 0 : -1}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="truncate">{classroom.title}</span>
              {isCurrent && (
                <span className="shrink-0 rounded-badge bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-muted">
                  Current
                </span>
              )}
            </span>
          </button>
          )
        })}
      </div>
    </div>
  )
}
