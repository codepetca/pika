'use client'

import Link from 'next/link'
import { ClockAlert, LogOut, Maximize, Menu, Minimize } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { ClassroomDropdown } from './ClassroomDropdown'
import { UserMenu } from './UserMenu'
import { PikaLogo } from './PikaLogo'
import { Tooltip } from '@/ui'
import { useFullscreen } from '@/hooks/use-fullscreen'
import { useKeyboardShortcutHint } from '@/hooks/use-keyboard-shortcut-hint'

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
  onNavigateHome?: (href: string) => boolean
  onNavigateClassroom?: (href: string) => boolean
  examModeHeader?: {
    testTitle: string
    exitsCount: number
    awayTotalSeconds: number
  } | null
  pageTitle?: string
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  if (safe < 60) return `${safe}s`
  if (safe < 3600) return `${Math.floor(safe / 60)}m`
  return `${Math.floor(safe / 3600)}h`
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
  onNavigateHome,
  onNavigateClassroom,
  examModeHeader,
  pageTitle,
}: AppHeaderProps) {
  const [now, setNow] = useState(() => new Date())
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const hints = useKeyboardShortcutHint()

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const isExamMode = Boolean(examModeHeader)

  useEffect(() => {
    if (isExamMode) return
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }
        e.preventDefault()
        void toggleFullscreen()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleFullscreen, isExamMode])

  return (
    <header className="sticky top-0 z-50 h-12 bg-surface border-b border-border grid grid-cols-[1fr_minmax(0,1fr)_1fr] items-center px-4">
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
          <Link
            href="/classrooms"
            aria-label="Home"
            className="flex-shrink-0"
            onClick={(event) => {
              const allow = onNavigateHome?.('/classrooms')
              if (allow === false) {
                event.preventDefault()
              }
            }}
          >
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
            onBeforeNavigate={onNavigateClassroom}
          />
        )}
      </div>

      {/* Center section - page title or exam mode status */}
      <div className="min-w-0 px-2 flex items-center justify-center">
        {examModeHeader ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-6 text-sm text-text-default">
            <span className="truncate font-semibold">{examModeHeader.testTitle}</span>
            <div className="inline-flex items-center gap-3 whitespace-nowrap text-text-muted tabular-nums">
              <span className="inline-flex items-center gap-1">
                <LogOut className="h-3.5 w-3.5" />
                <span>{examModeHeader.exitsCount}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <ClockAlert className="h-3.5 w-3.5" />
                <span>{formatDuration(examModeHeader.awayTotalSeconds)}</span>
              </span>
            </div>
          </div>
        ) : pageTitle ? (
          <h1 className="truncate text-sm font-semibold text-text-default">{pageTitle}</h1>
        ) : null}
      </div>

      {/* Right section */}
      <div className="flex items-center justify-end gap-0">
        {!isExamMode && (
          <Tooltip content={`${isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} (${hints.fullscreen})`}>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="p-2 rounded-md text-text-muted hover:text-text-default hover:bg-surface-hover transition-colors"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </Tooltip>
        )}
        <span className="mr-2 whitespace-nowrap text-base font-semibold tabular-nums text-text-default">
          <span>{formatInTimeZone(now, 'America/Toronto', 'EEE MMM d')}</span>
          <span className="ml-2">{formatInTimeZone(now, 'America/Toronto', 'h:mm a')}</span>
        </span>
        <UserMenu user={user} />
      </div>
    </header>
  )
}
