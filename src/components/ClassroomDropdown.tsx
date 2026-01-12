'use client'

import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'

interface ClassroomDropdownProps {
  classrooms: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
  currentTab?: string
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
}: ClassroomDropdownProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const currentClassroom = classrooms.find((c) => c.id === currentClassroomId) || classrooms[0]
  const otherClassrooms = classrooms.filter((c) => c.id !== currentClassroom?.id)

  const handleSelect = useCallback((classroomId: string) => {
    setIsOpen(false)
    setFocusedIndex(-1)
    const nextUrl = currentTab
      ? `/classrooms/${classroomId}?tab=${encodeURIComponent(currentTab)}`
      : `/classrooms/${classroomId}`
    router.push(nextUrl)
  }, [currentTab, router])

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false)
      setFocusedIndex(-1)
    }, 150)
  }

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      // Open on arrow down or enter when closed
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
        setIsOpen(false)
        setFocusedIndex(-1)
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) =>
          prev < otherClassrooms.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) =>
          prev > 0 ? prev - 1 : otherClassrooms.length - 1
        )
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < otherClassrooms.length) {
          handleSelect(otherClassrooms[focusedIndex].id)
        }
        break
      case 'Tab':
        setIsOpen(false)
        setFocusedIndex(-1)
        break
    }
  }, [isOpen, focusedIndex, otherClassrooms, handleSelect])

  // Focus the currently focused option
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]?.focus()
    }
  }, [isOpen, focusedIndex])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setFocusedIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Reset refs array when options change
  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, otherClassrooms.length)
  }, [otherClassrooms.length])

  if (classrooms.length === 0) {
    return null
  }

  // If only one classroom, show as plain text
  if (classrooms.length === 1) {
    return (
      <div className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate max-w-xs">
        {classrooms[0].title}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger - plain text with hover highlight */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen)
          if (!isOpen) setFocusedIndex(0)
        }}
        onTouchStart={() => {
          // Faster response on mobile - open immediately on touch
          if (!isOpen) {
            setIsOpen(true)
            setFocusedIndex(0)
          }
        }}
        onKeyDown={handleKeyDown}
        className="px-2 py-1 -mx-2 text-xl font-bold text-gray-900 dark:text-gray-100 truncate max-w-xs rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select classroom"
      >
        {currentClassroom?.title}
      </button>

      {/* Dropdown menu with animation */}
      <div
        className={`absolute top-full left-0 mt-1 min-w-[200px] max-w-xs bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 transition-all duration-150 ease-out origin-top ${
          isOpen && otherClassrooms.length > 0
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
        }`}
        role="listbox"
        aria-label="Available classrooms"
      >
        {otherClassrooms.map((classroom, index) => (
          <button
            key={classroom.id}
            ref={(el) => { optionRefs.current[index] = el }}
            type="button"
            onClick={() => handleSelect(classroom.id)}
            onMouseEnter={() => setFocusedIndex(index)}
            onKeyDown={handleKeyDown}
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
