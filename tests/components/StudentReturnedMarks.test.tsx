import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentReturnedMarks } from '@/components/gradebook/StudentReturnedMarks'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

const mark = { id: 'mark-1', title: 'Attendance – Term 1', earned: 0, possible: 10, percent: 0, categoryName: 'Term Work', included: true }
const response = (items = [mark]) => ({ ok: true, json: async () => ({ items }) })

beforeEach(() => {
  invalidateCachedJSONMatching('student-returned-marks:')
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('StudentReturnedMarks', () => {
  it('shows returned scores including zero and exclusions without fake assignment links', async () => {
    vi.mocked(fetch).mockResolvedValue(response([mark, { ...mark, id: 'mark-2', title: 'Practice', earned: 8, percent: 80, included: false }]) as Response)
    render(<StudentReturnedMarks classroomId="class-1" />)
    expect(await screen.findByText('Attendance – Term 1')).toBeInTheDocument()
    expect(screen.getByText('0 / 10')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('Not counted')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Returned marks' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('Current grade')).not.toBeInTheDocument()
  })

  it('shows no section after a successful empty result', async () => {
    vi.mocked(fetch).mockResolvedValue(response([]) as Response)
    render(<StudentReturnedMarks classroomId="class-1" />)
    await waitFor(() => expect(screen.queryByText('Loading returned marks')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Returned marks' })).not.toBeInTheDocument()
  })

  it('distinguishes loading and read failure, then retries', async () => {
    let reject!: (reason: Error) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    render(<StudentReturnedMarks classroomId="class-1" />)
    expect(screen.getByText('Loading returned marks')).toBeInTheDocument()
    await act(async () => reject(new Error('Offline')))
    expect(await screen.findByText("Returned marks couldn't load")).toBeInTheDocument()
    vi.mocked(fetch).mockResolvedValueOnce(response() as Response)
    fireEvent.click(screen.getByRole('button', { name: 'Retry returned marks' }))
    expect(await screen.findByText(mark.title)).toBeInTheDocument()
  })

  it('refreshes on tab reactivation even within the cache lifetime and removes retracted marks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response() as Response)
    const { rerender } = render(<StudentReturnedMarks classroomId="class-1" isActive />)
    expect(await screen.findByText(mark.title)).toBeInTheDocument()
    rerender(<StudentReturnedMarks classroomId="class-1" isActive={false} />)
    vi.mocked(fetch).mockResolvedValueOnce(response([]) as Response)
    rerender(<StudentReturnedMarks classroomId="class-1" isActive />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(mark.title)).not.toBeInTheDocument())
  })

  it('does not request data while inactive', () => {
    render(<StudentReturnedMarks classroomId="class-1" isActive={false} />)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never flashes marks from a previous classroom or accepts its late response', async () => {
    let resolve!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const { rerender } = render(<StudentReturnedMarks classroomId="class-1" />)
    vi.mocked(fetch).mockResolvedValueOnce(response([{ ...mark, title: 'New classroom mark' }]) as Response)
    rerender(<StudentReturnedMarks classroomId="class-2" />)
    expect(await screen.findByText('New classroom mark')).toBeInTheDocument()
    await act(async () => resolve(response() as Response))
    expect(screen.queryByText(mark.title)).not.toBeInTheDocument()
    expect(screen.getByText('New classroom mark')).toBeInTheDocument()
  })
})
