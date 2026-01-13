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
}

/**
 * Classroom selector dropdown for quick switching between classrooms.
 * Hover or click to reveal available classrooms in a floating menu.
 * Supports keyboard navigation (Arrow keys, Enter, Escape).
 */
export function ClassroomDropdown({
  classrooms,
  currentClassroomId,
  currentTab,
  className = '',
}: ClassroomDropdownProps) {
  const router = useRouter()
  const touchedRef = useRef(false)

  const currentClassroom = classrooms.find((c) => c.id === currentClassroomId) || classrooms[0]
  const otherClassrooms = classrooms.filter((c) => c.id !== currentClassroom?.id)

  const handleSelect = useCallback((index: number) => {
    const classroomId = otherClassrooms[index]?.id
    if (!classroomId) return

    const nextUrl = currentTab
      ? `/classrooms/${classroomId}?tab=${encodeURIComponent(currentTab)}`
      : `/classrooms/${classroomId}`
    router.push(nextUrl)
  }, [currentTab, router, otherClassrooms])

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
    handleMouseEnter,
    handleMouseLeave,
    itemRefs,
    containerRef,
  } = useDropdownNav({
    itemCount: otherClassrooms.length,
    onSelect: handleSelect,
  })

  // Handle touch to prevent double-firing with click
  const handleTouchStart = useCallback(() => {
    touchedRef.current = true
    if (!isOpen) {
      setIsOpen(true)
      setFocusedIndex(0)
    }
  }, [isOpen, setIsOpen, setFocusedIndex])

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
      <div className={`text-xl font-bold text-gray-900 dark:text-gray-100 truncate max-w-xs ${className}`}>
        {classrooms[0].title}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger - plain text with hover highlight */}
      <button
        id={triggerId}
        type="button"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onKeyDown={handleTriggerKeyDown}
        className="px-2 py-1 -mx-2 text-xl font-bold text-gray-900 dark:text-gray-100 truncate max-w-xs rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
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
        className={`absolute top-full left-0 mt-1 min-w-[200px] max-w-xs bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 transition-all duration-200 origin-top ${
          isOpen && otherClassrooms.length > 0
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
        }`}
        role="listbox"
        aria-labelledby={triggerId}
      >
        {otherClassrooms.map((classroom, index) => (
          <button
            key={classroom.id}
            id={getItemId(index)}
            ref={(el) => { itemRefs.current[index] = el }}
            type="button"
            onClick={() => handleSelect(index)}
            onMouseEnter={() => setFocusedIndex(index)}
            onKeyDown={handleItemKeyDown}
            className={`w-full px-3 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors truncate focus:outline-none ${
              focusedIndex === index
                ? 'bg-gray-100 dark:bg-gray-700'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            role="option"
            aria-selected={focusedIndex === index}
            tabIndex={isOpen ? 0 : -1}
          >
            {classroom.title}
          </button>
        ))}
      </div>
    </div>
  )
}
