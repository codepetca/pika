'use client'

import Link from 'next/link'
import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { ClassroomDropdown } from './ClassroomDropdown'
import { UserMenu } from './UserMenu'
import { PikaLogo } from './PikaLogo'
import { Tooltip } from '@/ui'

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
    <header className="h-12 bg-surface border-b border-border grid grid-cols-[1fr_auto_1fr] items-center px-4">
      {/* Left section */}
      <div className="flex items-center gap-3">
        {/* Mobile sidebar trigger (classroom pages) */}
        {onOpenSidebar && (
          <Tooltip content="Open navigation">
            <button
              type="button"
              onClick={onOpenSidebar}
              className="lg:hidden p-2 -ml-2 rounded-md text-text-muted hover:text-text-default hover:bg-surface-hover transition-colors"
              aria-label="Open classroom navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
          </Tooltip>
        )}

        {/* Logo - click to return to classrooms index */}
        <Tooltip content="Home">
          <Link href="/classrooms" aria-label="Home" className="flex-shrink-0">
            <PikaLogo className="w-8 h-8" />
          </Link>
        </Tooltip>

        {/* Classroom Selector (teachers with multiple classrooms, or when explicitly provided) */}
        {classrooms && classrooms.length > 0 && (
          <ClassroomDropdown
            className="ml-4"
            classrooms={classrooms}
            currentClassroomId={currentClassroomId}
            currentTab={currentTab}
          />
        )}
      </div>

      {/* Center section - Date */}
      <div>
        {/* Mobile: Short format (Tue Dec 16) */}
        <div className="lg:hidden text-lg sm:text-xl font-bold text-text-default tabular-nums">
          {formatInTimeZone(now, 'America/Toronto', 'EEE MMM d')}
        </div>
        {/* Desktop: Long format (Monday January 12, 2026) */}
        <div className="hidden lg:block text-xl font-bold text-text-default">
          {formatInTimeZone(now, 'America/Toronto', 'EEEE MMMM d, yyyy')}
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center justify-end">
        <UserMenu user={user} />
      </div>
    </header>
  )
}
