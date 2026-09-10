import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignupClient } from '@/app/signup/SignupClient'
import VerifySignupPage from '@/app/verify-signup/page'
import CreatePasswordPage from '@/app/create-password/page'
import { AppMessageProvider } from '@/ui'

const { mockPush, mockGet, mockNavigateTo } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockGet: vi.fn(),
  mockNavigateTo: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockGet }),
}))

vi.mock('@/lib/client-navigation', () => ({
  navigateTo: mockNavigateTo,
}))

describe('signup continuation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockPush.mockClear()
    mockGet.mockClear()
    mockNavigateTo.mockClear()
    mockGet.mockReturnValue(null)
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('carries the attendance destination from classic signup to verification', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGet.mockImplementation((key: string) => (
      key === 'next' ? '/attendance/classroom/qr-token' : null
    ))
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<SignupClient />)
    await user.type(screen.getByLabelText(/school email/i), 'student@example.com')
    await user.click(screen.getByRole('button', { name: /send verification code/i }))
    await vi.advanceTimersByTimeAsync(1000)

    expect(mockPush).toHaveBeenCalledWith(
      '/verify-signup?email=student%40example.com&next=%2Fattendance%2Fclassroom%2Fqr-token',
    )
  })

  it('passes the attendance destination into magic-auth signup', async () => {
    mockGet.mockImplementation((key: string) => (
      key === 'next' ? '/attendance/classroom/qr-token' : null
    ))
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    const user = userEvent.setup()

    render(<SignupClient magicAuthEnabled />)
    await user.type(screen.getByLabelText(/school email/i), 'student@example.com')
    await user.click(screen.getByRole('button', { name: /email me a sign-in code/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/workos/magic/start',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'student@example.com',
          intent: 'sign-up',
          next: '/attendance/classroom/qr-token',
        }),
      }),
    ))
  })

  it('carries the attendance destination from verification to password creation', async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'email') return 'student@example.com'
      if (key === 'next') return '/attendance/classroom/qr-token'
      return null
    })
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ handoffToken: 'handoff-token' }),
    })
    const user = userEvent.setup()

    render(
      <AppMessageProvider>
        <VerifySignupPage />
      </AppMessageProvider>,
    )
    await user.type(screen.getByLabelText(/verification code/i), 'A7Q2F')
    await user.click(screen.getByRole('button', { name: /verify email/i }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(
      '/create-password?email=student%40example.com&next=%2Fattendance%2Fclassroom%2Fqr-token',
    ))
  })

  it('returns to attendance after classic account creation', async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'email') return 'student@example.com'
      if (key === 'next') return '/attendance/classroom/qr-token'
      return null
    })
    window.sessionStorage.setItem(
      'pika.signupHandoffToken',
      JSON.stringify({ email: 'student@example.com', token: 'handoff-token' }),
    )
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/classrooms' }),
    })
    const user = userEvent.setup()

    render(<CreatePasswordPage />)
    await user.type(screen.getByPlaceholderText('At least 8 characters'), 'password123')
    await user.type(screen.getByPlaceholderText('Re-enter your password'), 'password123')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mockNavigateTo).toHaveBeenCalledWith(
      '/attendance/classroom/qr-token',
    ))
  })

  it('falls back to the server destination when the continuation is unsafe', async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'email') return 'student@example.com'
      if (key === 'next') return '//evil.example/steal'
      return null
    })
    window.sessionStorage.setItem(
      'pika.signupHandoffToken',
      JSON.stringify({ email: 'student@example.com', token: 'handoff-token' }),
    )
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/classrooms' }),
    })
    const user = userEvent.setup()

    render(<CreatePasswordPage />)
    await user.type(screen.getByPlaceholderText('At least 8 characters'), 'password123')
    await user.type(screen.getByPlaceholderText('Re-enter your password'), 'password123')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mockNavigateTo).toHaveBeenCalledWith('/classrooms'))
  })
})
