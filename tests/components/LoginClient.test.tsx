import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginClient } from '@/app/login/LoginClient'
import { SESSION_CHANGED_MESSAGE, SESSION_EXPIRED_MESSAGE } from '@/lib/client-auth'

const { mockPush, mockRefresh, mockGet, mockNavigateTo } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockGet: vi.fn(),
  mockNavigateTo: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({ get: mockGet }),
}))

vi.mock('@/lib/client-navigation', () => ({
  navigateTo: mockNavigateTo,
}))

async function submitLogin(user: ReturnType<typeof userEvent.setup>, email = 'test@example.com', password = 'password123') {
  await user.type(screen.getByLabelText(/school email/i), email)
  await user.type(screen.getByLabelText(/password/i), password)
  await user.click(screen.getByRole('button', { name: /login/i }))
}

describe('LoginClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockPush.mockClear()
    mockRefresh.mockClear()
    mockGet.mockClear()
    mockNavigateTo.mockClear()
    mockGet.mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    cleanup()
  })

  it('presents the magic-code login as Pika Classroom without redundant instructions', () => {
    render(<LoginClient magicAuthEnabled />)

    expect(screen.getByRole('heading', { name: 'Pika Classroom' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Pika' })).not.toBeInTheDocument()
    expect(screen.getByText('School days, simplified.')).toBeInTheDocument()
    expect(screen.queryByText(/enter your school email/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/school email/i)).toBeRequired()
    expect(screen.getByText('School Email')).not.toHaveTextContent('*')
    expect(screen.getByRole('button', { name: /email me a sign-in code/i })).toBeInTheDocument()
  })

  it('uses a full document navigation after successful login', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/dashboard' }),
    })

    const user = userEvent.setup()
    render(<LoginClient />)
    await submitLogin(user)

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalledWith('/dashboard')
    })
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('navigates to redirectUrl on success', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/teacher/classrooms' }),
    })

    const user = userEvent.setup()
    render(<LoginClient />)
    await submitLogin(user)

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalledWith('/teacher/classrooms')
    })
  })

  it('navigates to ?next= param when it is a safe path', async () => {
    mockGet.mockReturnValue('/student/assignments')
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/dashboard' }),
    })

    const user = userEvent.setup()
    render(<LoginClient />)
    await submitLogin(user)

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalledWith('/student/assignments')
    })
  })

  it.each([
    '//evil.com',
    '/\\evil.example',
    '/%5Cevil.example',
    '/a/..//evil.example',
    '/%2e%2e//evil.example',
  ])(
    'rejects unsafe ?next= path %s and uses redirectUrl instead',
    async (unsafePath) => {
      mockGet.mockReturnValue(unsafePath)
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redirectUrl: '/dashboard' }),
      })

      const user = userEvent.setup()
      render(<LoginClient />)
      await submitLogin(user)

      await waitFor(() => {
        expect(mockNavigateTo).toHaveBeenCalledWith('/dashboard')
      })
    },
  )

  it('announces an account change without calling it an expired session', () => {
    mockGet.mockImplementation((key: string) => (
      key === 'reason' ? 'session-changed' : '/teacher/calendar'
    ))

    render(<LoginClient />)

    expect(screen.getByRole('status')).toHaveTextContent(SESSION_CHANGED_MESSAGE)
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/school email/i)).toHaveFocus()
  })

  it('ignores unknown recovery reasons', () => {
    mockGet.mockImplementation((key: string) => (
      key === 'reason' ? 'unknown' : '/teacher/calendar'
    ))

    render(<LoginClient />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/school email/i)).not.toHaveAttribute('aria-describedby')
  })

  it('uses the server redirect when no safe next path is available', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/dashboard' }),
    })

    const user = userEvent.setup()
    render(<LoginClient />)
    await submitLogin(user)

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('announces session expiry and focuses the email field', () => {
    mockGet.mockImplementation((key: string) => (
      key === 'reason' ? 'session-expired' : '/teacher/calendar'
    ))

    render(<LoginClient />)

    const message = screen.getByRole('status')
    const email = screen.getByLabelText(/school email/i)
    expect(message).toHaveTextContent(SESSION_EXPIRED_MESSAGE)
    expect(email).toHaveFocus()
    expect(email).toHaveAttribute('aria-describedby', message.id)
  })

  it('silently restores a linked Pika session from an active WorkOS session', async () => {
    mockGet.mockImplementation((key: string) => (
      key === 'next' ? '/teacher/calendar?view=month' : null
    ))
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: '/teacher/calendar?view=month' }),
    })

    render(<LoginClient magicAuthEnabled hasActiveWorkOSSession />)

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/workos/session/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ next: '/teacher/calendar?view=month' }),
      }),
    ))
    await waitFor(() => expect(mockNavigateTo).toHaveBeenCalledWith('/teacher/calendar?view=month'))
  })

  it('falls back to the code form when silent WorkOS restoration fails', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Account identity conflict' }),
    })

    render(<LoginClient magicAuthEnabled hasActiveWorkOSSession />)

    expect(await screen.findByRole('button', { name: /email me a sign-in code/i })).toBeInTheDocument()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('displays error message on failed login', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid credentials' }),
    })

    const user = userEvent.setup()
    render(<LoginClient />)
    await submitLogin(user)

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('shows loading state during submission', async () => {
    let resolveLogin: (value: any) => void
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveLogin = resolve }))

    const user = userEvent.setup()
    render(<LoginClient />)
    await submitLogin(user)

    expect(screen.getByText('Logging in...')).toBeInTheDocument()

    resolveLogin!({
      ok: true,
      json: async () => ({ redirectUrl: '/dashboard' }),
    })

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalled()
    })
  })
})
