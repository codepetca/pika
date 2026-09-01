import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NavItems } from '@/components/layout/NavItems'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

type MockNotifications = {
  hasTodayEntry: boolean
  unviewedAssignmentsCount: number
  activeTestsCount: number
  unreadAnnouncementsCount: number
  loading: boolean
}

let mockNotifications: MockNotifications | null = null
let mockLeftSidebarExpanded = true
let mockMobileLeftOpen = false

vi.mock('@/components/layout/ThreePanelProvider', () => ({
  useLeftSidebar: () => ({ isExpanded: mockLeftSidebarExpanded }),
  useMobileDrawer: () => ({ isLeftOpen: mockMobileLeftOpen, close: vi.fn() }),
}))

vi.mock('@/components/StudentNotificationsProvider', () => ({
  useStudentNotifications: () => mockNotifications,
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/lib/cookies', () => ({
  writeCookie: vi.fn(),
}))

function baseNotifications(overrides: Partial<MockNotifications> = {}): MockNotifications {
  return {
    hasTodayEntry: true,
    unviewedAssignmentsCount: 0,
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
      onTabChange={vi.fn()}
      updateSearchParams={vi.fn()}
    />
  )
}

describe('NavItems notification dots', () => {
  beforeEach(() => {
    mockNotifications = baseNotifications()
    mockLeftSidebarExpanded = true
    mockMobileLeftOpen = false
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
    expect(screen.queryByRole('link', { name: 'Quizzes' })).toBeNull()
  })

  it('does not render a student quizzes nav item', () => {
    renderNav('student', 'today')

    expect(screen.getByRole('link', { name: 'Tests' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Quizzes' })).toBeNull()
  })

  it('uses the canonical feature icons in both classroom sidebars', () => {
    const { rerender } = renderNav('teacher', 'tests')

    expect(screen.getByRole('link', { name: 'Tests' }).querySelector('svg')).toHaveClass('lucide-square-pen')
    expect(screen.getByRole('link', { name: 'Course Guide' }).querySelector('svg')).toHaveClass('lucide-compass')

    rerender(
      <NavItems
        classroomId="classroom-1"
        role="student"
        activeTab="tests"
        onTabChange={vi.fn()}
        updateSearchParams={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: 'Today' }).querySelector('svg')).toHaveClass('lucide-clipboard-check')
    expect(screen.getByRole('link', { name: 'Tests' }).querySelector('svg')).toHaveClass('lucide-square-pen')
    expect(screen.getByRole('link', { name: 'Course Guide' }).querySelector('svg')).toHaveClass('lucide-compass')
  })

  it('shows the learner achievements destination only when the Pal pilot is enabled', () => {
    const { rerender } = render(
      <NavItems
        classroomId="classroom-1"
        role="student"
        activeTab="today"
        onTabChange={vi.fn()}
        updateSearchParams={vi.fn()}
        palEnabled={false}
      />
    )
    expect(screen.queryByRole('link', { name: 'Achievements' })).toBeNull()

    rerender(
      <NavItems
        classroomId="classroom-1"
        role="student"
        activeTab="achievements"
        onTabChange={vi.fn()}
        updateSearchParams={vi.fn()}
        palEnabled
      />
    )
    const achievementsLink = screen.getByRole('link', { name: 'Achievements' })
    expect(achievementsLink).toHaveAttribute('aria-current', 'page')
    expect(achievementsLink.parentElement).toHaveClass('mt-auto')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Today',
      'Classwork',
      'Tests',
      'Calendar',
      'Course Guide',
      'Announcements',
      'Achievements',
    ])
  })

  it('uses dot path for student assignments nav item', () => {
    mockNotifications = baseNotifications({ unviewedAssignmentsCount: 2 })
    renderNav('student', 'assignments')

    const assignmentsLink = screen.getByRole('link', { name: 'Classwork (new activity)' })
    expect(assignmentsLink.querySelector('[data-new-activity-dot="true"]')).toBeTruthy()
  })

  it('renders teacher assignments as a plain nav item without a dropdown affordance', () => {
    renderNav('teacher', 'assignments')

    const assignmentsLink = screen.getByRole('link', { name: 'Classwork' })
    expect(assignmentsLink).not.toHaveAttribute('aria-expanded')
    expect(screen.getAllByRole('link', { name: 'Classwork' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /assignment/i })).toBeNull()
  })

  it('shows nav labels in the mobile drawer when the desktop rail is collapsed', () => {
    mockLeftSidebarExpanded = false
    mockMobileLeftOpen = true

    renderNav('teacher', 'attendance')

    const dailyLabel = screen.getByText('Daily')
    const dailyLink = screen.getByRole('link', { name: 'Daily' })

    expect(dailyLabel).not.toHaveClass('sr-only')
    expect(dailyLink).toHaveClass('gap-3')
    expect(dailyLink).toHaveClass('px-3')
    expect(dailyLink).not.toHaveClass('justify-center')
  })

  it('keeps nav labels visually hidden when the desktop rail is collapsed', () => {
    mockLeftSidebarExpanded = false

    renderNav('teacher', 'attendance')

    const dailyLabel = screen.getByText('Daily')
    const dailyLink = screen.getByRole('link', { name: 'Daily' })

    expect(dailyLabel).toHaveClass('sr-only')
    expect(dailyLink).toHaveClass('justify-center')
    expect(dailyLink).not.toHaveClass('gap-3')
  })

  it('renders student assignments as a plain nav item instead of a nested assignment list', () => {
    mockNotifications = baseNotifications({ unviewedAssignmentsCount: 2 })
    renderNav('student', 'assignments')

    expect(screen.getAllByRole('link', { name: 'Classwork (new activity)' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /assignment/i })).toBeNull()
  })

  it('puts unread announcement activity on the announcements nav item', () => {
    mockNotifications = baseNotifications({ unreadAnnouncementsCount: 4 })
    renderNav('student', 'announcements')

    const announcementsLink = screen.getByRole('link', { name: 'Announcements (new activity)' })
    expect(announcementsLink.querySelector('[data-new-activity-dot="true"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Course Guide' }).querySelector('[data-new-activity-dot="true"]')).toBeNull()
  })

  it('does not render notification dots for teacher nav items', () => {
    mockNotifications = baseNotifications({
      hasTodayEntry: false,
      unviewedAssignmentsCount: 3,
      activeTestsCount: 1,
      unreadAnnouncementsCount: 4,
    })
    const { container } = renderNav('teacher', 'daily')

    expect(screen.getByRole('link', { name: 'Daily' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Attendance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Quizzes' })).toBeNull()
    expect(container.querySelector('[data-new-activity-dot="true"]')).toBeNull()
    expect(screen.queryByRole('link', { name: /new activity/i })).toBeNull()
  })

  it('hides disabled features while preserving role-specific core tabs', () => {
    const featureVisibility = {
      ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
      attendance: false,
      classwork: false,
      tests: false,
      calendar: false,
      syllabus: false,
      announcements: false,
    }
    const { rerender } = render(
      <NavItems
        classroomId="classroom-1"
        role="teacher"
        activeTab="daily"
        onTabChange={vi.fn()}
        updateSearchParams={vi.fn()}
        featureVisibility={featureVisibility}
      />,
    )

    expect(screen.getByRole('link', { name: 'Daily' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Roster' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Attendance' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Classwork' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Tests' })).toBeNull()

    rerender(
      <NavItems
        classroomId="classroom-1"
        role="student"
        activeTab="today"
        onTabChange={vi.fn()}
        updateSearchParams={vi.fn()}
        featureVisibility={featureVisibility}
      />,
    )
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Classwork' })).toBeNull()
  })

  it('clears classwork selection with replace when the sidebar tab is clicked', () => {
    const onTabChange = vi.fn()
    const updateSearchParams = vi.fn()
    render(
      <NavItems
        classroomId="classroom-1"
        role="teacher"
        activeTab="assignments"
        onTabChange={onTabChange}
        updateSearchParams={updateSearchParams}
      />
    )

    fireEvent.click(screen.getByRole('link', { name: 'Classwork' }))

    expect(onTabChange).toHaveBeenCalledWith('assignments')
    expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true })
    const params = new URLSearchParams('tab=assignments&assignmentId=assignment-1&assignmentStudentId=student-1')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('tab')).toBe('assignments')
    expect(params.get('assignmentId')).toBeNull()
    expect(params.get('assignmentStudentId')).toBeNull()
  })
})
