import { render, screen, cleanup } from '@testing-library/react'
import { AppMessageProvider, AppMessageFallback } from '@/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  hasPending: vi.fn(),
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
vi.mock('@/app/signup/SignupClient', () => ({
  SignupClient: () => null,
}))

import SignupPage from '@/app/signup/page'

afterEach(cleanup)

describe('SignupPage pending challenge continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.hasPending.mockResolvedValue(false)
  })

  it('uses existing visible loading status while Signup suspends', async () => {
    const page = await SignupPage({ searchParams: Promise.resolve({}) })
    expect(page.props.fallback.type).toBe(AppMessageFallback)
    render(<AppMessageProvider>{page.props.fallback}</AppMessageProvider>)
    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
  })

  it('resumes only a signup challenge bound to the scanned attendance path', async () => {
    const nextPath = '/attendance/classroom/classroom-b'

    await SignupPage({ searchParams: Promise.resolve({ next: nextPath }) })

    expect(mocks.hasPending).toHaveBeenCalledWith('sign-up', expect.any(Number), nextPath)
  })

  it('uses the safe classrooms fallback for an unsafe continuation', async () => {
    await SignupPage({
      searchParams: Promise.resolve({ next: '//evil.example/steal' }),
    })

    expect(mocks.hasPending).toHaveBeenCalledWith(
      'sign-up',
      expect.any(Number),
      '/classrooms',
    )
  })
})
