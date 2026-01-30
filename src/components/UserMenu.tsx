'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { UserCircle, LogOut, Moon, Sun, MessageSquare } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useDropdownNav } from '@/hooks/use-dropdown-nav'
import { FeedbackDialog } from '@/components/FeedbackDialog'

interface UserMenuProps {
  user?: {
    email: string
    role: 'student' | 'teacher'
    first_name?: string | null
    last_name?: string | null
  }
}

/**
 * Generate a consistent color based on a string (name or email).
 * Returns a Tailwind bg color class.
 */
function getAvatarColor(str: string): string {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500',
  ]

  // Simple hash function
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  return colors[Math.abs(hash) % colors.length]
}

/**
 * Get initials from first and last name.
 */
function getInitials(firstName?: string | null, lastName?: string | null): string | null {
  const first = firstName?.trim()?.[0]?.toUpperCase()
  if (first) return first

  const last = lastName?.trim()?.[0]?.toUpperCase()
  if (last) return last

  return null
}

/**
 * User menu with colored avatar and dropdown.
 * Shows user name, email, theme toggle, and logout.
 * Supports keyboard navigation.
 */
export function UserMenu({ user }: UserMenuProps) {
  const { theme, mounted, toggleTheme } = useTheme()
  const [showFeedback, setShowFeedback] = useState(false)

  const handleThemeToggle = useCallback(() => {
    toggleTheme()
    // Don't close menu when toggling theme
  }, [toggleTheme])

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
    itemCount: 3, // theme toggle, feedback, logout
  })

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm text-text-muted hover:text-text-default font-medium"
      >
        Login
      </Link>
    )
  }

  const initials = getInitials(user.first_name, user.last_name)
  const colorClass = getAvatarColor(user.first_name || user.last_name || user.email)
  const fullName = user.first_name && user.last_name
    ? `${user.first_name} ${user.last_name}`.trim()
    : null

  return (
    <div className="relative" ref={containerRef}>
      {/* Avatar trigger */}
      <button
        id={triggerId}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="flex items-center justify-center w-8 h-8 rounded-full transition-all hover:ring-2 hover:ring-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        {initials ? (
          <span className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center text-white text-sm font-semibold`}>
            {initials}
          </span>
        ) : (
          <UserCircle className="w-8 h-8 text-text-muted" />
        )}
      </button>

      {/* Dropdown menu with animation */}
      <div
        id={menuId}
        className={`absolute right-0 mt-2 w-64 bg-surface rounded-lg shadow-lg border border-border py-1 z-50 transition-all duration-200 origin-top-right ${
          isOpen
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
        }`}
        role="menu"
        aria-labelledby={triggerId}
      >
        {/* User info section */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            {initials ? (
              <span className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center text-white text-base font-semibold flex-shrink-0`}>
                {initials}
              </span>
            ) : (
              <UserCircle className="w-10 h-10 text-text-muted flex-shrink-0" />
            )}
            <div className="min-w-0">
              {fullName && (
                <p className="text-sm font-semibold text-text-default truncate">
                  {fullName}
                </p>
              )}
              <p className={`text-sm text-text-muted truncate ${fullName ? '' : 'font-medium text-text-default'}`}>
                {user.email}
              </p>
              <p className="text-xs text-text-muted capitalize">
                {user.role}
              </p>
            </div>
          </div>
        </div>

        {/* Theme toggle */}
        <button
          id={getItemId(0)}
          ref={(el) => { itemRefs.current[0] = el }}
          onClick={handleThemeToggle}
          onMouseEnter={() => setFocusedIndex(0)}
          onKeyDown={handleItemKeyDown}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-text-muted transition-colors focus:outline-none ${
            focusedIndex === 0
              ? 'bg-surface-2'
              : 'hover:bg-surface-hover'
          }`}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
        >
          <span className="w-4 h-4 flex items-center justify-center">
            {mounted && (theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)}
          </span>
          {mounted ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : 'Toggle theme'}
        </button>

        {/* Send Feedback */}
        <button
          id={getItemId(1)}
          ref={(el) => { itemRefs.current[1] = el }}
          onClick={() => { setIsOpen(false); setShowFeedback(true) }}
          onMouseEnter={() => setFocusedIndex(1)}
          onKeyDown={handleItemKeyDown}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-text-muted transition-colors focus:outline-none ${
            focusedIndex === 1
              ? 'bg-surface-2'
              : 'hover:bg-surface-hover'
          }`}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
        >
          <MessageSquare className="w-4 h-4" />
          Send Feedback
        </button>

        {/* Logout */}
        <Link
          id={getItemId(2)}
          ref={(el) => { itemRefs.current[2] = el }}
          href="/logout"
          onClick={() => setIsOpen(false)}
          onMouseEnter={() => setFocusedIndex(2)}
          onKeyDown={handleItemKeyDown}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-text-muted transition-colors focus:outline-none ${
            focusedIndex === 2
              ? 'bg-surface-2'
              : 'hover:bg-surface-hover'
          }`}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
        >
          <LogOut className="w-4 h-4" />
          Logout
        </Link>
      </div>

      <FeedbackDialog isOpen={showFeedback} onClose={() => setShowFeedback(false)} />
    </div>
  )
}
