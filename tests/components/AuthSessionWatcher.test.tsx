import { act, render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthSessionWatcher } from '@/components/AuthSessionWatcher'
import { fetchTeacherClassrooms, invalidateTeacherClassrooms } from '@/lib/teacher-classrooms-client'

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
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    invalidateTeacherClassrooms()
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

  it('keeps the default 60-second cadence while visible and focused', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('pauses checks in a visible unfocused window and validates immediately on focus', async () => {
    vi.useFakeTimers()
    let focused = true
    vi.mocked(document.hasFocus).mockImplementation(() => focused)
    const fetchMock = vi.fn(() => mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    await act(async () => { await Promise.resolve() })

    focused = false
    act(() => { window.dispatchEvent(new Event('blur')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The focus event itself authorizes the immediate check even if hasFocus
    // has not caught up yet in the browser.
    act(() => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/me', { cache: 'no-store' })
  })

  it('waits for focus when mounted in a visible unfocused window', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false)
    const fetchMock = vi.fn(() => mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    expect(fetchMock).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: 401, body: {}, reason: undefined },
    { status: 200, body: { user: { id: 'teacher-2', role: 'teacher' } }, reason: 'session-changed' },
  ])('validates the resumed session after blur (status $status)', async ({ status, body, reason }) => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } }))
      .mockImplementation(() => mockResponse(status, body))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    await act(async () => { await Promise.resolve() })
    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    if (reason) {
      expect(redirectToLoginForReauthMock).toHaveBeenCalledWith(undefined, reason)
    } else {
      expect(redirectToLoginForReauthMock).toHaveBeenCalledWith()
    }
  })

  it('ignores a late pre-blur response while a fresh focus check runs', async () => {
    let finishFirst!: (response: Awaited<ReturnType<typeof mockResponse>>) => void
    const first = new Promise<Awaited<ReturnType<typeof mockResponse>>>(
      (resolve) => { finishFirst = resolve },
    )
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockImplementation(() => mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    finishFirst(await mockResponse(401, {}))
    await act(async () => { await Promise.resolve() })
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

  it('keeps watcher checks independent of a pending list identity batch', async () => {
    let finishIdentity!: (response: Response) => void
    const listIdentity = new Promise<Response>((resolve) => { finishIdentity = resolve })
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me') {
        return mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } })
      }
      return mockResponse(200, { classrooms: [] })
    }).mockReturnValueOnce(listIdentity)
    vi.stubGlobal('fetch', fetchMock)

    const list = fetchTeacherClassrooms()
    const view = render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    view.unmount()
    finishIdentity(await mockResponse(200, { user: { id: 'teacher-1', role: 'teacher' } }))
    await expect(list).resolves.toEqual([])
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

  it('ignores the previous expected actor response after switching the mounted actor', async () => {
    let finishFirst!: (response: Awaited<ReturnType<typeof mockResponse>>) => void
    const first = new Promise<Awaited<ReturnType<typeof mockResponse>>>(
      (resolve) => { finishFirst = resolve },
    )
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockImplementation(() => mockResponse(200, { user: { id: 'teacher-2', role: 'teacher' } }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<AuthSessionWatcher expectedUserId="teacher-1" expectedRole="teacher" />)
    view.rerender(<AuthSessionWatcher expectedUserId="teacher-2" expectedRole="teacher" />)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    finishFirst(await mockResponse(401, {}))
    await act(async () => { await Promise.resolve() })
    expect(redirectToLoginForReauthMock).not.toHaveBeenCalled()
  })

})
