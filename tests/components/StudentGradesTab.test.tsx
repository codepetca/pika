import type { ReactElement } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentGradesTab } from '@/app/classrooms/[classroomId]/StudentGradesTab'
import { ApiError } from '@/lib/api-error'
import { fetchJSONWithCache, invalidateCachedJSON, prefetchJSON } from '@/lib/request-cache'
import type { StudentGradesResponse } from '@/lib/student-grades'
import { AppMessageProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

function renderGrades(element: ReactElement) {
  return render(element, { wrapper: AppMessageProvider })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function response(data: StudentGradesResponse) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const returnedGrades: StudentGradesResponse = {
  currentPercent: 84,
  items: [
    { id: 'a', kind: 'Classwork', title: 'Essay', earned: 8, possible: 10, percent: 80, included: true, href: '/essay' },
    { id: 'p', kind: 'Gradebook item', title: 'Practice', earned: 0, possible: 10, percent: 0, included: false, href: null },
  ],
}
const emptyGrades: StudentGradesResponse = { currentPercent: null, items: [] }

describe('StudentGradesTab', () => {
  const classroom = createMockClassroom()
  const anotherClassroom = { ...classroom, id: 'another-classroom' }
  const cacheKey = `student-grades:${classroom.id}`
  let fetchMock: ReturnType<typeof vi.fn>
  let now: number

  beforeEach(() => {
    invalidateCachedJSON(cacheKey)
    invalidateCachedJSON(`student-grades:${anotherClassroom.id}`)
    invalidateCachedJSON('student-materials:unrelated')
    now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    invalidateCachedJSON(cacheKey)
    invalidateCachedJSON(`student-grades:${anotherClassroom.id}`)
    invalidateCachedJSON('student-materials:unrelated')
  })

  async function settleRead(read: ReturnType<typeof deferred<Response>>, result: Response) {
    await act(async () => { read.resolve(result) })
  }

  async function mountReturnedGrades() {
    fetchMock.mockResolvedValueOnce(response(returnedGrades))
    const rendered = renderGrades(<StudentGradesTab classroom={classroom} />)
    await screen.findByText('84%')
    return rendered
  }

  it('shows only the server projection, including zero and Not counted', async () => {
    await mountReturnedGrades()
    expect(screen.getByRole('link', { name: /Essay/ })).toHaveAttribute('href', '/essay')
    expect(screen.getByText('Practice')).toBeVisible()
    expect(screen.getByText('Not counted')).toBeVisible()
    expect(screen.getByText('0%')).toBeVisible()
    expect(screen.queryByRole('link', { name: /Practice/ })).not.toBeInTheDocument()
  })

  it('distinguishes cold loading, successful empty, and failed reads', async () => {
    const read = deferred<Response>()
    fetchMock.mockReturnValueOnce(read.promise)
    const { rerender } = renderGrades(<StudentGradesTab classroom={classroom} />)
    expect(screen.getByText('Loading grades')).toBeVisible()
    expect(screen.queryByText('No grades yet')).not.toBeInTheDocument()
    await settleRead(read, response(emptyGrades))
    expect(screen.getByText('No grades yet')).toBeVisible()
    expect(screen.getByText('—')).toBeVisible()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Grades are unavailable' }), { status: 503 }))
    rerender(<StudentGradesTab classroom={anotherClassroom} />)
    expect(await screen.findByText('Grades unavailable')).toBeVisible()
    expect(screen.getByText('Grades are unavailable')).toBeVisible()
    expect(screen.queryByText('No grades yet')).not.toBeInTheDocument()
  })

  it('does not fetch until initially inactive Grades becomes active', async () => {
    fetchMock.mockResolvedValueOnce(response(emptyGrades))
    const { rerender } = renderGrades(<StudentGradesTab classroom={classroom} isActive={false} />)
    expect(fetchMock).not.toHaveBeenCalled()
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(await screen.findByText('No grades yet')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retains row identity on deactivation and a real cache hit within 30 seconds', async () => {
    const { rerender } = await mountReturnedGrades()
    const essay = screen.getByRole('link', { name: /Essay/ })
    essay.focus()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    now += 29_999
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    await waitFor(() => expect(screen.queryByText(/Refreshing grades/)).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    expect(essay).toHaveFocus()
    expect(focus).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps rows while an expired cache read refreshes, then reconciles exact new data', async () => {
    const { rerender } = await mountReturnedGrades()
    const essay = screen.getByRole('link', { name: /Essay/ })
    const read = deferred<Response>()
    fetchMock.mockReturnValueOnce(read.promise)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(await screen.findByText(/Refreshing grades/)).toBeVisible()
    expect(screen.queryByText('Loading grades')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    await settleRead(read, response({ currentPercent: 90, items: [{ ...returnedGrades.items[0], earned: 9, percent: 90 }] }))
    expect(screen.getByText('90%', { selector: 'p.text-3xl' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    expect(screen.queryByText('Practice')).not.toBeInTheDocument()
    expect(screen.queryByText(/Refreshing grades/)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reconciles a successful empty refresh instead of retaining removed marks', async () => {
    const { rerender } = await mountReturnedGrades()
    fetchMock.mockResolvedValueOnce(response(emptyGrades))
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(await screen.findByText('No grades yet')).toBeVisible()
    expect(screen.queryByText('Essay')).not.toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['network', 'server'])('preserves current rows after a recoverable %s failure and offers bounded focused Retry', async (failure) => {
    const { rerender } = await mountReturnedGrades()
    const essay = screen.getByRole('link', { name: /Essay/ })
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new TypeError('Offline'))
    else fetchMock.mockResolvedValueOnce(new Response('Temporary outage', { status: 503 }))
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(await screen.findByText('Grades could not be refreshed. Showing the last returned grades.')).toBeVisible()
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    const read = deferred<Response>()
    fetchMock.mockReturnValueOnce(read.promise)
    const retry = screen.getByRole('button', { name: 'Retry' })
    const region = screen.getByRole('region', { name: 'Grades' })
    retry.focus()
    const focus = vi.spyOn(region, 'focus').mockImplementation((options) => {
      expect(retry).toBeInTheDocument()
      HTMLElement.prototype.focus.call(region, options)
    })
    act(() => {
      retry.click()
      retry.click()
    })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(region).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await settleRead(read, response(emptyGrades))
    expect(region).toHaveFocus()
    expect(screen.getByText('No grades yet')).toBeVisible()
  })

  it('hands cold Retry focus to the stable work region and invalidates only its own key', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Offline'))
    renderGrades(<StudentGradesTab classroom={classroom} />)
    const retry = await screen.findByRole('button', { name: 'Retry' })
    // A successful prefetch lands after the failed tab read. Explicit Retry must bypass it.
    await fetchJSONWithCache(cacheKey, async () => returnedGrades, 30_000)
    const unrelated = vi.fn(async () => ({ marker: 'keep' }))
    await fetchJSONWithCache('student-materials:unrelated', unrelated, 30_000)
    const read = deferred<Response>()
    fetchMock.mockReturnValueOnce(read.promise)
    const region = screen.getByRole('region', { name: 'Grades' })
    retry.focus()
    const focus = vi.spyOn(region, 'focus').mockImplementation((options) => {
      expect(retry).toBeInTheDocument()
      HTMLElement.prototype.focus.call(region, options)
    })
    act(() => {
      retry.click()
      retry.click()
    })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(region).toHaveFocus()
    expect(screen.getByText('Loading grades')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await fetchJSONWithCache('student-materials:unrelated', unrelated, 30_000)
    expect(unrelated).toHaveBeenCalledTimes(1)
    await settleRead(read, response(returnedGrades))
    expect(region).toHaveFocus()
    expect(screen.getByText('84%')).toBeVisible()
  })

  it('deduplicates a real pending prefetch on activation and finishes while inactive', async () => {
    const read = deferred<Response>()
    fetchMock.mockReturnValueOnce(read.promise)
    prefetchJSON(cacheKey, async () => (await fetch('/prefetch-grades')).json(), 30_000)
    const { rerender } = renderGrades(<StudentGradesTab classroom={classroom} />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    await settleRead(read, response(returnedGrades))
    expect(screen.getByText('84%')).toBeVisible()
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    await waitFor(() => expect(screen.queryByText(/Refreshing grades/)).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows a warm read to finish inactive and deduplicates return during that pending read', async () => {
    const { rerender } = await mountReturnedGrades()
    const essay = screen.getByRole('link', { name: /Essay/ })
    const read = deferred<Response>()
    fetchMock.mockReturnValueOnce(read.promise)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('link', { name: /Essay/ })).toBe(essay)
    expect(await screen.findByText(/Refreshing grades/)).toBeVisible()
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    expect(screen.queryByText(/Refreshing grades/)).not.toBeInTheDocument()
    await settleRead(read, response(emptyGrades))
    expect(screen.getByText('No grades yet')).toBeVisible()
    expect(screen.queryByText(/Refreshing grades/)).not.toBeInTheDocument()
  })

  it.each([401, 403, 404])('clears a warm snapshot on authoritative HTTP %s, including non-JSON bodies', async (status) => {
    const { rerender } = await mountReturnedGrades()
    fetchMock.mockResolvedValueOnce(new Response('Access unavailable', { status }))
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(await screen.findByText('Grades unavailable')).toBeVisible()
    expect(screen.queryByText('Essay')).not.toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing the last returned grades/)).not.toBeInTheDocument()
  })

  it('clears a retained inactive snapshot when a shared prefetch promise rejects with authoritative status', async () => {
    const { rerender } = await mountReturnedGrades()
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    const read = deferred<StudentGradesResponse>()
    // The actual shell HTTP boundary is verified separately by the native fixture.
    prefetchJSON(cacheKey, () => read.promise, 30_000)
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    await act(async () => { read.reject(new ApiError(403, 'Grades unavailable')) })
    expect(screen.getByText('Grades unavailable', { selector: 'h2' })).toBeVisible()
    expect(screen.queryByText('Essay')).not.toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()
  })

  it.each(['success', 'rejection'])('retires old-owner %s and finally while the new owner is pending', async (outcome) => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { rerender } = renderGrades(<StudentGradesTab classroom={classroom} />)
    rerender(<StudentGradesTab classroom={anotherClassroom} />)
    await act(async () => {
      if (outcome === 'success') first.resolve(response(returnedGrades))
      else first.reject(new Error('Old failure'))
    })
    expect(screen.getByText('Loading grades')).toBeVisible()
    expect(screen.queryByText('Essay')).not.toBeInTheDocument()
    expect(screen.queryByText('Old failure')).not.toBeInTheDocument()
    await settleRead(second, response(emptyGrades))
    expect(screen.getByText('No grades yet')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('immediately removes the old snapshot on classroom switch, including an inactive new owner', async () => {
    const { rerender } = await mountReturnedGrades()
    rerender(<StudentGradesTab classroom={anotherClassroom} isActive={false} />)
    expect(screen.queryByText('Essay')).not.toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(response(emptyGrades))
    rerender(<StudentGradesTab classroom={anotherClassroom} isActive />)
    expect(await screen.findByText('No grades yet')).toBeVisible()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/student/classrooms/another-classroom/grades')
  })

  it.each(['success', 'rejection'])('retires same-owner obsolete %s and finally after a newer read', async (outcome) => {
    const { rerender } = await mountReturnedGrades()
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    now += 30_000
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    rerender(<StudentGradesTab classroom={classroom} isActive={false} />)
    invalidateCachedJSON(cacheKey)
    rerender(<StudentGradesTab classroom={classroom} isActive />)
    await act(async () => {
      if (outcome === 'success') first.resolve(response(emptyGrades))
      else first.reject(new ApiError(403, 'Obsolete denial'))
    })
    expect(await screen.findByText(/Refreshing grades/)).toBeVisible()
    expect(screen.getByText('Essay')).toBeVisible()
    expect(screen.queryByText('No grades yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await settleRead(second, response(emptyGrades))
    expect(screen.getByText('No grades yet')).toBeVisible()
    expect(screen.queryByText(/Refreshing grades/)).not.toBeInTheDocument()
  })

  it.each(['success', 'rejection'])('retires an unmounted read %s without disturbing a new mount', async (outcome) => {
    const oldRead = deferred<Response>()
    fetchMock.mockReturnValueOnce(oldRead.promise)
    const { unmount } = renderGrades(<StudentGradesTab classroom={classroom} />)
    unmount()
    fetchMock.mockResolvedValueOnce(response(emptyGrades))
    renderGrades(<StudentGradesTab classroom={anotherClassroom} />)
    await screen.findByText('No grades yet')
    await act(async () => {
      if (outcome === 'success') oldRead.resolve(response(returnedGrades))
      else oldRead.reject(new Error('Retired failure'))
    })
    expect(screen.getByText('No grades yet')).toBeVisible()
    expect(screen.queryByText('Essay')).not.toBeInTheDocument()
    expect(screen.queryByText('Retired failure')).not.toBeInTheDocument()
  })
})
