'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HomeIcon, CalendarIcon, MoonIcon, SunIcon } from '@heroicons/react/24/outline'
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
}

/**
 * Compact global header (48px) with logo, classroom selector, icon nav, and user menu.
 * Reduces from previous 64-72px height.
 */
export function AppHeader({ user, classrooms, currentClassroomId }: AppHeaderProps) {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="h-12 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-3">
      {/* Logo */}
      <Link href="/classrooms" className="flex-shrink-0">
        <PikaLogo className="w-8 h-8" />
      </Link>

      {/* Classroom Selector (teachers with multiple classrooms, or when explicitly provided) */}
      {classrooms && classrooms.length > 0 && (
        <ClassroomDropdown
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
        />
      )}

      {/* Icon Navigation */}
      <nav className="flex items-center gap-1">
        <IconNavButton
          href="/classrooms"
          icon={HomeIcon}
          label="Classrooms"
          isActive={pathname === '/classrooms'}
        />
        {user?.role === 'teacher' && (
          <IconNavButton
            href="/calendar"
            icon={CalendarIcon}
            label="Calendar"
            isActive={pathname === '/calendar'}
          />
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

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

interface IconNavButtonProps {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  isActive?: boolean
}

function IconNavButton({ href, icon: Icon, label, isActive }: IconNavButtonProps) {
  return (
    <Link
      href={href}
      className={`p-2 rounded-md transition-colors ${
        isActive
          ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
          : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
      aria-label={label}
      title={label}
    >
      <Icon className="w-5 h-5" />
    </Link>
  )
}
