'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ClipboardList,
  Settings,
  FileText,
  PenSquare,
  Table,
  Users,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { useLeftSidebar, useMobileDrawer } from './ThreePanelProvider'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'

// ============================================================================
// Types
// ============================================================================

export type ClassroomNavItemId =
  | 'attendance'
  | 'logs'
  | 'assignments'
  | 'roster'
  | 'settings'
  | 'today'

type NavItem = {
  id: ClassroomNavItemId
  label: string
  icon: LucideIcon
}

type SidebarAssignment = {
  id: string
  title: string
  hasViewed?: boolean
}

// ============================================================================
// Constants
// ============================================================================

const teacherItems: NavItem[] = [
  { id: 'attendance', label: 'Attendance', icon: Table },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const studentItems: NavItem[] = [
  { id: 'today', label: 'Today', icon: PenSquare },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
]

const TEACHER_ASSIGNMENTS_SELECTION_EVENT = 'pika:teacherAssignmentsSelection'
const TEACHER_ASSIGNMENTS_UPDATED_EVENT = 'pika:teacherAssignmentsUpdated'

// ============================================================================
// Utilities
// ============================================================================

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

// ============================================================================
// Component
// ============================================================================

export interface NavItemsProps {
  classroomId: string
  role: 'student' | 'teacher'
  activeTab: string
  isReadOnly?: boolean
}

export function NavItems({
  classroomId,
  role,
  activeTab,
  isReadOnly = false,
}: NavItemsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const assignmentIdParam = searchParams.get('assignmentId')
  const { isExpanded } = useLeftSidebar()
  const { close: closeMobileDrawer } = useMobileDrawer()
  const notifications = useStudentNotifications()

  // Compute pulse states for student tabs
  const showTodayPulse =
    role === 'student' && !notifications?.loading && !notifications?.hasTodayEntry
  const showAssignmentsPulse =
    role === 'student' &&
    !notifications?.loading &&
    (notifications?.unviewedAssignmentsCount ?? 0) > 0

  const [assignments, setAssignments] = useState<SidebarAssignment[]>([])
  const [assignmentsExpanded, setAssignmentsExpanded] = useState(true)
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null)
  const [isReorderingAssignments, setIsReorderingAssignments] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const items = useMemo(() => getItems(role), [role])
  const canReorderAssignments = !!role && role === 'teacher' && !isReadOnly

  // Mark an assignment as viewed (optimistic update for students)
  const markAssignmentViewed = useCallback((assignmentId: string) => {
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, hasViewed: true } : a))
    )
  }, [])

  // Load teacher assignments expanded state from cookie
  useEffect(() => {
    if (role !== 'teacher') return
    const cookieName = `pika_sidebar_assignments:${classroomId}`
    const cookieValue = readCookie(cookieName)
    setAssignmentsExpanded(cookieValue !== 'collapsed')
  }, [classroomId, role])

  // Load teacher assignment selection from cookie
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

  // Student assignment selection from URL
  useEffect(() => {
    if (role !== 'student') return
    if (activeTab !== 'assignments') {
      setActiveAssignmentId(null)
      return
    }
    setActiveAssignmentId(assignmentIdParam)
  }, [activeTab, assignmentIdParam, role])

  // Load teacher assignments
  const loadTeacherAssignments = useCallback(async () => {
    try {
      const response = await fetch(`/api/teacher/assignments?classroom_id=${classroomId}`)
      const data = await response.json()
      setAssignments(
        (data.assignments || []).map((a: { id: string; title: string }) => ({
          id: a.id,
          title: a.title,
        }))
      )
    } catch {
      setAssignments([])
    }
  }, [classroomId])

  useEffect(() => {
    if (role !== 'teacher') return
    loadTeacherAssignments()
  }, [loadTeacherAssignments, role])

  // Listen for teacher assignments updates
  useEffect(() => {
    if (role !== 'teacher') return
    function onAssignmentsUpdated(event: Event) {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (!detail || detail.classroomId !== classroomId) return
      loadTeacherAssignments()
    }
    window.addEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, onAssignmentsUpdated)
    return () =>
      window.removeEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, onAssignmentsUpdated)
  }, [classroomId, loadTeacherAssignments, role])

  // Load student assignments
  useEffect(() => {
    if (role !== 'student') return
    async function loadAssignments() {
      try {
        const response = await fetch(`/api/student/assignments?classroom_id=${classroomId}`)
        const data = await response.json()
        setAssignments(
          (data.assignments || []).map(
            (a: { id: string; title: string; doc?: { viewed_at?: string | null } }) => ({
              id: a.id,
              title: a.title,
              hasViewed: a.doc?.viewed_at !== null && a.doc?.viewed_at !== undefined,
            })
          )
        )
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
      })
    )
  }

  function setStudentAssignmentsSelection(assignmentId: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'assignments')

    if (assignmentId) {
      params.set('assignmentId', assignmentId)
    } else {
      params.delete('assignmentId')
    }

    setActiveAssignmentId(assignmentId)
    router.push(`/classrooms/${classroomId}?${params.toString()}`)
  }

  async function reorderAssignments(orderedIds: string[]) {
    if (role !== 'teacher') return
    if (isReadOnly) return
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

  function onNavigate() {
    closeMobileDrawer()
  }

  // Determine layout class based on collapsed state
  const getLayoutClass = (isCollapsed: boolean) =>
    isCollapsed ? 'justify-center w-11 h-10 mx-auto' : 'gap-2 px-2 py-2'

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const isActive = activeTab === item.id
        const Icon = item.icon
        const href = tabHref(classroomId, item.id)
        const layoutClass = getLayoutClass(!isExpanded)

        // Student assignments with nested list (always shown)
        if (role === 'student' && item.id === 'assignments') {
          const canShowNested = isExpanded

          return (
            <div key={item.id} className={canShowNested ? 'space-y-1' : undefined}>
              <div className="flex items-center">
                <Link
                  href={href}
                  onClick={() => {
                    setStudentAssignmentsSelection(null)
                    onNavigate()
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  title={!isExpanded ? item.label : undefined}
                  className={[
                    'group flex flex-1 items-center rounded-md text-sm font-medium transition-colors',
                    layoutClass,
                    isActive
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                  ].join(' ')}
                >
                  <Icon
                    className={[
                      'h-5 w-5 flex-shrink-0',
                      showAssignmentsPulse &&
                        'animate-notification-pulse motion-reduce:animate-none',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden="true"
                  />
                  {isExpanded && <span className="truncate">{item.label}</span>}
                  {!isExpanded && <span className="sr-only">{item.label}</span>}
                </Link>
              </div>

              {canShowNested && assignments && assignments.length > 0 && (
                <div className="pl-10 pr-3 space-y-1">
                  {assignments.map((assignment) => {
                    const isAssignmentActive =
                      activeTab === 'assignments' && activeAssignmentId === assignment.id
                    const isUnviewed = assignment.hasViewed === false

                    return (
                      <button
                        key={assignment.id}
                        type="button"
                        onClick={() => {
                          if (!assignment.hasViewed) {
                            markAssignmentViewed(assignment.id)
                          }
                          setStudentAssignmentsSelection(assignment.id)
                          onNavigate()
                        }}
                        className={[
                          'w-full text-left text-sm rounded-md px-2 py-1.5 transition-colors',
                          isAssignmentActive
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                            : isUnviewed
                              ? 'text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20'
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

        // Teacher assignments with expandable nested list
        if (role === 'teacher' && item.id === 'assignments') {
          const canShowNested = isExpanded
          const isExpandedState = assignmentsExpanded

          return (
            <div key={item.id} className={canShowNested ? 'space-y-1' : undefined}>
              <div className="flex items-center">
                <Link
                  href={href}
                  onClick={() => {
                    setAssignmentsSelectionCookie(null)
                    onNavigate()
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  title={!isExpanded ? item.label : undefined}
                  className={[
                    'group flex flex-1 items-center rounded-md text-sm font-medium transition-colors',
                    layoutClass,
                    isActive
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                  ].join(' ')}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                  {isExpanded && <span className="truncate">{item.label}</span>}
                  {!isExpanded && <span className="sr-only">{item.label}</span>}
                </Link>

                {canShowNested && (
                  <button
                    type="button"
                    onClick={toggleAssignmentsExpanded}
                    className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
                    aria-label={
                      isExpandedState ? 'Collapse assignments' : 'Expand assignments'
                    }
                  >
                    <ChevronDown
                      className={[
                        'h-4 w-4 transition-transform',
                        isExpandedState ? 'rotate-0' : '-rotate-90',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>

              {canShowNested && isExpandedState && assignments && assignments.length > 0 && (
                <div className="pl-10 pr-3 space-y-1">
                  {assignments.map((assignment) => {
                    const isAssignmentActive =
                      activeTab === 'assignments' && activeAssignmentId === assignment.id

                    return (
                      <button
                        key={assignment.id}
                        type="button"
                        draggable={canReorderAssignments}
                        onDragStart={(e) => {
                          if (!canReorderAssignments) return
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingId(assignment.id)
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        onDragOver={(e) => {
                          if (canReorderAssignments) e.preventDefault()
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (
                            !draggingId ||
                            draggingId === assignment.id ||
                            !canReorderAssignments
                          )
                            return
                          const ids = assignments.map((a) => a.id)
                          const from = ids.indexOf(draggingId)
                          const to = ids.indexOf(assignment.id)
                          if (from === -1 || to === -1) return
                          const next = [...ids]
                          next.splice(from, 1)
                          next.splice(to, 0, draggingId)
                          if (!isReorderingAssignments) {
                            reorderAssignments(next)
                          }
                          setDraggingId(null)
                        }}
                        onClick={() => {
                          setAssignmentsSelectionCookie(assignment.id)
                          router.push(tabHref(classroomId, 'assignments'))
                          onNavigate()
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

        // Regular nav items
        const shouldPulse =
          (item.id === 'today' && showTodayPulse) ||
          (item.id === 'assignments' && showAssignmentsPulse)

        return (
          <Link
            key={item.id}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            title={!isExpanded ? item.label : undefined}
            className={[
              'group flex items-center rounded-md text-sm font-medium transition-colors',
              layoutClass,
              isActive
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
            ].join(' ')}
          >
            <Icon
              className={[
                'h-5 w-5 flex-shrink-0',
                shouldPulse && 'animate-notification-pulse motion-reduce:animate-none',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            />
            {isExpanded && <span className="truncate">{item.label}</span>}
            {!isExpanded && <span className="sr-only">{item.label}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
