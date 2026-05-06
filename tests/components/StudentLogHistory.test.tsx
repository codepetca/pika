import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
    expect(fetchMock).toHaveBeenCalledTimes(1)

    request.resolve(await mockJson({ entries: [exactEntry] }))

    await screen.findByText('Exact fetched history appears after refresh.')
    expect(screen.getByText('Selected day log appears immediately.')).toBeInTheDocument()
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
})
