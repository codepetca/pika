'use client'

import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

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
 */
export function ClassroomDropdown({
  classrooms,
  currentClassroomId,
  currentTab,
}: ClassroomDropdownProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const currentClassroom = classrooms.find((c) => c.id === currentClassroomId) || classrooms[0]
  const otherClassrooms = classrooms.filter((c) => c.id !== currentClassroom?.id)

  const handleSelect = (classroomId: string) => {
    setIsOpen(false)
    const nextUrl = currentTab
      ? `/classrooms/${classroomId}?tab=${encodeURIComponent(currentTab)}`
      : `/classrooms/${classroomId}`
    router.push(nextUrl)
  }

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
    }, 150)
  }

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
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
        onClick={() => setIsOpen(!isOpen)}
        className="px-2 py-1 -mx-2 text-xl font-bold text-gray-900 dark:text-gray-100 truncate max-w-xs rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select classroom"
      >
        {currentClassroom?.title}
      </button>

      {/* Dropdown menu */}
      {isOpen && otherClassrooms.length > 0 && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[200px] max-w-xs bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
          role="listbox"
          aria-label="Available classrooms"
        >
          {otherClassrooms.map((classroom) => (
            <button
              key={classroom.id}
              type="button"
              onClick={() => handleSelect(classroom.id)}
              className="w-full px-3 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors truncate"
              role="option"
              aria-selected={false}
            >
              {classroom.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
