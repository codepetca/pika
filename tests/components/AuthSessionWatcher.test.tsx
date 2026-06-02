import { render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthSessionWatcher } from '@/components/AuthSessionWatcher'

const redirectToLoginForReauthMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client-auth')>()
  return {
    ...actual,
    redirectToLoginForReauth: redirectToLoginForReauthMock,
  }
})

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as any
}

describe('AuthSessionWatcher', () => {
  beforeEach(() => {
    redirectToLoginForReauthMock.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('redirects when the session endpoint reports unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse(401, { error: 'Not authenticated' })))

    render(<AuthSessionWatcher />)

    await waitFor(() => {
      expect(redirectToLoginForReauthMock).toHaveBeenCalled()
    })
  })

  it('redirects when the active session role does not match the page role', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse(200, {
      user: { id: 'student-1', email: 'student@example.com', role: 'student' },
    })))

    render(<AuthSessionWatcher expectedRole="teacher" />)

    await waitFor(() => {
      expect(redirectToLoginForReauthMock).toHaveBeenCalled()
    })
  })

  it('keeps the page mounted when the session is valid for the expected role', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse(200, {
      user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
    })))

    render(<AuthSessionWatcher expectedRole="teacher" />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/me', { cache: 'no-store' })
    })
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

  it('keeps the page mounted when the session endpoint has a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse(500, { error: 'Internal server error' })))

    render(<AuthSessionWatcher expectedRole="teacher" />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/me', { cache: 'no-store' })
    })
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })
})
