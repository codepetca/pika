'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bars3Icon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  TableCellsIcon,
  UserGroupIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
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

type NavItem = {
  id: ClassroomNavItemId
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
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
  { id: 'assignments', label: 'Assignments', icon: ClipboardDocumentListIcon },
]

function getItems(role: 'student' | 'teacher') {
  return role === 'teacher' ? teacherItems : studentItems
}

function tabHref(classroomId: string, tabId: ClassroomNavItemId) {
  return `/classrooms/${classroomId}?tab=${encodeURIComponent(tabId)}`
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${encodeURIComponent(name)}=`))
  if (!match) return null
  const value = match.split('=').slice(1).join('=')
  return decodeURIComponent(value)
}

function writeCookie(name: string, value: string) {
  const oneYearSeconds = 60 * 60 * 24 * 365
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${oneYearSeconds}; SameSite=Lax`
  if (process.env.NODE_ENV === 'production') cookie += '; Secure'
  document.cookie = cookie
}

const TEACHER_ASSIGNMENTS_SELECTION_EVENT = 'pika:teacherAssignmentsSelection'

type SidebarAssignment = {
  id: string
  title: string
}

function Nav({
  classroomId,
  activeTab,
  role,
  isCollapsed,
  onNavigate,
  assignments,
  assignmentsExpanded,
  onToggleAssignmentsExpanded,
  activeAssignmentId,
  onSelectAssignment,
  onReorderAssignments,
}: {
  classroomId: string
  activeTab: string
  role: 'student' | 'teacher'
  isCollapsed: boolean
  onNavigate?: () => void
  assignments?: SidebarAssignment[]
  assignmentsExpanded?: boolean
  onToggleAssignmentsExpanded?: () => void
  activeAssignmentId?: string | null
  onSelectAssignment?: (assignmentId: string | null) => void
  onReorderAssignments?: (orderedIds: string[]) => void
}) {
  const router = useRouter()
  const [draggingId, setDraggingId] = useState<string | null>(null)
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

        if (role === 'teacher' && item.id === 'assignments') {
          const canShowNested = !isCollapsed
          const isExpanded = !!assignmentsExpanded

          return (
            <div key={item.id} className={canShowNested ? 'space-y-1' : undefined}>
              <div className="flex items-center">
                <Link
                  href={href}
                  onClick={(e) => {
                    onSelectAssignment?.(null)
                    onNavigate?.()
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  title={isCollapsed ? item.label : undefined}
                  className={[
                    'group flex flex-1 items-center rounded-md text-sm font-medium transition-colors',
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

                {canShowNested && (
                  <button
                    type="button"
                    onClick={onToggleAssignmentsExpanded}
                    className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
                    aria-label={isExpanded ? 'Collapse assignments' : 'Expand assignments'}
                  >
                    <ChevronDownIcon
                      className={[
                        'h-4 w-4 transition-transform',
                        isExpanded ? 'rotate-0' : '-rotate-90',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>

              {canShowNested && isExpanded && assignments && assignments.length > 0 && (
                <div className="pl-10 pr-3 space-y-1">
                  {assignments.map((assignment) => {
                    const isAssignmentActive = activeTab === 'assignments' && activeAssignmentId === assignment.id

                    return (
                      <button
                        key={assignment.id}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingId(assignment.id)
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (!draggingId || draggingId === assignment.id || !onReorderAssignments) return
                          const ids = assignments.map((a) => a.id)
                          const from = ids.indexOf(draggingId)
                          const to = ids.indexOf(assignment.id)
                          if (from === -1 || to === -1) return
                          const next = [...ids]
                          next.splice(from, 1)
                          next.splice(to, 0, draggingId)
                          onReorderAssignments(next)
                          setDraggingId(null)
                        }}
                        onClick={() => {
                          onSelectAssignment?.(assignment.id)
                          router.push(tabHref(classroomId, 'assignments'))
                          onNavigate?.()
                        }}
                        className={[
                          'w-full text-left text-sm rounded-md px-2 py-1.5 transition-colors',
                          isAssignmentActive
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                          draggingId === assignment.id ? 'opacity-60' : '',
                        ].join(' ')}
                        title={assignment.title}
                      >
                        <span className="truncate block">{assignment.title}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }

        return (
          <Link
            key={item.id}
            href={href}
            onClick={(e) => {
              onNavigate?.()
            }}
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
  const router = useRouter()
  const { isCollapsed, toggleCollapsed, expandedWidth, setExpandedWidth } =
    useClassroomSidebar()
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null)
  const asideRef = useRef<HTMLElement | null>(null)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(0)
  const lastResizeWidthRef = useRef(expandedWidth)
  const isResizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)

  const [assignments, setAssignments] = useState<SidebarAssignment[]>([])
  const [assignmentsExpanded, setAssignmentsExpanded] = useState(true)
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)
  const [isReorderingAssignments, setIsReorderingAssignments] = useState(false)

  useEffect(() => {
    if (role !== 'teacher') return
    const cookieName = `pika_sidebar_assignments:${classroomId}`
    const cookieValue = readCookie(cookieName)
    setAssignmentsExpanded(cookieValue !== 'collapsed')
  }, [classroomId, role])

  useEffect(() => {
    if (role !== 'teacher') return
    const selectionCookieName = `teacherAssignmentsSelection:${classroomId}`
    const selection = readCookie(selectionCookieName)
    if (!selection || selection === 'summary') {
      setActiveAssignmentId(null)
      return
    }
    setActiveAssignmentId(selection)
  }, [classroomId, role, activeTab])

  useEffect(() => {
    if (role !== 'teacher') return
    async function loadAssignments() {
      try {
        const response = await fetch(`/api/teacher/assignments?classroom_id=${classroomId}`)
        const data = await response.json()
        setAssignments((data.assignments || []).map((a: any) => ({ id: a.id, title: a.title })))
      } catch {
        setAssignments([])
      }
    }
    loadAssignments()
  }, [classroomId, role])

  function toggleAssignmentsExpanded() {
    const next = !assignmentsExpanded
    setAssignmentsExpanded(next)
    writeCookie(`pika_sidebar_assignments:${classroomId}`, next ? 'expanded' : 'collapsed')
  }

  function setAssignmentsSelectionCookie(assignmentId: string | null) {
    const name = `teacherAssignmentsSelection:${classroomId}`
    const value = assignmentId ? assignmentId : 'summary'
    writeCookie(name, value)
    setActiveAssignmentId(assignmentId)
    window.dispatchEvent(
      new CustomEvent(TEACHER_ASSIGNMENTS_SELECTION_EVENT, {
        detail: { classroomId, value },
      }),
    )
  }

  async function reorderAssignments(orderedIds: string[]) {
    if (role !== 'teacher') return
    setAssignments((prev) => {
      const byId = new Map(prev.map((a) => [a.id, a]))
      return orderedIds.map((id) => byId.get(id)).filter(Boolean) as SidebarAssignment[]
    })
    setIsReorderingAssignments(true)
    try {
      await fetch('/api/teacher/assignments/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom_id: classroomId, assignment_ids: orderedIds }),
      })
    } finally {
      setIsReorderingAssignments(false)
    }
  }

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
            assignments={role === 'teacher' ? assignments : undefined}
            assignmentsExpanded={role === 'teacher' ? assignmentsExpanded : undefined}
            onToggleAssignmentsExpanded={role === 'teacher' ? toggleAssignmentsExpanded : undefined}
            activeAssignmentId={role === 'teacher' ? activeAssignmentId : undefined}
            onSelectAssignment={(assignmentId) => {
              if (role !== 'teacher') return
              setAssignmentsSelectionCookie(assignmentId)
            }}
            onReorderAssignments={(orderedIds) => {
              if (role !== 'teacher' || isReorderingAssignments) return
              reorderAssignments(orderedIds)
            }}
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

                if (role === 'teacher' && item.id === 'assignments') {
                  const isExpanded = assignmentsExpanded

                  return (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center">
                        <Link
                          href={href}
                          onClick={() => {
                            setAssignmentsSelectionCookie(null)
                            onCloseMobile()
                          }}
                          ref={idx === 0 ? firstLinkRef : undefined}
                          aria-current={isActive ? 'page' : undefined}
                          className={[
                            'group flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                          ].join(' ')}
                        >
                          <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                        <button
                          type="button"
                          onClick={toggleAssignmentsExpanded}
                          className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
                          aria-label={isExpanded ? 'Collapse assignments' : 'Expand assignments'}
                        >
                          <ChevronDownIcon
                            className={[
                              'h-4 w-4 transition-transform',
                              isExpanded ? 'rotate-0' : '-rotate-90',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                      {isExpanded && assignments.length > 0 && (
                        <div className="pl-11 pr-3 space-y-1">
                          {assignments.map((assignment) => {
                            const isAssignmentActive =
                              activeTab === 'assignments' && activeAssignmentId === assignment.id
                            return (
                              <button
                                key={assignment.id}
                                type="button"
                                onClick={() => {
                                  setAssignmentsSelectionCookie(assignment.id)
                                  router.push(tabHref(classroomId, 'assignments'))
                                  onCloseMobile()
                                }}
                                className={[
                                  'w-full text-left text-sm rounded-md px-2 py-1.5 transition-colors',
                                  isAssignmentActive
                                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                                ].join(' ')}
                                title={assignment.title}
                              >
                                <span className="truncate block">{assignment.title}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }

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
