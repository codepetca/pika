import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentGradesTab } from '@/app/classrooms/[classroomId]/StudentGradesTab'
import { createMockClassroom } from '../helpers/mocks'

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
}))

describe('StudentGradesTab', () => {
  const classroom = createMockClassroom()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the current grade and only the server-projected returned items', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        currentPercent: 84,
        items: [
          { id: 'a', kind: 'Classwork', title: 'Essay', earned: 8, possible: 10, percent: 80, included: true, href: '/essay' },
          { id: 'p', kind: 'Gradebook item', title: 'Practice', earned: 5, possible: 10, percent: 50, included: false, href: null },
        ],
      }),
    })

    render(<StudentGradesTab classroom={classroom} />)

    expect(await screen.findByText('84%')).toBeVisible()
    expect(screen.getByRole('link', { name: /Essay/ })).toHaveAttribute('href', '/essay')
    expect(screen.getByText('Practice')).toBeVisible()
    expect(screen.getByText('Not counted')).toBeVisible()
  })

  it('distinguishes an empty returned set from a failed request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ currentPercent: null, items: [] }) })
    const { unmount } = render(<StudentGradesTab classroom={classroom} />)
    expect(await screen.findByText('No returned grades yet')).toBeVisible()
    expect(screen.getByText('—')).toBeVisible()
    unmount()

    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Grades are unavailable' }) })
    render(<StudentGradesTab classroom={{ ...classroom, id: 'another-classroom' }} />)
    await waitFor(() => expect(screen.getByText('Grades unavailable')).toBeVisible())
    expect(screen.getByText('Grades are unavailable')).toBeVisible()
  })

  it('does not fetch until its tab is active', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ currentPercent: null, items: [] }) })
    const { rerender } = render(<StudentGradesTab classroom={classroom} isActive={false} />)
    expect(fetchMock).not.toHaveBeenCalled()
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
