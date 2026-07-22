import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudentLogHistory } from '@/components/StudentLogHistory'
import type { Entry } from '@/types'

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    student_id: 'student-1',
    classroom_id: 'classroom-1',
    date: '2026-03-15',
    text: 'Worked carefully.',
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2026-03-15T12:00:00.000Z',
    updated_at: '2026-03-15T12:00:00.000Z',
    on_time: true,
    ...overrides,
  }
}

function mockJson(data: any, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) }) as any
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('StudentLogHistory', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the selected entry and preview before the exact history request resolves', async () => {
    const selectedEntry = entry({
      id: 'selected-entry',
      student_id: 'student-preview',
      classroom_id: 'classroom-preview',
      date: '2026-03-15',
      text: 'Selected day log appears immediately.',
    })
    const previewEntry = entry({
      id: 'preview-entry',
      student_id: 'student-preview',
      classroom_id: 'classroom-preview',
      date: '2026-03-14',
      text: 'Preview history appears immediately.',
    })
    const exactEntry = entry({
      id: 'exact-entry',
      student_id: 'student-preview',
      classroom_id: 'classroom-preview',
      date: '2026-03-13',
      text: 'Exact fetched history appears after refresh.',
    })
    const request = deferred<any>()
    const fetchMock = vi.fn(() => request.promise)
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StudentLogHistory
        studentId="student-preview"
        classroomId="classroom-preview"
        selectedEntry={selectedEntry}
        initialEntries={[selectedEntry, previewEntry]}
      />
    )

    expect(screen.getByText('Selected day log appears immediately.')).toBeInTheDocument()
    expect(screen.getByText('Preview history appears immediately.')).toBeInTheDocument()
    expect(screen.queryByText(/Selected date/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Selected day log appears immediately.').closest('[aria-current="date"]')
    ).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    request.resolve(await mockJson({ entries: [exactEntry] }))

    await screen.findByText('Exact fetched history appears after refresh.')
    expect(screen.getByText('Selected day log appears immediately.')).toBeInTheDocument()
  })

  it('keeps the selected entry in chronological order instead of pinning it', () => {
    const selectedEntry = entry({
      id: 'selected-older-entry',
      student_id: 'student-chronology',
      classroom_id: 'classroom-chronology',
      date: '2026-03-14',
      text: 'Selected older day.',
    })
    const newerEntry = entry({
      id: 'newer-entry',
      student_id: 'student-chronology',
      classroom_id: 'classroom-chronology',
      date: '2026-03-16',
      text: 'Newer history stays first.',
    })
    const olderEntry = entry({
      id: 'older-entry',
      student_id: 'student-chronology',
      classroom_id: 'classroom-chronology',
      date: '2026-03-13',
      text: 'Older history stays after.',
    })
    const request = deferred<any>()
    vi.stubGlobal('fetch', vi.fn(() => request.promise))

    const { container } = render(
      <StudentLogHistory
        studentId="student-chronology"
        classroomId="classroom-chronology"
        selectedDate="2026-03-14"
        selectedEntry={selectedEntry}
        initialEntries={[selectedEntry, newerEntry, olderEntry]}
      />
    )

    const text = container.textContent || ''
    expect(text.indexOf('Newer history stays first.')).toBeLessThan(
      text.indexOf('Selected older day.')
    )
    expect(text.indexOf('Selected older day.')).toBeLessThan(
      text.indexOf('Older history stays after.')
    )
    expect(
      screen.getByText('Selected older day.').closest('[aria-current="date"]')
    ).not.toBeNull()
    expect(screen.queryByText(/Selected date/)).not.toBeInTheDocument()
  })

  it('shows a selected no-log row at the selected date position', () => {
    const newerEntry = entry({
      id: 'newer-before-empty',
      student_id: 'student-empty-date',
      classroom_id: 'classroom-empty-date',
      date: '2026-03-16',
      text: 'Newer log.',
    })
    const olderEntry = entry({
      id: 'older-after-empty',
      student_id: 'student-empty-date',
      classroom_id: 'classroom-empty-date',
      date: '2026-03-14',
      text: 'Older log.',
    })
    const request = deferred<any>()
    vi.stubGlobal('fetch', vi.fn(() => request.promise))

    const { container } = render(
      <StudentLogHistory
        studentId="student-empty-date"
        classroomId="classroom-empty-date"
        selectedDate="2026-03-15"
        selectedEntry={null}
        initialEntries={[newerEntry, olderEntry]}
      />
    )

    const text = container.textContent || ''
    expect(text.indexOf('Newer log.')).toBeLessThan(
      text.indexOf('No log for this date.')
    )
    expect(text.indexOf('No log for this date.')).toBeLessThan(
      text.indexOf('Older log.')
    )
    expect(
      screen.getByText('No log for this date.').closest('[aria-current="date"]')
    ).not.toBeNull()
  })

  it('filters blank selected entries and blank preview rows', async () => {
    const selectedEntry = entry({
      id: 'blank-selected-entry',
      student_id: 'student-blank',
      classroom_id: 'classroom-blank',
      date: '2026-03-15',
      text: '   \n  ',
    })
    const blankPreviewEntry = entry({
      id: 'blank-preview-entry',
      student_id: 'student-blank',
      classroom_id: 'classroom-blank',
      date: '2026-03-14',
      text: '',
    })
    const visiblePreviewEntry = entry({
      id: 'visible-preview-entry',
      student_id: 'student-blank',
      classroom_id: 'classroom-blank',
      date: '2026-03-13',
      text: 'Visible preview history.',
    })
    const exactEntry = entry({
      id: 'visible-exact-entry',
      student_id: 'student-blank',
      classroom_id: 'classroom-blank',
      date: '2026-03-12',
      text: 'Visible exact history.',
    })
    const request = deferred<any>()
    vi.stubGlobal('fetch', vi.fn(() => request.promise))

    render(
      <StudentLogHistory
        studentId="student-blank"
        classroomId="classroom-blank"
        selectedEntry={selectedEntry}
        initialEntries={[selectedEntry, blankPreviewEntry, visiblePreviewEntry]}
      />
    )

    expect(screen.queryByText(/Selected date/)).not.toBeInTheDocument()
    expect(screen.getByText('Visible preview history.')).toBeInTheDocument()

    request.resolve(await mockJson({ entries: [blankPreviewEntry, exactEntry] }))

    await screen.findByText('Visible exact history.')
    expect(screen.queryByText(/Selected date/)).not.toBeInTheDocument()
  })

  it('shows a retryable error instead of an empty history after the read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recoveredEntry = entry({
      id: 'recovered-history-entry',
      student_id: 'student-retry',
      classroom_id: 'classroom-retry',
      text: 'Recovered history.',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await mockJson({ error: 'History unavailable' }, false))
      .mockResolvedValueOnce(await mockJson({ entries: [recoveredEntry] }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StudentLogHistory studentId="student-retry" classroomId="classroom-retry" />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.queryByText('No entries.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Recovered history.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('reuses cached exact history when a student is selected again', async () => {
    const exactEntry = entry({
      id: 'cached-entry',
      student_id: 'student-cache',
      classroom_id: 'classroom-cache',
      date: '2026-03-12',
      text: 'Cached history.',
    })
    const fetchMock = vi.fn(() => mockJson({ entries: [exactEntry] }))
    vi.stubGlobal('fetch', fetchMock)

    const first = render(
      <StudentLogHistory studentId="student-cache" classroomId="classroom-cache" />
    )
    await screen.findByText('Cached history.')
    first.unmount()

    render(<StudentLogHistory studentId="student-cache" classroomId="classroom-cache" />)
    await screen.findByText('Cached history.')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('reuses cached load-more history when the same page is requested again', async () => {
    const latestEntries = Array.from({ length: 10 }, (_, index) =>
      entry({
        id: `latest-${index}`,
        student_id: 'student-cache-more',
        classroom_id: 'classroom-cache-more',
        date: `2026-03-${String(20 - index).padStart(2, '0')}`,
        text: `Latest history ${index + 1}.`,
      })
    )
    const olderEntry = entry({
      id: 'older-cached-entry',
      student_id: 'student-cache-more',
      classroom_id: 'classroom-cache-more',
      date: '2026-03-01',
      text: 'Older cached history.',
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('before_date=2026-03-11')) {
        return mockJson({ entries: [olderEntry] })
      }
      return mockJson({ entries: latestEntries })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = render(
      <StudentLogHistory studentId="student-cache-more" classroomId="classroom-cache-more" />
    )
    await screen.findByText('Latest history 10.')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Older cached history.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    first.unmount()

    render(<StudentLogHistory studentId="student-cache-more" classroomId="classroom-cache-more" />)
    await screen.findByText('Latest history 10.')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Older cached history.')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('ignores an older load-more response after the selected student changes', async () => {
    const studentALatest = Array.from({ length: 10 }, (_, index) =>
      entry({
        id: `student-a-latest-${index}`,
        student_id: 'student-a',
        classroom_id: 'classroom-race',
        date: `2026-03-${String(20 - index).padStart(2, '0')}`,
        text: `Student A history ${index + 1}.`,
      })
    )
    const studentBOwnEntry = entry({
      id: 'student-b-entry',
      student_id: 'student-b',
      classroom_id: 'classroom-race',
      text: 'Student B history.',
    })
    const studentAOlderEntry = entry({
      id: 'student-a-older',
      student_id: 'student-a',
      classroom_id: 'classroom-race',
      date: '2026-03-01',
      text: 'Student A older history must not leak.',
    })
    const olderRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('student_id=student-a') && url.includes('before_date=')) {
        return olderRequest.promise
      }
      if (url.includes('student_id=student-a')) {
        return mockJson({ entries: studentALatest })
      }
      if (url.includes('student_id=student-b')) {
        return mockJson({ entries: [studentBOwnEntry] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(
      <StudentLogHistory studentId="student-a" classroomId="classroom-race" />
    )
    await screen.findByText('Student A history 10.')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    view.rerender(
      <StudentLogHistory studentId="student-b" classroomId="classroom-race" />
    )
    expect(await screen.findByText('Student B history.')).toBeInTheDocument()

    olderRequest.resolve(await mockJson({ entries: [studentAOlderEntry] }))

    await waitFor(() => {
      expect(screen.queryByText('Student A older history must not leak.')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Student B history.')).toBeInTheDocument()
  })
})
