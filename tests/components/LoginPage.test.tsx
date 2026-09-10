import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  hasPending: vi.fn(),
  withAuth: vi.fn(),
}))

vi.mock('@/lib/server/workos-pilot', () => ({
  isWorkOSMagicAuthPilotEnabled: mocks.enabled,
  safePikaPath: (value: unknown, fallback = '/classrooms') => (
    typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
      ? value
      : fallback
  ),
}))
vi.mock('@/lib/server/workos-magic-pending', () => ({
  hasActivePendingWorkOSMagicAuth: mocks.hasPending,
}))
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: mocks.withAuth,
}))
vi.mock('@/app/login/LoginClient', () => ({
  LoginClient: () => null,
}))

import LoginPage from '@/app/login/page'

describe('LoginPage pending challenge continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.hasPending.mockResolvedValue(false)
    mocks.withAuth.mockResolvedValue({ user: null })
  })

  it('resumes only a sign-in challenge bound to the scanned attendance path', async () => {
    const nextPath = '/attendance/classroom/classroom-b'

    await LoginPage({ searchParams: Promise.resolve({ next: nextPath }) })

    expect(mocks.hasPending).toHaveBeenCalledWith('sign-in', expect.any(Number), nextPath)
  })

  it('uses the safe classrooms fallback for an unsafe continuation', async () => {
    await LoginPage({
      searchParams: Promise.resolve({ next: '//evil.example/steal' }),
    })

    expect(mocks.hasPending).toHaveBeenCalledWith(
      'sign-in',
      expect.any(Number),
      '/classrooms',
    )
  })
})
