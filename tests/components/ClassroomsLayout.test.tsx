import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetCurrentUser,
  mockGetPalApiUrl,
} = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPalApiUrl: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/server/pal-config', () => ({
  getPalApiUrl: mockGetPalApiUrl,
}))
vi.mock('@/integrations/pal', () => ({
  StudentPalExperience: ({ apiBaseUrl, children, scopeKey }: {
    apiBaseUrl: string
    children: React.ReactNode
    scopeKey: string
  }) => (
    <div data-testid="student-pal-shell" data-api-base-url={apiBaseUrl} data-scope-key={scopeKey}>
      {children}
    </div>
  ),
}))

import ClassroomsLayout from '@/app/classrooms/layout'

describe('authenticated classrooms Pal shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPalApiUrl.mockReturnValue('https://pal.example.test')
  })

  it('mounts one learner-scoped provider around the student route family', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'student-raw-id',
      email: 'student@example.test',
      role: 'student',
    })

    render(await ClassroomsLayout({ children: <div>Student work</div> }))

    const shell = screen.getByTestId('student-pal-shell')
    expect(shell).toHaveAttribute('data-api-base-url', 'https://pal.example.test')
    expect(shell.getAttribute('data-scope-key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(shell.getAttribute('data-scope-key')).not.toContain('student-raw-id')
    expect(screen.getByText('Student work')).toBeVisible()
  })

  it.each([
    ['student', false],
    ['teacher', true],
  ] as const)('does not mount Pal for a %s when configured is %s', async (role, configured) => {
    mockGetCurrentUser.mockResolvedValue({
      id: `${role}-id`,
      email: `${role}@example.test`,
      role,
    })
    mockGetPalApiUrl.mockReturnValue(configured ? 'https://pal.example.test' : null)

    render(await ClassroomsLayout({ children: <div>Academic shell</div> }))

    expect(screen.queryByTestId('student-pal-shell')).toBeNull()
    expect(screen.getByText('Academic shell')).toBeVisible()
    expect(mockGetPalApiUrl).toHaveBeenCalledTimes(role === 'student' ? 1 : 0)
  })
})
