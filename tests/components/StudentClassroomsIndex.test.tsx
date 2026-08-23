import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { StudentClassroomsIndex } from '@/app/classrooms/StudentClassroomsIndex'
import { invalidateStudentAttendanceStatus } from '@/lib/student-attendance-client'
import { createMockClassroom } from '../helpers/mocks'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

describe('StudentClassroomsIndex', () => {
  beforeEach(() => {
    push.mockReset()
  })

  afterEach(() => {
    invalidateStudentAttendanceStatus()
    vi.unstubAllGlobals()
  })

  it('shows immediate feedback while opening a classroom', () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    render(<StudentClassroomsIndex initialClassrooms={classrooms} />)

    const openButton = screen.getByRole('button', { name: /^Math 101/ })
    fireEvent.click(openButton)

    expect(push).toHaveBeenCalledWith('/classrooms/c1?tab=today')
    expect(openButton).toBeDisabled()
    expect(screen.getByText('Opening classroom...')).toBeInTheDocument()
  })

  it('themes the classroom card background without an accent border', () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101', theme_color: 'rose' })]
    render(<StudentClassroomsIndex initialClassrooms={classrooms} />)

    const openButton = screen.getByRole('button', { name: /^Math 101/ })

    expect(openButton).toHaveAttribute('data-classroom-theme-color', 'rose')
    expect(openButton).toHaveClass('classroom-theme-card')
    expect(openButton).toHaveClass('classroom-theme-card-interactive')
    expect(openButton).toHaveClass('border')
    expect(openButton).not.toHaveClass('border-l-4')
  })

  it('shows the semester date range instead of the join code', () => {
    const classrooms = [createMockClassroom({
      id: 'c1',
      title: 'Math 101',
      class_code: 'MATH01',
      start_date: '2025-09-02',
      end_date: '2026-01-30',
    })]
    render(<StudentClassroomsIndex initialClassrooms={classrooms} />)

    expect(screen.getByText('Sept 2025 - Jan 2026')).toBeInTheDocument()
    expect(screen.queryByText(/MATH01/)).not.toBeInTheDocument()
  })

  it('announces an open check-in only on its matching classroom card', async () => {
    const mathId = '20000000-0000-4000-8000-000000000001'
    const scienceId = '20000000-0000-4000-8000-000000000002'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      classrooms: [{
        classroomId: mathId,
        state: 'open',
        opensAt: '2099-08-23T13:00:00.000Z',
        closesAt: '2099-08-23T14:00:00.000Z',
      }],
      nextRefreshAt: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<StudentClassroomsIndex
      initialClassrooms={[
        createMockClassroom({ id: mathId, title: 'Math 101' }),
        createMockClassroom({ id: scienceId, title: 'Science 101' }),
      ]}
      studentId="30000000-0000-4000-8000-000000000001"
    />)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Attendance check-in is open · Scan your teacher’s QR')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-busy', 'false')
    expect(within(screen.getByRole('button', { name: /^Math 101/ })).getByRole('status'))
      .toBe(status)
    expect(within(screen.getByRole('button', { name: /^Science 101/ })).queryByRole('status'))
      .not.toBeInTheDocument()
  })

  it('uses the governed page heading and keyboard-ready mobile actions menu', async () => {
    render(<StudentClassroomsIndex initialClassrooms={[]} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Classrooms' })).toHaveClass(
      'text-2xl',
      'font-semibold',
    )

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })
    fireEvent.click(menuButton)

    const joinItem = within(screen.getByRole('menu')).getByRole('menuitem', {
      name: '+ Join classroom',
    })
    await waitFor(() => expect(joinItem).toHaveFocus())
    expect(joinItem).toHaveClass('min-h-control', 'focus-visible:ring-foundation')
  })
})
