'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type SVGProps } from 'react'
import {
  Bars3Icon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  TableCellsIcon,
  UserGroupIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { useClassroomSidebar } from './ClassroomSidebarProvider'
import { CLASSROOM_SIDEBAR } from '@/lib/classroom-sidebar'

export type ClassroomNavItemId =
  | 'attendance'
  | 'logs'
  | 'assignments'
  | 'roster'
  | 'calendar'
  | 'settings'
  | 'today'
  | 'history'

type NavItem = {
  id: ClassroomNavItemId
  label: string
  icon: (props: SVGProps<SVGSVGElement>) => JSX.Element
}

const teacherItems: NavItem[] = [
  { id: 'attendance', label: 'Attendance', icon: TableCellsIcon },
  { id: 'logs', label: 'Logs', icon: DocumentTextIcon },
  { id: 'assignments', label: 'Assignments', icon: ClipboardDocumentListIcon },
  { id: 'roster', label: 'Roster', icon: UserGroupIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarDaysIcon },
  { id: 'settings', label: 'Settings', icon: Cog6ToothIcon },
]

const studentItems: NavItem[] = [
  { id: 'today', label: 'Today', icon: PencilSquareIcon },
  { id: 'history', label: 'History', icon: ClockIcon },
  { id: 'assignments', label: 'Assignments', icon: ClipboardDocumentListIcon },
]

function getItems(role: 'student' | 'teacher') {
  return role === 'teacher' ? teacherItems : studentItems
}

function tabHref(classroomId: string, tabId: ClassroomNavItemId) {
  return `/classrooms/${classroomId}?tab=${encodeURIComponent(tabId)}`
}

function Nav({
  classroomId,
  activeTab,
  role,
  isCollapsed,
  onNavigate,
}: {
  classroomId: string
  activeTab: string
  role: 'student' | 'teacher'
  isCollapsed: boolean
  onNavigate?: () => void
}) {
  const items = useMemo(() => getItems(role), [role])

  return (
    <nav className="space-y-1">
      {items.map(item => {
        const isActive = activeTab === item.id
        const Icon = item.icon
        const href = tabHref(classroomId, item.id)

        const layoutClass = isCollapsed
          ? 'justify-center w-10 h-10 mx-auto'
          : 'gap-3 px-3 py-2'

        return (
          <Link
            key={item.id}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            title={isCollapsed ? item.label : undefined}
            className={[
              'group flex items-center rounded-md text-sm font-medium transition-colors',
              layoutClass,
              isActive
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
            ].join(' ')}
          >
            <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
            {isCollapsed && <span className="sr-only">{item.label}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

export function ClassroomSidebar({
  classroomId,
  role,
  activeTab,
  isMobileOpen,
  onCloseMobile,
}: {
  classroomId: string
  role: 'student' | 'teacher'
  activeTab: string
  isMobileOpen: boolean
  onCloseMobile: () => void
}) {
  const { isCollapsed, toggleCollapsed, expandedWidth, setExpandedWidth } =
    useClassroomSidebar()
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null)
  const asideRef = useRef<HTMLElement | null>(null)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(0)
  const lastResizeWidthRef = useRef(expandedWidth)
  const isResizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    if (!isMobileOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile()
    }

    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [isMobileOpen, onCloseMobile])

  useEffect(() => {
    if (!isMobileOpen) return
    firstLinkRef.current?.focus()
  }, [isMobileOpen])

  useEffect(() => {
    lastResizeWidthRef.current = expandedWidth
  }, [expandedWidth])

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        ref={asideRef}
        className={[
          'hidden lg:flex shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
          'h-[calc(100vh-3rem)] sticky top-12',
          isResizing ? 'transition-none' : 'transition-[width] duration-200',
          'relative',
        ].join(' ')}
        style={{
          width: isCollapsed ? CLASSROOM_SIDEBAR.collapsedWidth : expandedWidth,
        }}
      >
        <div className={['flex w-full flex-col', isCollapsed ? 'p-1' : 'p-3'].join(' ')}>
          <Nav
            classroomId={classroomId}
            activeTab={activeTab}
            role={role}
            isCollapsed={isCollapsed}
          />

          <div className="flex-1" />

          <button
            type="button"
            onClick={toggleCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            className={[
              'mt-3 flex items-center rounded-md text-sm font-medium',
              'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
              isCollapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2',
            ].join(' ')}
          >
            {isCollapsed ? (
              <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
            ) : (
              <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            )}
            <span className="sr-only">{isCollapsed ? 'Expand' : 'Minimize'}</span>
          </button>
        </div>

        {/* Drag handle (expanded only) */}
        {!isCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
            className={[
              'absolute right-0 top-0 bottom-0 w-3',
              'cursor-col-resize touch-none',
              'after:absolute after:inset-y-0 after:left-1/2 after:-translate-x-1/2 after:w-px',
              'after:bg-transparent hover:after:bg-gray-300 dark:hover:after:bg-gray-700',
            ].join(' ')}
            onPointerDown={e => {
              e.preventDefault()
              isResizingRef.current = true
              setIsResizing(true)
              resizeStartXRef.current = e.clientX
              resizeStartWidthRef.current =
                asideRef.current?.getBoundingClientRect().width ||
                lastResizeWidthRef.current

              const prevCursor = document.body.style.cursor
              const prevUserSelect = document.body.style.userSelect
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'

              const onMove = (ev: PointerEvent) => {
                if (!isResizingRef.current) return
                const delta = ev.clientX - resizeStartXRef.current
                const next = resizeStartWidthRef.current + delta
                const clamped = Math.max(
                  CLASSROOM_SIDEBAR.width.min,
                  Math.min(CLASSROOM_SIDEBAR.width.max, Math.round(next))
                )

                lastResizeWidthRef.current = clamped
                if (asideRef.current) asideRef.current.style.width = `${clamped}px`
              }

              const finish = () => {
                if (!isResizingRef.current) return
                isResizingRef.current = false
                setIsResizing(false)
                document.body.style.cursor = prevCursor
                document.body.style.userSelect = prevUserSelect
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', finish)
                window.removeEventListener('pointercancel', finish)
                setExpandedWidth(lastResizeWidthRef.current, { persist: true })
              }

              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', finish)
              window.addEventListener('pointercancel', finish)
            }}
          />
        )}
      </aside>

      {/* Mobile drawer */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close classroom navigation"
            className="absolute inset-0 bg-black/40"
            onClick={onCloseMobile}
          />

          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shadow-xl p-3"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Bars3Icon className="h-5 w-5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
                <span>Navigation</span>
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-1">
              {getItems(role).map((item, idx) => {
                const isActive = activeTab === item.id
                const Icon = item.icon
                const href = tabHref(classroomId, item.id)

                return (
                  <Link
                    key={item.id}
                    href={href}
                    onClick={onCloseMobile}
                    ref={idx === 0 ? firstLinkRef : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={[
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                    ].join(' ')}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
