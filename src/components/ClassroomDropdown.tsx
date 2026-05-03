'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
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
  const allowClickRef = useRef(false)
  const closeDropdownRef = useRef<(() => void) | null>(null)
  const [openingClassroomId, setOpeningClassroomId] = useState<string | null>(null)

  const currentClassroom = classrooms.find((c) => c.id === currentClassroomId) || classrooms[0]
  const openingClassroom = classrooms.find((c) => c.id === openingClassroomId)
  const firstSelectableIndex = classrooms.findIndex((c) => c.id !== currentClassroom?.id)

  const handleSelect = useCallback((index: number) => {
    const classroomId = classrooms[index]?.id
    if (!classroomId || classroomId === currentClassroom?.id || openingClassroomId) return

    const nextUrl = currentTab
      ? `/classrooms/${classroomId}?tab=${encodeURIComponent(currentTab)}`
      : `/classrooms/${classroomId}`
    const allowNavigation = onBeforeNavigate?.(nextUrl)
    if (allowNavigation === false) return
    setOpeningClassroomId(classroomId)
    closeDropdownRef.current?.()
    router.push(nextUrl)
  }, [classrooms, currentClassroom?.id, currentTab, onBeforeNavigate, openingClassroomId, router])

  const {
    isOpen,
    setFocusedIndex,
    triggerId,
    menuId,
    getItemId,
    handleTriggerKeyDown,
    handleItemKeyDown,
    handleTriggerClick,
    itemRefs,
    containerRef,
    setIsOpen,
  } = useDropdownNav({
    itemCount: classrooms.length,
    onSelect: handleSelect,
    initialFocusedIndex: firstSelectableIndex >= 0 ? firstSelectableIndex : 0,
    isItemDisabled: (index) => classrooms[index]?.id === currentClassroom?.id,
  })
  closeDropdownRef.current = () => setIsOpen(false)

  useEffect(() => {
    setOpeningClassroomId(null)
  }, [currentClassroomId])

  if (classrooms.length === 0) {
    return null
  }

  // If only one classroom, show as plain text
  if (classrooms.length === 1) {
    return (
      <div className={`max-w-full truncate text-xl font-bold text-text-default sm:max-w-xs ${className}`}>
        {classrooms[0].title}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative max-w-full ${className}`}
    >
      {/* Trigger */}
      <button
        id={triggerId}
        type="button"
        onPointerDown={() => {
          if (openingClassroomId) return
          allowClickRef.current = true
        }}
        onClick={() => {
          if (openingClassroomId) return
          if (!allowClickRef.current) return
          allowClickRef.current = false
          handleTriggerClick()
        }}
        onKeyDown={handleTriggerKeyDown}
        disabled={openingClassroomId !== null}
        aria-busy={openingClassroomId !== null}
        className="min-w-0 max-w-full truncate rounded-md px-2 py-1 -mx-2 text-xl font-bold text-text-default transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:max-w-xs"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-label="Select classroom"
      >
        <span className="inline-flex min-w-0 max-w-full items-center gap-2">
          {openingClassroomId && (
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          )}
          <span className="truncate">
            {openingClassroom ? `Opening ${openingClassroom.title}...` : currentClassroom?.title}
          </span>
        </span>
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
          const isOpening = classroom.id === openingClassroomId

          return (
            <button
              key={classroom.id}
              id={getItemId(index)}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              type="button"
              onClick={() => handleSelect(index)}
              onMouseEnter={() => {
                if (!isCurrent) setFocusedIndex(index)
              }}
              onKeyDown={handleItemKeyDown}
              disabled={isCurrent || openingClassroomId !== null}
              className={`w-full px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none ${
                isCurrent
                  ? 'cursor-default text-text-muted'
                  : 'text-text-default hover:bg-surface-hover hover:text-text-default focus-visible:bg-surface-hover focus-visible:text-text-default'
              }`}
              role="option"
              aria-selected={isCurrent}
              aria-current={isCurrent ? 'page' : undefined}
              tabIndex={isOpen && !isCurrent ? 0 : -1}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-2">
                  {isOpening && (
                    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {isOpening ? `Opening ${classroom.title}...` : classroom.title}
                  </span>
                </span>
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
