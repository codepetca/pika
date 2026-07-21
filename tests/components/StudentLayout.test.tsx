import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentLayout from '@/app/student/layout'
import { getCurrentUser } from '@/lib/auth'

let pathname = '/student/history'

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

describe('StudentLayout', () => {
  beforeEach(() => {
    pathname = '/student/history'
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'student-1',
      email: 'student1@example.com',
      role: 'student',
    })
  })

  it('uses the canonical app shell and preserves the existing student utility destinations', async () => {
    render(await StudentLayout({ children: <p>Student content</p> }))

    expect(screen.getByRole('banner')).toHaveTextContent('Application header')
    expect(screen.getByTestId('session-role')).toHaveTextContent('student')
    expect(screen.getByRole('navigation', { name: 'Student tools' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Classrooms' })).toHaveAttribute('href', '/classrooms')
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/student/history')
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('main')).toHaveClass('max-w-4xl', 'mx-auto', 'px-4', 'py-8')
    expect(screen.getByRole('main')).toHaveTextContent('Student content')
  })
})
