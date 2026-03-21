import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginClient } from '@/app/login/LoginClient'

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

  it('rejects unsafe ?next= paths and uses redirectUrl instead', async () => {
    mockGet.mockReturnValue('//evil.com')
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
