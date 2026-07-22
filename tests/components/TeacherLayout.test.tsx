import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TeacherLayout from '@/app/teacher/layout'
import { getCurrentUser } from '@/lib/auth'

let pathname = '/teacher/calendar'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => pathname,
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/components/AppHeader', () => ({
  AppHeader: () => <header>Application header</header>,
}))

vi.mock('@/components/AuthSessionWatcher', () => ({
  AuthSessionWatcher: ({ expectedRole }: { expectedRole: string }) => (
    <span data-testid="session-role">{expectedRole}</span>
  ),
}))

describe('TeacherLayout', () => {
  beforeEach(() => {
    pathname = '/teacher/calendar'
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'teacher-1',
      email: 'teacher@example.com',
      role: 'teacher',
    })
  })

  it('uses the canonical app shell and preserves the existing teacher utility destinations', async () => {
    render(await TeacherLayout({ children: <p>Teacher content</p> }))

    expect(screen.getByRole('banner')).toHaveTextContent('Application header')
    expect(screen.getByTestId('session-role')).toHaveTextContent('teacher')
    expect(screen.getByRole('navigation', { name: 'Teacher tools' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Classrooms' })).toHaveAttribute('href', '/classrooms')
    expect(screen.getByRole('link', { name: 'Blueprints' })).toHaveAttribute('href', '/teacher/blueprints')
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/teacher/calendar')
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('main')).toHaveClass('max-w-7xl', 'mx-auto', 'px-4', 'pt-0', 'pb-8')
    expect(screen.getByRole('main')).toHaveTextContent('Teacher content')
  })
})
