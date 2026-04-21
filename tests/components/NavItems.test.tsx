import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NavItems } from '@/components/layout/NavItems'

type MockNotifications = {
  hasTodayEntry: boolean
  unviewedAssignmentsCount: number
  activeQuizzesCount: number
  activeTestsCount: number
  unreadAnnouncementsCount: number
  loading: boolean
}

let mockNotifications: MockNotifications | null = null
const fetchJSONWithCacheMock = vi.fn()

vi.mock('@/components/layout/ThreePanelProvider', () => ({
  useLeftSidebar: () => ({ isExpanded: true }),
  useMobileDrawer: () => ({ close: vi.fn() }),
}))

vi.mock('@/components/StudentNotificationsProvider', () => ({
  useStudentNotifications: () => mockNotifications,
}))

vi.mock('@/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/cookies', () => ({
  readCookie: vi.fn(() => undefined),
  writeCookie: vi.fn(),
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: (...args: unknown[]) => fetchJSONWithCacheMock(...args),
}))

function baseNotifications(overrides: Partial<MockNotifications> = {}): MockNotifications {
  return {
    hasTodayEntry: true,
    unviewedAssignmentsCount: 0,
    activeQuizzesCount: 0,
    activeTestsCount: 0,
    unreadAnnouncementsCount: 0,
    loading: false,
    ...overrides,
  }
}

function renderNav(role: 'student' | 'teacher', activeTab = 'today') {
  return render(
    <NavItems
      classroomId="classroom-1"
      role={role}
      activeTab={activeTab}
      isReadOnly={false}
      assignmentId={null}
      onTabChange={vi.fn()}
      updateSearchParams={vi.fn()}
    />
  )
}

describe('NavItems notification dots', () => {
  beforeEach(() => {
    mockNotifications = baseNotifications()
    fetchJSONWithCacheMock.mockReset()
    fetchJSONWithCacheMock.mockImplementation(() => new Promise(() => {}))
  })

  it('shows dot and aria-label suffix for student today tab with new activity', () => {
    mockNotifications = baseNotifications({ hasTodayEntry: false })
    const { container } = renderNav('student', 'today')

    const todayLink = screen.getByRole('link', { name: 'Today (new activity)' })
    expect(todayLink.querySelector('[data-new-activity-dot="true"]')).toBeTruthy()
    expect(container.querySelector('.animate-notification-pulse')).toBeNull()
  })

  it('shows no dot and original aria-label when there is no new student activity', () => {
    renderNav('student', 'today')

    const todayLink = screen.getByRole('link', { name: 'Today' })
    expect(todayLink.querySelector('[data-new-activity-dot="true"]')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Today (new activity)' })).toBeNull()
  })

  it('uses dot path for student assignments nav item', () => {
    mockNotifications = baseNotifications({ unviewedAssignmentsCount: 2 })
    renderNav('student', 'assignments')

    const assignmentsLink = screen.getByRole('link', { name: 'Assignments (new activity)' })
    expect(assignmentsLink.querySelector('[data-new-activity-dot="true"]')).toBeTruthy()
  })

  it('does not render notification dots for teacher nav items', () => {
    mockNotifications = baseNotifications({
      hasTodayEntry: false,
      unviewedAssignmentsCount: 3,
      activeQuizzesCount: 2,
      activeTestsCount: 1,
      unreadAnnouncementsCount: 4,
    })
    const { container } = renderNav('teacher', 'attendance')

    expect(screen.getByRole('link', { name: 'Daily' })).toBeInTheDocument()
    expect(container.querySelector('[data-new-activity-dot="true"]')).toBeNull()
    expect(screen.queryByRole('link', { name: /new activity/i })).toBeNull()
  })
})
