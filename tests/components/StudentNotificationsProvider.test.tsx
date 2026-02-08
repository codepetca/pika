import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { StudentNotificationsProvider } from '@/components/StudentNotificationsProvider'

function notificationFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]: [string]) => typeof url === 'string' && url.includes('/api/student/notifications')
  )
}

describe('StudentNotificationsProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  function mockNotificationsResponse() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hasTodayEntry: true,
        unviewedAssignmentsCount: 0,
        activeQuizzesCount: 0,
        unreadAnnouncementsCount: 0,
      }),
    })
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches notifications once on mount', async () => {
    mockNotificationsResponse()
    render(
      <StudentNotificationsProvider classroomId="c1">
        <div />
      </StudentNotificationsProvider>
    )

    await waitFor(() => {
      expect(notificationFetchCalls(fetchMock)).toHaveLength(1)
    })
  })

  it('fetches on first focus event after mount', async () => {
    mockNotificationsResponse()
    render(
      <StudentNotificationsProvider classroomId="c1">
        <div />
      </StudentNotificationsProvider>
    )

    await waitFor(() => {
      expect(notificationFetchCalls(fetchMock)).toHaveLength(1)
    })

    // Wait for cooldown from mount fetch to expire
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    mockNotificationsResponse()

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(notificationFetchCalls(fetchMock)).toHaveLength(2)
    })
  })

  it('does not refetch on rapid focus events within cooldown (#303)', async () => {
    mockNotificationsResponse()
    render(
      <StudentNotificationsProvider classroomId="c1">
        <div />
      </StudentNotificationsProvider>
    )

    await waitFor(() => {
      expect(notificationFetchCalls(fetchMock)).toHaveLength(1)
    })

    // Focus immediately (within 30s cooldown) — should be skipped
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(notificationFetchCalls(fetchMock)).toHaveLength(1)

    // Focus again — still within cooldown
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(notificationFetchCalls(fetchMock)).toHaveLength(1)
  })
})
