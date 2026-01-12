'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { UserCircle, LogOut, Moon, Sun } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useDropdownNav } from '@/hooks/use-dropdown-nav'

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
  const last = lastName?.trim()?.[0]?.toUpperCase()

  if (first && last) return `${first}${last}`
  if (first) return first
  if (last) return last
  return null
}

/**
 * User menu with colored avatar and dropdown.
 * Shows user name, email, theme toggle, and logout.
 * Supports keyboard navigation.
 */
export function UserMenu({ user }: UserMenuProps) {
  const { theme, toggleTheme } = useTheme()

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
    itemCount: 2, // theme toggle, logout
  })

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
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
        className="flex items-center justify-center w-8 h-8 rounded-full transition-all hover:ring-2 hover:ring-gray-300 dark:hover:ring-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
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
          <UserCircle className="w-8 h-8 text-gray-500 dark:text-gray-400" />
        )}
      </button>

      {/* Dropdown menu with animation */}
      <div
        id={menuId}
        className={`absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 transition-all duration-150 ease-out origin-top-right ${
          isOpen
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
        }`}
        role="menu"
        aria-labelledby={triggerId}
      >
        {/* User info section */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {initials ? (
              <span className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center text-white text-base font-semibold flex-shrink-0`}>
                {initials}
              </span>
            ) : (
              <UserCircle className="w-10 h-10 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            )}
            <div className="min-w-0">
              {fullName && (
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {fullName}
                </p>
              )}
              <p className={`text-sm text-gray-500 dark:text-gray-400 truncate ${fullName ? '' : 'font-medium text-gray-900 dark:text-gray-100'}`}>
                {user.email}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">
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
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 transition-colors focus:outline-none ${
            focusedIndex === 0
              ? 'bg-gray-100 dark:bg-gray-700'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        {/* Logout */}
        <Link
          id={getItemId(1)}
          ref={(el) => { itemRefs.current[1] = el }}
          href="/logout"
          onClick={() => setIsOpen(false)}
          onMouseEnter={() => setFocusedIndex(1)}
          onKeyDown={handleItemKeyDown}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 transition-colors focus:outline-none ${
            focusedIndex === 1
              ? 'bg-gray-100 dark:bg-gray-700'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
        >
          <LogOut className="w-4 h-4" />
          Logout
        </Link>
      </div>
    </div>
  )
}
