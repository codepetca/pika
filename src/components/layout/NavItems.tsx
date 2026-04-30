'use client'

import { useCallback, useMemo } from 'react'
import {
  Calendar,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  LibraryBig,
  FileCheck,
  Settings,
  PenSquare,
  SquarePercent,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useLeftSidebar, useMobileDrawer } from './ThreePanelProvider'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { Tooltip } from '@/ui'
import { writeCookie } from '@/lib/cookies'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT } from '@/lib/events'

// ============================================================================
// Types
// ============================================================================

export type ClassroomNavItemId =
  | 'attendance'
  | 'gradebook'
  | 'assignments'
  | 'quizzes'
  | 'tests'
  | 'calendar'
  | 'resources'
  | 'roster'
  | 'settings'
  | 'today'

type NavItem = {
  id: ClassroomNavItemId
  label: string
  icon: LucideIcon
}

// ============================================================================
// Constants
// ============================================================================

const teacherItems: NavItem[] = [
  { id: 'attendance', label: 'Daily', icon: ClipboardCheck },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'quizzes', label: 'Quizzes', icon: CircleHelp },
  { id: 'tests', label: 'Tests', icon: FileCheck },
  { id: 'gradebook', label: 'Gradebook', icon: SquarePercent },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'resources', label: 'Resources', icon: LibraryBig },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const studentItems: NavItem[] = [
  { id: 'today', label: 'Today', icon: PenSquare },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'quizzes', label: 'Quizzes', icon: CircleHelp },
  { id: 'tests', label: 'Tests', icon: FileCheck },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'resources', label: 'Resources', icon: LibraryBig },
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

type NavIconWithDotProps = {
  Icon: LucideIcon
  showDot: boolean
}

function NavIconWithDot({ Icon, showDot }: NavIconWithDotProps) {
  return (
    <span className="relative inline-flex h-6 w-6 flex-shrink-0 items-center justify-center">
      <Icon className="h-6 w-6" aria-hidden="true" />
      {showDot && (
        <span
          aria-hidden="true"
          data-new-activity-dot="true"
          className="pointer-events-none absolute left-0 top-0 h-2.5 w-2.5 -translate-x-1/4 -translate-y-1/4 rounded-full bg-primary ring-2 ring-surface"
        />
      )}
    </span>
  )
}

// ============================================================================
// Component
// ============================================================================

export interface NavItemsProps {
  classroomId: string
  role: 'student' | 'teacher'
  activeTab: string
  onTabChange: (tab: ClassroomNavItemId) => void
  onTabIntent?: (tab: ClassroomNavItemId) => void
  updateSearchParams: (updater: (params: URLSearchParams) => void, options?: { replace?: boolean }) => void
}

export function NavItems({
  classroomId,
  role,
  activeTab,
  onTabChange,
  onTabIntent = () => {},
  updateSearchParams,
}: NavItemsProps) {
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
  const showQuizzesPulse =
    role === 'student' &&
    !notifications?.loading &&
    (notifications?.activeQuizzesCount ?? 0) > 0
  const showTestsPulse =
    role === 'student' &&
    !notifications?.loading &&
    (notifications?.activeTestsCount ?? 0) > 0
  const showResourcesPulse =
    role === 'student' &&
    !notifications?.loading &&
    (notifications?.unreadAnnouncementsCount ?? 0) > 0

  const items = useMemo(() => getItems(role), [role])
  const handleTabIntent = useCallback((tab: ClassroomNavItemId) => {
    onTabIntent(tab)
  }, [onTabIntent])

  function setTeacherAssignmentsSelection(assignmentId: string | null) {
    const name = `teacherAssignmentsSelection:${classroomId}`
    const value = assignmentId ? assignmentId : 'summary'
    writeCookie(name, value)
    updateSearchParams((params) => {
      params.set('tab', 'assignments')
      if (assignmentId) {
        params.set('assignmentId', assignmentId)
      } else {
        params.delete('assignmentId')
      }
      params.delete('assignmentStudentId')
    })
    window.dispatchEvent(
      new CustomEvent(TEACHER_ASSIGNMENTS_SELECTION_EVENT, {
        detail: { classroomId, value },
      })
    )
  }

  function setStudentAssignmentsSelection(assignmentId: string | null) {
    updateSearchParams((params) => {
      params.set('tab', 'assignments')
      if (assignmentId) {
        params.set('assignmentId', assignmentId)
      } else {
        params.delete('assignmentId')
      }
      params.delete('assignmentStudentId')
    })
  }

  function onNavigate() {
    closeMobileDrawer()
  }

  const activeItemClass = 'bg-surface-selected text-text-default shadow-sm'
  const inactiveItemClass = 'text-text-muted hover:bg-surface-hover hover:text-text-default'
  const itemRadiusClass = 'rounded-control'

  // Determine layout class based on collapsed state
  const getLayoutClass = (isCollapsed: boolean) =>
    isCollapsed ? 'justify-center w-full h-12 px-0' : 'gap-3 px-3 h-12 w-full'

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const isActive = activeTab === item.id
        const Icon = item.icon
        const href = tabHref(classroomId, item.id)
        const layoutClass = getLayoutClass(!isExpanded)

        // Regular nav items
        const shouldPulse =
          (item.id === 'today' && showTodayPulse) ||
          (item.id === 'assignments' && showAssignmentsPulse) ||
          (item.id === 'quizzes' && showQuizzesPulse) ||
          (item.id === 'tests' && showTestsPulse) ||
          (item.id === 'resources' && showResourcesPulse)
        const ariaLabel = shouldPulse ? `${item.label} (new activity)` : item.label

        const navLink = (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault()
              if (item.id === 'assignments') {
                onTabChange('assignments')
                if (role === 'teacher') {
                  setTeacherAssignmentsSelection(null)
                } else {
                  setStudentAssignmentsSelection(null)
                }
                onNavigate()
                return
              }
              onTabChange(item.id)
              onNavigate()
            }}
            onMouseEnter={() => handleTabIntent(item.id)}
            onFocus={() => handleTabIntent(item.id)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={ariaLabel}
            className={[
              'group flex items-center text-base font-medium transition-colors',
              itemRadiusClass,
              layoutClass,
              isActive ? activeItemClass : inactiveItemClass,
            ].join(' ')}
          >
            <NavIconWithDot Icon={Icon} showDot={shouldPulse} />
            {isExpanded && <span className="truncate">{item.label}</span>}
            {!isExpanded && <span className="sr-only">{item.label}</span>}
          </a>
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
