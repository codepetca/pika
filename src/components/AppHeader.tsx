'use client'

import Link from 'next/link'
import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { ClassroomDropdown } from './ClassroomDropdown'
import { UserMenu } from './UserMenu'
import { PikaLogo } from './PikaLogo'

interface AppHeaderProps {
  user?: {
    email: string
    role: 'student' | 'teacher'
    first_name?: string | null
    last_name?: string | null
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
 * Compact global header (48px) with logo, classroom selector, date, and user menu.
 */
export function AppHeader({
  user,
  classrooms,
  currentClassroomId,
  currentTab,
  onOpenSidebar,
}: AppHeaderProps) {
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
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Logo - click to return to classrooms index */}
      <Link href="/classrooms" aria-label="Home" title="Home" className="flex-shrink-0">
        <PikaLogo className="w-8 h-8" />
      </Link>

      {/* Classroom Selector (teachers with multiple classrooms, or when explicitly provided) */}
      {classrooms && classrooms.length > 0 && (
        <ClassroomDropdown
          className="ml-4"
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
          currentTab={currentTab}
        />
      )}

      {/* Date */}
      <div className="flex-1 flex items-center justify-center">
        {/* Mobile: Short format (Tue Dec 16) */}
        <div className="lg:hidden text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
          {formatInTimeZone(now, 'America/Toronto', 'EEE MMM d')}
        </div>
        {/* Desktop: Long format (Monday January 12, 2026) */}
        <div className="hidden lg:block text-xl font-bold text-gray-900 dark:text-gray-100">
          {formatInTimeZone(now, 'America/Toronto', 'EEEE MMMM d, yyyy')}
        </div>
      </div>

      {/* User Menu */}
      <UserMenu user={user} />
    </header>
  )
}
