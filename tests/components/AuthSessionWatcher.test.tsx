import { act, render, waitFor, cleanup } from '@testing-library/react'
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
    vi.restoreAllMocks()
    vi.useRealTimers()
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

    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)

    await waitFor(() => {
      expect(redirectToLoginForReauthMock).toHaveBeenCalledWith(undefined, 'session-changed')
    })
  })

  it('redirects with an account-change reason when a same-role session belongs to another user', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse(200, {
      user: { id: 'teacher-2', email: 'other@example.com', role: 'teacher' },
    })))

    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)

    await waitFor(() => {
      expect(redirectToLoginForReauthMock).toHaveBeenCalledWith(undefined, 'session-changed')
    })
  })

  it('keeps the page mounted when the session is valid for the expected role', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockResponse(200, {
      user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
    })))

    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/me', { cache: 'no-store' })
    })
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

  it('keeps the page mounted for authorization and server failures', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => mockResponse(403, { error: 'Forbidden' }))
      .mockImplementationOnce(() => mockResponse(500, { error: 'Internal server error' }))
    vi.stubGlobal('fetch', fetchMock)

    const firstRender = render(
      <AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()

    firstRender.unmount()
    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

  it('pauses hidden checks and coalesces return, focus, and timer without missing a second return', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const fetchMock = vi.fn(() => mockResponse(200, {
      user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" intervalMs={60_000} />)
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('checks again on return after a hidden network failure', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'hidden'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => mockResponse(401, {}))
    vi.stubGlobal('fetch', fetchMock)

    render(<AuthSessionWatcher intervalMs={60_000} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock).not.toHaveBeenCalled()

    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()

    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(redirectToLoginForReauthMock).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh return check while an older request is pending and ignores its late result', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    let finishFirst!: (response: Awaited<ReturnType<typeof mockResponse>>) => void
    const first = new Promise<Awaited<ReturnType<typeof mockResponse>>>(
      (resolve) => { finishFirst = resolve },
    )
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockImplementation(() => mockResponse(200, {
        user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    finishFirst(await mockResponse(401, {}))
    await act(async () => { await Promise.resolve() })
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

})
