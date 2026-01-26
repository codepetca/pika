'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Settings,
  PenSquare,
  Users,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { useLeftSidebar, useMobileDrawer } from './ThreePanelProvider'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { Tooltip } from '@/ui'
import { readCookie, writeCookie } from '@/lib/cookies'
import {
  TEACHER_ASSIGNMENTS_SELECTION_EVENT,
  TEACHER_ASSIGNMENTS_UPDATED_EVENT,
} from '@/lib/events'

// ============================================================================
// Types
// ============================================================================

export type ClassroomNavItemId =
  | 'attendance'
  | 'assignments'
  | 'calendar'
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
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const studentItems: NavItem[] = [
  { id: 'today', label: 'Today', icon: PenSquare },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
]

// ============================================================================
// Utilities
// ============================================================================

function getItems(role: 'student' | 'teacher') {
  return role === 'teacher' ? teacherItems : studentItems
}

function tabHref(classroomId: string, tabId: ClassroomNavItemId) {
  return `/classrooms/${classroomId}?tab=${encodeURIComponent(tabId)}`
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

  const items = useMemo(() => getItems(role), [role])

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
      if (!response.ok) {
        setAssignments([])
        return
      }
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
        if (!response.ok) {
          setAssignments([])
          return
        }
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

  function onNavigate() {
    closeMobileDrawer()
  }

  // Determine layout class based on collapsed state
  const getLayoutClass = (isCollapsed: boolean) =>
    isCollapsed ? 'justify-center w-12 h-12 mx-auto' : 'gap-3 px-3 h-12'

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

          const studentAssignmentsLink = (
              <Link
                href={href}
                onClick={() => {
                  setStudentAssignmentsSelection(null)
                  onNavigate()
                }}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                className={[
                  'group flex flex-1 items-center rounded-md text-base font-medium transition-colors',
                  layoutClass,
                  isActive
                    ? 'bg-info-bg text-info'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
                ].join(' ')}
              >
                <Icon
                  className={[
                    'h-6 w-6 flex-shrink-0',
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
            )

          return (
            <div key={item.id} className={canShowNested ? 'space-y-1' : undefined}>
              <div className="flex items-center">
                {!isExpanded ? (
                  <Tooltip content={item.label}>{studentAssignmentsLink}</Tooltip>
                ) : (
                  studentAssignmentsLink
                )}
              </div>

              {canShowNested && assignments && assignments.length > 0 && (
                <div className="pl-10 pr-3 space-y-1">
                  {assignments.map((assignment) => {
                    const isAssignmentActive =
                      activeTab === 'assignments' && activeAssignmentId === assignment.id
                    const isUnviewed = assignment.hasViewed === false

                    return (
                      <Tooltip key={assignment.id} content={assignment.title}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!assignment.hasViewed) {
                              markAssignmentViewed(assignment.id)
                            }
                            setStudentAssignmentsSelection(assignment.id)
                            onNavigate()
                          }}
                          className={[
                            'w-full text-left text-base rounded-md px-2 py-1.5 transition-colors',
                            isAssignmentActive
                              ? 'bg-info-bg text-info'
                              : isUnviewed
                                ? 'text-primary font-medium hover:bg-info-bg'
                                : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
                          ].join(' ')}
                        >
                          <span className="truncate block">{assignment.title}</span>
                        </button>
                      </Tooltip>
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

          const teacherAssignmentsLink = (
              <Link
                href={href}
                onClick={() => {
                  setAssignmentsSelectionCookie(null)
                  toggleAssignmentsExpanded()
                  onNavigate()
                }}
                aria-current={isActive ? 'page' : undefined}
                aria-expanded={canShowNested ? isExpandedState : undefined}
                aria-label={item.label}
                className={[
                  'group flex items-center rounded-md text-base font-medium transition-colors',
                  layoutClass,
                  isActive
                    ? 'bg-info-bg text-info'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
                ].join(' ')}
              >
                <Icon className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
                {isExpanded && (
                  <>
                    <span className="truncate">{item.label}</span>
                    <ChevronDown
                      className={[
                        'h-4 w-4 ml-auto text-text-muted transition-transform',
                        isExpandedState ? 'rotate-0' : '-rotate-90',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  </>
                )}
                {!isExpanded && <span className="sr-only">{item.label}</span>}
              </Link>
            )

          return (
            <div key={item.id} className={canShowNested ? 'space-y-1' : undefined}>
              {!isExpanded ? (
                <Tooltip content={item.label}>{teacherAssignmentsLink}</Tooltip>
              ) : (
                teacherAssignmentsLink
              )}

              {canShowNested && isExpandedState && assignments && assignments.length > 0 && (
                <div className="pl-10 pr-3 space-y-1">
                  {assignments.map((assignment) => {
                    const isAssignmentActive =
                      activeTab === 'assignments' && activeAssignmentId === assignment.id

                    return (
                      <Tooltip key={assignment.id} content={assignment.title}>
                        <button
                          type="button"
                          onClick={() => {
                            setAssignmentsSelectionCookie(assignment.id)
                            router.push(tabHref(classroomId, 'assignments'))
                            onNavigate()
                          }}
                          className={[
                            'w-full text-left text-base rounded-md px-2 py-1.5 transition-colors',
                            isAssignmentActive
                              ? 'bg-info-bg text-info'
                              : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
                          ].join(' ')}
                        >
                          <span className="truncate block">{assignment.title}</span>
                        </button>
                      </Tooltip>
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

        const navLink = (
          <Link
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.label}
            className={[
              'group flex items-center rounded-md text-base font-medium transition-colors',
              layoutClass,
              isActive
                ? 'bg-info-bg text-info'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
            ].join(' ')}
          >
            <Icon
              className={[
                'h-6 w-6 flex-shrink-0',
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

        return !isExpanded ? (
          <Tooltip key={item.id} content={item.label}>{navLink}</Tooltip>
        ) : (
          <span key={item.id}>{navLink}</span>
        )
      })}
    </nav>
  )
}
