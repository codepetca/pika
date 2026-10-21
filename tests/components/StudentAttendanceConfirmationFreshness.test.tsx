import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentAttendanceCheckIn } from '@/app/attendance/check-in/[token]/StudentAttendanceCheckIn'

const client = vi.hoisted(() => ({ read: vi.fn(), preserve: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/student-attendance-client', () => ({
  fetchStudentAttendanceStatus: client.read,
  preserveAuthoritativeStudentAttendanceConfirmation: client.preserve,
  invalidateStudentAttendanceStatus: client.invalidate,
}))
const confirmation = {
  state: 'checked_in', title: 'You are checked in', description: 'Recorded.',
  studentId: '30000000-0000-4000-8000-000000000001',
  classroomId: '20000000-0000-4000-8000-000000000001',
  classroomName: 'P5 - ICS3U', occurrenceBinding: 'a'.repeat(32), attendanceStatus: 'present',
  classDate: '2026-10-19', recordedAt: '2026-10-19T17:31:00.000Z',
  serverNow: '2026-10-19T17:31:01.000Z', validUntil: '2026-10-20T04:00:00.000Z',
}
const statusView = () => ({
  studentId: confirmation.studentId, serverNow: '2026-10-19T17:32:00.000Z', nextRefreshAt: null,
  classrooms: [{ classroomId: confirmation.classroomId, state: 'confirmed',
    classDate: confirmation.classDate, occurrenceBinding: confirmation.occurrenceBinding,
    confirmedAt: confirmation.recordedAt, attendanceStatus: 'present',
    validUntil: confirmation.validUntil, opensAt: null, closesAt: null }],
})
async function mount(mode: 'classroom' | 'occurrence' = 'classroom') {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(confirmation)))
  vi.stubGlobal('fetch', fetcher)
  await act(async () => { render(<StudentAttendanceCheckIn entryToken="synthetic-token" canCheckIn mode={mode} />) })
  return fetcher
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T17:31:01.000Z'))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  client.read.mockResolvedValue(statusView())
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })

describe('student confirmation freshness', () => {
  it('ignores an old membership POST after the page accepts a newer binding for another token', async () => {
    let finishOld!: (value: Response) => void
    const newer = { ...confirmation, occurrenceBinding: 'b'.repeat(32), title: 'You are already checked in', state: 'already_checked_in' }
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(new Response(JSON.stringify(newer))))
    const page = render(<StudentAttendanceCheckIn entryToken="old-token" canCheckIn />)
    await act(async () => { page.rerender(<StudentAttendanceCheckIn entryToken="new-token" canCheckIn />) })
    expect(screen.getByText('You are already checked in')).toBeVisible()
    await act(async () => finishOld(new Response(JSON.stringify(confirmation))))
    expect(screen.getByText('You are already checked in')).toBeVisible()
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(client.preserve).toHaveBeenCalledTimes(1)
    expect(client.preserve).toHaveBeenCalledWith(expect.objectContaining({ occurrenceBinding: newer.occurrenceBinding }))
  })

  it('ignores an older binding read after resume receives a fresh different membership binding', async () => {
    await mount()
    let finishOld!: (value: unknown) => void
    client.read.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve }))
    act(() => { window.dispatchEvent(new Event('focus')) })
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const fresh = statusView()
    fresh.classrooms[0].occurrenceBinding = 'b'.repeat(32)
    client.read.mockResolvedValueOnce(fresh)
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('heading', { name: 'Scan today’s attendance QR' })).toBeVisible()
    await act(async () => finishOld(statusView()))
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scan today’s attendance QR' })).toBeVisible()
    expect(client.read).toHaveBeenCalledTimes(2)
  })

  it('waits for the backend and never shows optimistic success while the POST is pending', async () => {
    let finish!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve })))
    render(<StudentAttendanceCheckIn entryToken="token" canCheckIn />)
    expect(screen.getByRole('heading', { name: 'Checking you in…' })).toBeVisible()
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    await act(async () => finish(new Response(JSON.stringify(confirmation))))
    expect(screen.getByText('You are checked in')).toBeVisible()
    expect(screen.getByText(/Oct 19, 2026/)).toBeVisible()
  })

  it.each(['classroom', 'occurrence'] as const)('clears success at Toronto midnight in %s mode', async (mode) => {
    const fetcher = await mount(mode)
    await act(async () => { await vi.advanceTimersByTimeAsync(Date.parse(confirmation.validUntil) - Date.now()) })
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scan today’s attendance QR' })).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('removes green success on resume until a read-only check confirms the same occurrence', async () => {
    const fetcher = await mount()
    let finish!: (value: unknown) => void
    client.read.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Checking attendance…' })).toBeVisible()
    await act(async () => finish(statusView()))
    expect(screen.getByText('You are checked in')).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(client.read).toHaveBeenCalledWith(confirmation.studentId, { requireServerConfirmation: true })
  })

  it.each(['pageshow', 'visibilitychange'])('rejects an old page after %s without making a new check-in', async (eventName) => {
    const fetcher = await mount()
    client.read.mockResolvedValueOnce({ ...statusView(), serverNow: '2026-10-20T17:31:00.000Z', classrooms: [] })
    await act(async () => {
      if (eventName === 'pageshow') window.dispatchEvent(new Event(eventName))
      else document.dispatchEvent(new Event(eventName))
    })
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed on read failure and retries the read, never the attendance mutation', async () => {
    const fetcher = await mount()
    client.read.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unable to confirm attendance' })).toBeVisible()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check again' })))
    expect(screen.getByText('You are checked in')).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not trust a response from before the page was hidden', async () => {
    await mount()
    let finish!: (value: unknown) => void
    client.read.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    act(() => { window.dispatchEvent(new Event('focus')) })
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => finish(statusView()))
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
  })

  it('uses the server clock when the phone date is wrong', async () => {
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    await mount()
    expect(screen.getByText('You are checked in')).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(Date.parse(confirmation.validUntil) - Date.parse(confirmation.serverNow)) })
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
  })

  it('does not show an old success whose response arrives after its midnight deadline', async () => {
    let finish!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve })))
    render(<StudentAttendanceCheckIn entryToken="token" canCheckIn />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    await act(async () => finish(new Response(JSON.stringify({ ...confirmation,
      serverNow: '2026-10-20T03:59:59.000Z',
    }))))
    expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scan today’s attendance QR' })).toBeVisible()
  })
})
