'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { UserCircle, LogOut } from 'lucide-react'

interface UserMenuProps {
  user?: {
    email: string
    role: 'student' | 'teacher'
  }
}

/**
 * User menu with avatar and dropdown for logout.
 * Shows user email and provides logout action.
 */
export function UserMenu({ user }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

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

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="User menu"
        aria-expanded={isOpen}
      >
        <UserCircle className="w-7 h-7 text-gray-600 dark:text-gray-300" />
        <span className="text-sm text-gray-700 dark:text-gray-300 hidden sm:inline max-w-[150px] truncate">
          {user.email}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user.email}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{user.role}</p>
          </div>

          <Link
            href="/logout"
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => setIsOpen(false)}
          >
            <LogOut className="w-4 h-4" />
            Logout
          </Link>
        </div>
      )}
    </div>
  )
}
