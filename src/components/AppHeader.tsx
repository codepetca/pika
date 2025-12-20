'use client'

import Link from 'next/link'
import { Bars3Icon, MoonIcon, SunIcon } from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { ClassroomDropdown } from './ClassroomDropdown'
import { UserMenu } from './UserMenu'
import { PikaLogo } from './PikaLogo'
import { useTheme } from '@/contexts/ThemeContext'

interface AppHeaderProps {
  user?: {
    email: string
    role: 'student' | 'teacher'
  }
  classrooms?: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
  currentTab?: string
  onOpenSidebar?: () => void
}

/**
 * Compact global header (48px) with logo, classroom selector, icon nav, and user menu.
 * Reduces from previous 64-72px height.
 */
export function AppHeader({
  user,
  classrooms,
  currentClassroomId,
  currentTab,
  onOpenSidebar,
}: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme()

  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <header className="h-12 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-3">
      {/* Mobile sidebar trigger (classroom pages) */}
      {onOpenSidebar && (
        <button
          type="button"
          onClick={onOpenSidebar}
          className="lg:hidden p-2 -ml-2 rounded-md text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Open classroom navigation"
          title="Open navigation"
        >
          <Bars3Icon className="w-5 h-5" />
        </button>
      )}

      {/* Logo - click to return to classrooms index */}
      <Link href="/classrooms" aria-label="Home" title="Home" className="flex-shrink-0">
        <PikaLogo className="w-8 h-8" />
      </Link>

      {/* Classroom Selector (teachers with multiple classrooms, or when explicitly provided) */}
      {classrooms && classrooms.length > 0 && (
        <ClassroomDropdown
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
          currentTab={currentTab}
        />
      )}

      {/* Date */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
          {formatInTimeZone(now, 'America/Toronto', 'EEE MMM d')}
        </div>
      </div>

      {/* Dark Mode Toggle */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? (
          <SunIcon className="w-5 h-5" />
        ) : (
          <MoonIcon className="w-5 h-5" />
        )}
      </button>

      {/* User Menu */}
      <UserMenu user={user} />
    </header>
  )
}
