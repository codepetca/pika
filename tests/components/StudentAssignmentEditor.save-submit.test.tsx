import { act, createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  StudentAssignmentEditor,
  type StudentAssignmentEditorHandle,
} from '@/components/StudentAssignmentEditor'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/components/StudentNotificationsProvider', () => ({
  useStudentNotifications: () => null,
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/HistoryList', () => ({
  HistoryList: ({ entries, onEntryClick }: any) => (
    <div data-testid="history-list">
      {entries[0] && (
        <button type="button" onClick={() => onEntryClick(entries[0])}>
          Select saved version
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/lib/assignment-doc-history', () => ({
  reconstructAssignmentDocContent: () => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored answer' }] }],
  }),
}))

const latestDraft = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest unsaved answer' }] }],
}

const olderInFlightDraft = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older in-flight answer' }] }],
}

const savedDraft = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older saved answer' }] }],
}

const largeDraft = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(70_000) }] }],
}

vi.mock('@/components/editor', () => ({
  RichTextEditor: ({ content, onBlur, onChange, onKeystroke }: any) => (
    <div>
      <output data-testid="editor-content">{JSON.stringify(content)}</output>
      <button type="button" onClick={() => onChange(olderInFlightDraft)}>Edit older response</button>
      <button type="button" onClick={() => onChange(latestDraft)}>Edit response</button>
      <button type="button" onClick={() => onChange(savedDraft)}>Revert response</button>
      <button type="button" onClick={() => onChange(largeDraft)}>Edit large response</button>
      <button type="button" onClick={onKeystroke}>Record keystroke</button>
      <button type="button" onClick={onBlur}>Blur response</button>
    </div>
  ),
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
}))

vi.mock('@/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  ConfirmDialog: ({
    isOpen,
    title,
    description,
    confirmLabel,
    isCancelDisabled,
    isConfirmDisabled,
    onCancel,
    onConfirm,
  }: any) => isOpen ? (
    <div role="dialog" aria-modal="true" aria-label={title}>
      <p>{description}</p>
      <button type="button" disabled={isCancelDisabled} onClick={onCancel}>Cancel</button>
      <button type="button" disabled={isConfirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null,
  Tooltip: ({ children }: any) => <>{children}</>,
}))

function makeAssignment() {
  return {
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    title: 'Assignment Title',
    description: '',
    instructions_markdown: '',
    due_at: '2026-08-01T03:59:59.000Z',
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
  } as any
}

function makeDoc() {
  return {
    id: 'doc-1',
    assignment_id: 'assignment-1',
    student_id: 'student-1',
    content: savedDraft,
    is_submitted: false,
    submitted_at: null,
    viewed_at: '2026-07-01T12:00:00.000Z',
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
  } as any
}

describe('StudentAssignmentEditor save-before-submit integrity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the current draft unsubmitted when its pre-submit save fails', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    let saveAttempts = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }

      if (
        url.endsWith('/assignment-docs/assignment-1')
        && (!init?.method || init.method === 'GET')
      ) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }

      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        saveAttempts += 1
        if (saveAttempts === 1) {
          return { ok: false, json: async () => ({ error: 'Save service unavailable' }) }
        }

        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: latestDraft },
            historyEntry: null,
          }),
        }
      }

      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: latestDraft, is_submitted: true } }),
        }
      }

      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))

    await act(async () => {
      await ref.current?.submit()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assignment-docs/assignment-1',
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/assignment-docs/assignment-1/submit',
      expect.anything(),
    )
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.getByTestId('assignment-save-status')).toHaveTextContent('Unsaved')
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not submitted.*try again/i)
    })

    await act(async () => {
      await ref.current?.submit()
    })

    expect(saveAttempts).toBe(2)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(1)
    await waitFor(() => {
      expect(ref.current?.isSubmitted).toBe(true)
    })
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.queryByText(/not submitted.*try again/i)).not.toBeInTheDocument()
  })

  it('submits the pending editor snapshot before React rerenders', async () => {
    const patchBodies: any[] = []
    const submitBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (
        url.endsWith('/assignment-docs/assignment-1')
        && (!init?.method || init.method === 'GET')
      ) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        const body = JSON.parse(String(init?.body))
        submitBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, is_submitted: true, updated_at: '2026-07-01T12:02:00.000Z' },
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit response' }))
      await ref.current?.submit()
    })

    expect(patchBodies[0]?.content).toEqual(latestDraft)
    expect(submitBodies[0]?.content).toEqual(latestDraft)
    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBeNull()
  })

  it('preserves an edit made while submit reconciliation is in flight', async () => {
    let docReads = 0
    let rejectSubmit: ((error: Error) => void) | undefined
    const submitResponse = new Promise<never>((_, reject) => {
      rejectSubmit = reject
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (
        url.endsWith('/assignment-docs/assignment-1')
        && (!init?.method || init.method === 'GET')
      ) {
        docReads += 1
        const submitted = docReads > 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              content: submitted ? latestDraft : savedDraft,
              is_submitted: submitted,
              submitted_at: submitted ? '2026-07-01T12:02:00.000Z' : null,
              updated_at: submitted ? '2026-07-01T12:02:00.000Z' : makeDoc().updated_at,
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) return submitResponse
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))

    let submission: Promise<void> | undefined
    act(() => {
      submission = ref.current?.submit()
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/submit'))).toBe(true)
    })
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    rejectSubmit?.(new TypeError('submit response lost'))
    await act(async () => {
      await submission
    })

    const recovery = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(recovery.content).toEqual(olderInFlightDraft)
    await waitFor(() => {
      expect(screen.getByText(/local draft is preserved/i)).toBeInTheDocument()
    })
  })

  it('bounds a hung pre-submit save and does not deadlock submission', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => {
      await ref.current?.submit()
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/timed out.*try again/i)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/submit'))).toBe(false)
  })

  it('waits for an older autosave before saving and submitting the latest draft', async () => {
    let resolveOlderSave: ((response: any) => void) | undefined
    const olderSaveResponse = new Promise<any>((resolve) => {
      resolveOlderSave = resolve
    })
    let resolveLatestSave: ((response: any) => void) | undefined
    const latestSaveResponse = new Promise<any>((resolve) => {
      resolveLatestSave = resolve
    })
    let latestSaveAttempts = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }

      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }

      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const requestContent = JSON.parse(String(init.body)).content
        if (JSON.stringify(requestContent) === JSON.stringify(olderInFlightDraft)) {
          return olderSaveResponse
        }

        latestSaveAttempts += 1
        if (latestSaveAttempts === 1) {
          return latestSaveResponse
        }

        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: requestContent },
            historyEntry: null,
          }),
        }
      }

      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: latestDraft, is_submitted: true } }),
        }
      }

      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    let submitPromise: Promise<void> | undefined
    await act(async () => {
      submitPromise = ref.current?.submit()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(0)

    resolveOlderSave?.({
      ok: true,
      json: async () => ({
        doc: { ...makeDoc(), content: olderInFlightDraft },
        historyEntry: null,
      }),
    })

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2)
    })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(0)

    resolveLatestSave?.({
      ok: false,
      json: async () => ({ error: 'Latest save failed' }),
    })

    await act(async () => {
      await submitPromise
    })

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent(/not submitted.*try again/i)

    await act(async () => {
      await ref.current?.submit()
    })

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(patchCalls).toHaveLength(3)
    expect(JSON.parse(String(patchCalls[2]?.[1]?.body)).content).toEqual(latestDraft)
    expect(JSON.parse(String(patchCalls[2]?.[1]?.body)).keystroke_count).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assignment-docs/assignment-1/submit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          content: latestDraft,
          expected_updated_at: '2026-07-01T12:00:00.000Z',
        }),
      }),
    )
  })

  it('waits for an older autosave before submitting a draft reverted to the prior saved content', async () => {
    let resolveOlderSave: ((response: any) => void) | undefined
    const olderSaveResponse = new Promise<any>((resolve) => {
      resolveOlderSave = resolve
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const requestContent = JSON.parse(String(init.body)).content
        if (JSON.stringify(requestContent) === JSON.stringify(olderInFlightDraft)) {
          return olderSaveResponse
        }
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: requestContent }, historyEntry: null }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: savedDraft, is_submitted: true } }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    })
    await user.click(screen.getByRole('button', { name: 'Revert response' }))

    let submitPromise: Promise<void> | undefined
    await act(async () => {
      submitPromise = ref.current?.submit()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(0)

    resolveOlderSave?.({
      ok: true,
      json: async () => ({ doc: { ...makeDoc(), content: olderInFlightDraft }, historyEntry: null }),
    })
    await act(async () => {
      await submitPromise
    })

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(patchCalls).toHaveLength(2)
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body)).content).toEqual(savedDraft)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(1)
  })

  it('flushes the latest unsaved draft when the editor unmounts', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const requestContent = JSON.parse(String(init.body)).content
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: requestContent }, historyEntry: null }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    const { unmount } = render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    unmount()

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patchCalls).toHaveLength(1)
      expect(JSON.parse(String(patchCalls[0]?.[1]?.body)).content).toEqual(latestDraft)
    })
  })

  it('flushes metrics-only activity when the editor unmounts', async () => {
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: body.content }, historyEntry: null }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    const { unmount } = render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    unmount()

    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toEqual(expect.objectContaining({
      content: savedDraft,
      keystroke_count: 1,
    }))
  })

  it('keeps newer edits unsaved when an older in-flight save completes', async () => {
    let resolveOlderSave: ((response: any) => void) | undefined
    const olderSaveResponse = new Promise<any>((resolve) => {
      resolveOlderSave = resolve
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const requestContent = JSON.parse(String(init.body)).content
        if (JSON.stringify(requestContent) === JSON.stringify(olderInFlightDraft)) {
          return olderSaveResponse
        }
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: requestContent }, historyEntry: null }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Edit response' }))

    resolveOlderSave?.({
      ok: true,
      json: async () => ({ doc: { ...makeDoc(), content: olderInFlightDraft }, historyEntry: null }),
    })

    await waitFor(() => {
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
    })
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
  })

  it('records input metrics when edits return to the already saved content', async () => {
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), is_submitted: true } }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Revert response' }))
    await act(async () => {
      await ref.current?.submit()
    })

    expect(patchBodies).toHaveLength(1)
    expect(patchBodies[0]).toEqual(expect.objectContaining({
      content: savedDraft,
      keystroke_count: 1,
    }))
  })

  it('reuses an ambiguous save sequence when retrying the same content and metrics', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    let saveTimeoutCount = 0
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000 && saveTimeoutCount++ === 0) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length === 1) {
          return new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          })
        }
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: latestDraft, is_submitted: true } }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })
    await act(async () => { await ref.current?.submit() })

    expect(patchBodies).toHaveLength(2)
    expect(patchBodies[0].save_sequence).toBe(1)
    expect(patchBodies[1].save_sequence).toBe(1)
    expect(patchBodies[1].keystroke_count).toBe(1)
    expect(patchBodies[1].metric_session_id).toBe(patchBodies[0].metric_session_id)
  })

  it('retires an ambiguous attempt after a definitive revision conflict', async () => {
    let docReads = 0
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              content: docReads > 1 ? latestDraft : savedDraft,
              updated_at: docReads > 1 ? '2026-07-01T12:01:00.000Z' : makeDoc().updated_at,
            },
            feedback_entries: [], submission_requirements: [], submission_artifacts: [], wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length === 1) throw new TypeError('connection reset')
        if (patchBodies.length === 2) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'This draft changed elsewhere.' }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:02:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return { ok: true, json: async () => ({ doc: { ...makeDoc(), content: latestDraft, is_submitted: true } }) }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })
    await act(async () => { await ref.current?.submit() })
    await act(async () => { await ref.current?.submit() })

    expect(patchBodies.map((body) => body.save_sequence)).toEqual([1, 1, 2])
    expect(patchBodies.map((body) => body.expected_updated_at)).toEqual([
      makeDoc().updated_at,
      makeDoc().updated_at,
      '2026-07-01T12:01:00.000Z',
    ])
  })

  it('reuses an ambiguous save sequence after a non-abort network failure', async () => {
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length === 1) throw new TypeError('Connection closed after request upload')
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: latestDraft, is_submitted: true } }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })
    const persistedAttempt = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    ))).pending_save
    await act(async () => { await ref.current?.submit() })

    expect(patchBodies.map((body) => body.save_sequence)).toEqual([1, 1])
    expect(patchBodies[1]).toEqual(patchBodies[0])
    expect(persistedAttempt).toEqual(expect.objectContaining({
      sequence: 1,
      keystrokeCount: 1,
      expectedUpdatedAt: makeDoc().updated_at,
    }))
    expect(patchBodies[1].keystroke_count).toBe(1)
    expect(patchBodies[1].metric_session_id).toBe(patchBodies[0].metric_session_id)
  })

  it('preserves the immutable save identity across a transient HTTP failure', async () => {
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(), doc: makeDoc(), feedback_entries: [],
            submission_requirements: [], submission_artifacts: [], wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length === 1) {
          return { ok: false, status: 503, json: async () => ({ error: 'Gateway unavailable' }) }
        }
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return { ok: true, json: async () => ({ doc: { ...makeDoc(), content: latestDraft, is_submitted: true } }) }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })
    await act(async () => { await ref.current?.submit() })

    expect(patchBodies).toHaveLength(2)
    expect(patchBodies[1]).toEqual(patchBodies[0])
  })

  it('stops submission when an ambiguous save committed before another editor save', async () => {
    let docReads = 0
    const patchBodies: any[] = []
    const submit = vi.fn()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              content: docReads === 1 ? savedDraft : olderInFlightDraft,
              updated_at: docReads === 1
                ? makeDoc().updated_at
                : '2026-07-01T12:02:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length === 1) throw new TypeError('Connection closed after commit')
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'This save completed, but a newer saved version now exists.',
            error_code: 'assignment_doc_save_replayed',
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        submit()
        return { ok: true, json: async () => ({ doc: makeDoc() }) }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })
    await act(async () => { await ref.current?.submit() })

    expect(patchBodies.map((body) => body.save_sequence)).toEqual([1, 1])
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/newer saved version exists.*review/i)
  })

  it('preserves a newer in-memory draft when an older save conflicts', async () => {
    let resolveOlderSave: ((response: any) => void) | undefined
    const olderSaveResponse = new Promise<any>((resolve) => {
      resolveOlderSave = resolve
    })
    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              content: docReads === 1 ? savedDraft : olderInFlightDraft,
              updated_at: docReads === 1
                ? makeDoc().updated_at
                : '2026-07-01T12:01:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return olderSaveResponse
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await screen.findByText('Saving...')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))

    resolveOlderSave?.({
      ok: false,
      status: 409,
      json: async () => ({ error: 'This draft changed elsewhere before the save completed.' }),
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('changed elsewhere')
    })
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    const recovery = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(recovery.content).toEqual(latestDraft)
  })

  it('preserves edits that arrive while a successful submission is in flight', async () => {
    let resolveSubmit: ((response: any) => void) | undefined
    const submitResponse = new Promise<any>((resolve) => {
      resolveSubmit = resolve
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return {
          ok: true,
          json: async () => ({
            doc: {
              ...makeDoc(),
              content: body.content,
              updated_at: '2026-07-01T12:01:00.000Z',
            },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) return submitResponse
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    let submitPromise: Promise<void> | undefined
    await act(async () => {
      submitPromise = ref.current?.submit()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit older response' }))
    resolveSubmit?.({
      ok: true,
      status: 200,
      json: async () => ({
        doc: {
          ...makeDoc(),
          content: latestDraft,
          is_submitted: true,
          submitted_at: '2026-07-01T12:02:00.000Z',
          updated_at: '2026-07-01T12:02:00.000Z',
        },
      }),
    })
    await act(async () => {
      await submitPromise
    })

    expect(ref.current?.isSubmitted).toBe(true)
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.getByRole('alert')).toHaveTextContent(/newer local edits.*preserved/i)
    const recovery = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(recovery.content).toEqual(olderInFlightDraft)
  })

  it('keeps a queued-save recovery draft after the earlier submission response succeeds', async () => {
    let resolveSubmit: ((response: any) => void) | undefined
    const submitResponse = new Promise<any>((resolve) => {
      resolveSubmit = resolve
    })
    let docReads = 0
    let patchCount = 0
    const submittedDoc = {
      ...makeDoc(),
      content: latestDraft,
      is_submitted: true,
      submitted_at: '2026-07-01T12:02:00.000Z',
      updated_at: '2026-07-01T12:02:00.000Z',
    }
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: docReads === 1 ? makeDoc() : submittedDoc,
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        patchCount += 1
        const body = JSON.parse(String(init.body))
        if (patchCount === 1) {
          return {
            ok: true,
            json: async () => ({
              doc: {
                ...makeDoc(),
                content: body.content,
                updated_at: '2026-07-01T12:01:00.000Z',
              },
              historyEntry: null,
            }),
          }
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Cannot edit a submitted document' }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) return submitResponse
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    let submitPromise: Promise<void> | undefined
    await act(async () => {
      submitPromise = ref.current?.submit()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit older response' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchCount).toBe(2))
    await waitFor(() => expect(docReads).toBe(2))

    resolveSubmit?.({
      ok: true,
      status: 200,
      json: async () => ({ doc: submittedDoc }),
    })
    await act(async () => {
      await submitPromise
    })

    expect(ref.current?.isSubmitted).toBe(true)
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    const recovery = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(recovery.content).toEqual(olderInFlightDraft)
  })

  it('uses a keepalive save for the latest draft on pagehide', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const requestContent = JSON.parse(String(init.body)).content
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: requestContent }, historyEntry: null }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    fireEvent(window, new Event('pagehide'))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => (
        init?.method === 'PATCH'
        && init.keepalive === true
        && JSON.parse(String(init.body)).content.content[0].content[0].text === 'Latest unsaved answer'
      ))).toBe(true)
    })
  })

  it('uses a keepalive save for metrics-only activity on pagehide', async () => {
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({ doc: { ...makeDoc(), content: body.content }, historyEntry: null }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    fireEvent(window, new Event('pagehide'))

    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toEqual(expect.objectContaining({
      content: savedDraft,
      keystroke_count: 1,
    }))
  })

  it('does not resend metrics already committed by a pagehide save', async () => {
    let docReads = 0
    const patchBodies: any[] = []
    let resolveKeepalive: ((response: any) => void) | undefined
    const keepaliveResponse = new Promise<any>((resolve) => {
      resolveKeepalive = resolve
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              content: docReads > 1 ? latestDraft : savedDraft,
              updated_at: docReads > 1
                ? '2026-07-01T12:01:00.000Z'
                : '2026-07-01T12:00:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (init.keepalive) return keepaliveResponse
        return {
          ok: true,
          json: async () => ({
            doc: {
              ...makeDoc(),
              content: body.content,
              updated_at: init.keepalive
                ? '2026-07-01T12:01:00.000Z'
                : '2026-07-01T12:02:00.000Z',
            },
            historyEntry: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    fireEvent(window, new Event('pagehide'))
    await waitFor(() => expect(patchBodies).toHaveLength(1))

    fireEvent(window, new Event('pageshow'))
    await waitFor(() => expect(docReads).toBe(2))
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(2))

    expect(patchBodies[0].keystroke_count).toBe(1)
    expect(patchBodies[1].keystroke_count).toBe(2)
    expect(patchBodies[1].metric_session_id).toBe(patchBodies[0].metric_session_id)

    await act(async () => {
      resolveKeepalive?.({
        ok: true,
        json: async () => ({
          doc: {
            ...makeDoc(),
            content: latestDraft,
            updated_at: '2026-07-01T12:01:00.000Z',
          },
          historyEntry: null,
        }),
      })
      await Promise.resolve()
    })
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(3))
    expect(patchBodies[2].keystroke_count).toBe(1)
  })

  it('fences all older queued saves when pagehide restores the saved draft', async () => {
    let resolveOlderSave: ((response: any) => void) | undefined
    const olderSaveResponse = new Promise<any>((resolve) => {
      resolveOlderSave = resolve
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        if (init.keepalive) {
          const body = JSON.parse(String(init.body))
          return {
            ok: true,
            json: async () => ({ doc: { ...makeDoc(), content: body.content }, historyEntry: null }),
          }
        }
        return olderSaveResponse
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await screen.findByText('Saving...')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await user.click(screen.getByRole('button', { name: 'Revert response' }))
    fireEvent(window, new Event('pagehide'))

    await waitFor(() => {
      const keepaliveCall = fetchMock.mock.calls.find(([, init]) => init?.keepalive === true)
      expect(keepaliveCall).toBeDefined()
      const body = JSON.parse(String(keepaliveCall?.[1]?.body))
      expect(body.content).toEqual(savedDraft)
      expect(body.save_session_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(body.save_sequence).toBe(2)
      expect(body.keystroke_count).toBe(2)
      const firstPatchCall = fetchMock.mock.calls.find(([, init]) => (
        init?.method === 'PATCH' && init.keepalive !== true
      ))
      const firstPatchBody = JSON.parse(String(firstPatchCall?.[1]?.body))
      expect(body.metric_session_id).toBe(firstPatchBody.metric_session_id)
      expect(body.expected_updated_at).toBe(makeDoc().updated_at)
    })

    expect(fetchMock.mock.calls.filter(([, init]) => (
      init?.method === 'PATCH' && init.keepalive !== true
    ))).toHaveLength(1)

    resolveOlderSave?.({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Superseded by the pagehide save' }),
    })
  })

  it('keeps an oversized pagehide draft in durable storage instead of exceeding keepalive quota', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit large response' }))
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    fireEvent(window, new Event('pagehide'))

    expect(fetchMock.mock.calls.some(([, init]) => init?.keepalive === true)).toBe(false)
    const stored = JSON.parse(String(window.sessionStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(stored.content).toEqual(largeDraft)
    const durable = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(durable.content).toEqual(largeDraft)
    expect(durable.keystroke_count).toBe(1)
  })

  it('recovers a durable draft after the prior tab is gone', async () => {
    window.localStorage.setItem(
      'assignment-draft:student-1:assignment-1',
      JSON.stringify({
        content: latestDraft,
        base_revision: '2026-06-30T12:00:00.000Z',
        saved_at: new Date().toISOString(),
      })
    )
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.getByRole('alert')).toHaveTextContent(/local draft was recovered.*review/i)
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
  })

  it('replays a recovered metrics-only operation before clearing matching content', async () => {
    const pendingSave = {
      content: savedDraft,
      sessionId: '10000000-0000-4000-8000-000000000091',
      sequence: 4,
      metricSessionId: '10000000-0000-4000-8000-000000000092',
      expectedUpdatedAt: makeDoc().updated_at,
      trigger: 'blur',
      pasteWordCount: 0,
      keystrokeCount: 3,
    }
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', JSON.stringify({
      draft_id: '10000000-0000-4000-8000-000000000093',
      generation: Date.now() * 1_000,
      content: savedDraft,
      base_revision: makeDoc().updated_at,
      paste_word_count: 0,
      keystroke_count: 3,
      pending_save: pendingSave,
      saved_at: new Date().toISOString(),
    }))
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(), doc: makeDoc(), feedback_entries: [],
            submission_requirements: [], submission_artifacts: [], wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)))
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toEqual(expect.objectContaining({
      save_session_id: pendingSave.sessionId,
      save_sequence: pendingSave.sequence,
      metric_session_id: pendingSave.metricSessionId,
      keystroke_count: 3,
    }))
    await screen.findByText('Saved')
    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBeNull()
  })

  it('replaces an equal-content recovered operation after a definitive conflict', async () => {
    const pendingSave = {
      content: savedDraft,
      sessionId: '10000000-0000-4000-8000-000000000081',
      sequence: 5,
      metricSessionId: '10000000-0000-4000-8000-000000000082',
      expectedUpdatedAt: makeDoc().updated_at,
      trigger: 'blur',
      pasteWordCount: 0,
      keystrokeCount: 1,
    }
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', JSON.stringify({
      draft_id: '10000000-0000-4000-8000-000000000083',
      generation: Date.now() * 1_000,
      content: savedDraft,
      base_revision: makeDoc().updated_at,
      paste_word_count: 0,
      keystroke_count: 1,
      pending_save: pendingSave,
      saved_at: new Date().toISOString(),
    }))
    let docReads = 0
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              updated_at: docReads === 1
                ? makeDoc().updated_at
                : '2026-07-01T12:01:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [], submission_artifacts: [], wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        if (patchBodies.length > 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              doc: {
                ...makeDoc(),
                updated_at: '2026-07-01T12:02:00.000Z',
              },
              historyEntry: null,
            }),
          }
        }
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'This draft changed elsewhere.' }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    let replacement: any
    await waitFor(() => {
      replacement = JSON.parse(String(window.localStorage.getItem(
        'assignment-draft:student-1:assignment-1'
      )))
      expect(replacement.pending_save.sessionId).not.toBe(pendingSave.sessionId)
    })
    expect(replacement.pending_save.expectedUpdatedAt).toBe('2026-07-01T12:01:00.000Z')
    expect(replacement.pending_save.keystrokeCount).toBe(1)
    expect(replacement.pending_save.metricSessionId).toBe(pendingSave.metricSessionId)

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[1]).toEqual(expect.objectContaining({
      save_session_id: replacement.pending_save.sessionId,
      expected_updated_at: '2026-07-01T12:01:00.000Z',
      keystroke_count: 1,
    }))
    await waitFor(() => {
      expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBeNull()
    })
  })

  it('expires recovery records without a valid timestamp', async () => {
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', JSON.stringify({
      content: latestDraft,
      saved_at: 'not-a-date',
    }))
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      return {
        ok: true,
        json: async () => ({
          assignment: makeAssignment(), doc: makeDoc(), feedback_entries: [],
          submission_requirements: [], submission_artifacts: [], wasFirstView: false,
        }),
      }
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Older saved answer')
    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBeNull()
  })

  it('selects the newest recovery generation across both browser stores', async () => {
    const now = Date.now()
    window.sessionStorage.setItem('assignment-draft:student-1:assignment-1', JSON.stringify({
      draft_id: '10000000-0000-4000-8000-000000000001',
      content: olderInFlightDraft,
      saved_at: new Date(now - 1_000).toISOString(),
    }))
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', JSON.stringify({
      draft_id: '10000000-0000-4000-8000-000000000002',
      content: latestDraft,
      saved_at: new Date(now).toISOString(),
    }))
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
  })

  it('replays a recovered operation identity without adopting it for new tab saves', async () => {
    const recoveredSessionId = '10000000-0000-4000-8000-000000000099'
    window.localStorage.setItem(
      'assignment-draft:student-1:assignment-1',
      JSON.stringify({
        draft_id: '10000000-0000-4000-8000-000000000098',
        content: latestDraft,
        base_revision: makeDoc().updated_at,
        save_session_id: recoveredSessionId,
        paste_word_count: 0,
        keystroke_count: 0,
        saved_at: new Date().toISOString(),
        pending_save: {
          content: latestDraft,
          sessionId: recoveredSessionId,
          sequence: 7,
          metricSessionId: '10000000-0000-4000-8000-000000000097',
          expectedUpdatedAt: makeDoc().updated_at,
          trigger: 'blur',
          pasteWordCount: 0,
          keystrokeCount: 0,
        },
      })
    )
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:02:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(1))

    expect(patchBodies[0].save_session_id).not.toBe(recoveredSessionId)
    expect(patchBodies[0].metric_session_id).toBe('10000000-0000-4000-8000-000000000097')
  })

  it('ignores a recovered operation whose counters exceed the API contract', async () => {
    const recoveredSessionId = '10000000-0000-4000-8000-000000000099'
    window.localStorage.setItem(
      'assignment-draft:student-1:assignment-1',
      JSON.stringify({
        draft_id: '10000000-0000-4000-8000-000000000098',
        content: latestDraft,
        saved_at: new Date().toISOString(),
        pending_save: {
          content: latestDraft,
          sessionId: recoveredSessionId,
          sequence: 7,
          metricSessionId: '10000000-0000-4000-8000-000000000097',
          expectedUpdatedAt: makeDoc().updated_at,
          trigger: 'blur',
          pasteWordCount: 32_768,
          keystrokeCount: 0,
        },
      })
    )
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:02:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(1))

    expect(patchBodies[0].save_session_id).not.toBe(recoveredSessionId)
    expect(patchBodies[0].metric_session_id).not.toBe('10000000-0000-4000-8000-000000000097')
  })

  it('preserves a newer recovery draft while the server document is submitted', async () => {
    window.localStorage.setItem(
      'assignment-draft:student-1:assignment-1',
      JSON.stringify({
        content: latestDraft,
        base_revision: makeDoc().updated_at,
        save_session_id: '10000000-0000-4000-8000-000000000099',
        saved_at: new Date().toISOString(),
      })
    )
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: { ...makeDoc(), is_submitted: true, submitted_at: '2026-07-01T12:01:00.000Z' },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    expect(screen.getByRole('alert')).toHaveTextContent(/local draft is preserved/i)
    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).not.toBeNull()
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Older saved answer')
  })

  it('shows a preserved local draft when a returned submission cannot be unsubmitted', async () => {
    window.localStorage.setItem(
      'assignment-draft:student-1:assignment-1',
      JSON.stringify({
        content: latestDraft,
        base_revision: makeDoc().updated_at,
        save_session_id: '10000000-0000-4000-8000-000000000099',
        saved_at: new Date().toISOString(),
      })
    )
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              is_submitted: true,
              submitted_at: '2026-07-01T12:01:00.000Z',
              returned_at: '2026-07-01T12:02:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Preserved local draft')
    expect(screen.getByRole('alert')).toHaveTextContent(/preserved below for review/i)
    expect(screen.getByTestId('rich-text-viewer')).toBeInTheDocument()
  })

  it('clears matching recovery drafts from both browser stores', async () => {
    const recovery = JSON.stringify({
      content: savedDraft,
      base_revision: makeDoc().updated_at,
    })
    window.sessionStorage.setItem('assignment-draft:student-1:assignment-1', recovery)
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', recovery)
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    expect(window.sessionStorage.getItem('assignment-draft:student-1:assignment-1')).toBeNull()
    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBeNull()
  })

  it('does not clear a durable recovery draft owned by another editor session', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    const claimedDraft = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    const otherSessionDraft = JSON.stringify({
      content: olderInFlightDraft,
      base_revision: makeDoc().updated_at,
      save_session_id: '10000000-0000-4000-8000-000000000099',
      draft_id: '10000000-0000-4000-8000-000000000099',
      saved_at: new Date(Date.parse(claimedDraft.saved_at) + 1_000).toISOString(),
    })
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', otherSessionDraft)
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await screen.findByText('Saved')

    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBe(otherSessionDraft)
  })

  it('does not clear a newer durable draft generation from the same editor session', async () => {
    let resolveSave: ((response: any) => void) | undefined
    const saveResponse = new Promise<any>((resolve) => {
      resolveSave = resolve
    })
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return saveResponse
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    })
    const claimedDraft = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    const newerGeneration = JSON.stringify({
      ...claimedDraft,
      draft_id: '10000000-0000-4000-8000-000000000099',
      generation: claimedDraft.generation + 1,
      content: olderInFlightDraft,
      saved_at: new Date(Date.parse(claimedDraft.saved_at) + 1_000).toISOString(),
    })
    window.localStorage.setItem('assignment-draft:student-1:assignment-1', newerGeneration)
    resolveSave?.({
      ok: true,
      json: async () => ({
        doc: { ...makeDoc(), content: latestDraft, updated_at: '2026-07-01T12:01:00.000Z' },
        historyEntry: null,
      }),
    })
    await screen.findByText('Saved')

    expect(window.localStorage.getItem('assignment-draft:student-1:assignment-1')).toBe(newerGeneration)
  })

  it('uses a fresh writer fence after remount even when tab writer state was cloned', async () => {
    const patchBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(), doc: makeDoc(), feedback_entries: [],
            submission_requirements: [], submission_artifacts: [], wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: `2026-07-01T12:0${patchBodies.length}:00.000Z` },
            historyEntry: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    const first = render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    first.unmount()
    window.sessionStorage.setItem(
      'assignment-save-writer:student-1:assignment-1',
      JSON.stringify({
        session_id: patchBodies[0].save_session_id,
        sequence: patchBodies[0].save_sequence,
      })
    )

    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(2))

    expect(patchBodies[1].save_session_id).not.toBe(patchBodies[0].save_session_id)
    expect(patchBodies.map((body) => body.save_sequence)).toEqual([1, 1])
  })

  it('refreshes the saved revision after a pre-submit save conflict so retry can succeed', async () => {
    const serverDraft = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved in another tab' }] }],
    }
    const revisions = {
      initial: '2026-07-01T12:00:00.000Z',
      conflict: '2026-07-01T12:02:00.000Z',
      retrySave: '2026-07-01T12:03:00.000Z',
      submitted: '2026-07-01T12:04:00.000Z',
    }
    let docGetCount = 0
    let patchCount = 0
    let submitCount = 0
    const patchBodies: any[] = []
    const submitBodies: any[] = []
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docGetCount += 1
        const refreshed = docGetCount > 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              content: refreshed ? serverDraft : savedDraft,
              updated_at: refreshed ? revisions.conflict : revisions.initial,
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        patchCount += 1
        patchBodies.push(JSON.parse(String(init.body)))
        if (patchCount === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'This draft changed elsewhere before the save completed.' }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            doc: {
              ...makeDoc(),
              content: latestDraft,
              updated_at: revisions.retrySave,
            },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        submitCount += 1
        submitBodies.push(JSON.parse(String(init?.body)))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            doc: {
              ...makeDoc(),
              content: latestDraft,
              is_submitted: true,
              updated_at: revisions.submitted,
            },
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => {
      await ref.current?.submit()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('changed elsewhere')
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()

    await act(async () => {
      await ref.current?.submit()
    })

    expect(patchBodies.map((body) => body.expected_updated_at)).toEqual([
      revisions.initial,
      revisions.conflict,
    ])
    expect(submitBodies.map((body) => body.expected_updated_at)).toEqual([
      revisions.retrySave,
    ])
    await waitFor(() => expect(ref.current?.isSubmitted).toBe(true))
  })

  it('requires reload when a revision conflict cannot refresh the saved document', async () => {
    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        if (docReads > 1) {
          return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }
        }
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'This draft changed elsewhere.' }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => {
      await ref.current?.submit()
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be reloaded.*reload/i)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/submit'))).toBe(false)
  })

  it('bounds a hung revision-conflict reconciliation read', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    let requestTimeoutCount = 0
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000 && requestTimeoutCount++ === 1) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        if (docReads > 1) {
          return { ok: true, status: 200, json: async () => new Promise(() => undefined) }
        }
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(), doc: makeDoc(), feedback_entries: [],
            submission_requirements: [], submission_artifacts: [], wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'This draft changed elsewhere.' }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )
    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be reloaded.*reload/i)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/submit'))).toBe(false)
  })

  it('refreshes submitted state and preserves the local draft when another tab submits first', async () => {
    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              is_submitted: docReads > 1,
              submitted_at: docReads > 1 ? '2026-07-01T12:01:00.000Z' : null,
              updated_at: docReads > 1 ? '2026-07-01T12:01:00.000Z' : makeDoc().updated_at,
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Cannot edit a submitted document' }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/unsubmit')) {
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), is_submitted: false, updated_at: '2026-07-01T12:02:00.000Z' },
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await act(async () => { await ref.current?.submit() })

    await waitFor(() => expect(ref.current?.isSubmitted).toBe(true))
    expect(screen.getByRole('alert')).toHaveTextContent(/submitted in another tab/i)
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Older saved answer')
    const recovery = JSON.parse(String(window.localStorage.getItem(
      'assignment-draft:student-1:assignment-1'
    )))
    expect(recovery.content).toEqual(latestDraft)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/submit'))).toBe(false)

    await act(async () => { await ref.current?.unsubmit() })
    expect(ref.current?.isSubmitted).toBe(false)
    expect(screen.getByTestId('editor-content')).toHaveTextContent('Latest unsaved answer')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/preserved local draft was restored/i)
  })

  it('requires reload when a submit conflict cannot refresh the saved document', async () => {
    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        docReads += 1
        if (docReads > 1) {
          return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }
        }
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'Your saved draft changed before submission.' }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await act(async () => {
      await ref.current?.submit()
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be reloaded.*reload/i)
  })

  it('bounds a hung submit request', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return { ok: true, status: 200, json: async () => new Promise(() => undefined) }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await act(async () => {
      await ref.current?.submit()
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/submission timed out/i)
  })

  it('reconciles a committed submission after its response is lost', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    let requestTimeoutCount = 0
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000 && requestTimeoutCount++ === 0) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (
        url.endsWith('/assignment-docs/assignment-1')
        && (!init?.method || init.method === 'GET')
      ) {
        docReads += 1
        const submitted = docReads > 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              is_submitted: submitted,
              submitted_at: submitted ? '2026-07-01T12:01:00.000Z' : null,
              updated_at: submitted
                ? '2026-07-01T12:01:00.000Z'
                : makeDoc().updated_at,
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/submit')) {
        return new Promise(() => undefined)
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await act(async () => { await ref.current?.submit() })

    expect(ref.current?.isSubmitted).toBe(true)
    expect(screen.queryByText(/submission timed out/i)).not.toBeInTheDocument()
    expect(docReads).toBe(2)
  })

  it('bounds a hung unsubmit request', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (
        url.endsWith('/assignment-docs/assignment-1')
        && (!init?.method || init.method === 'GET')
      ) {
        docReads += 1
        if (docReads > 1) return new Promise(() => undefined)
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              is_submitted: true,
              submitted_at: '2026-07-01T12:01:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/unsubmit')) {
        return { ok: true, status: 200, json: async () => new Promise(() => undefined) }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await act(async () => { await ref.current?.unsubmit() })

    expect(screen.getByRole('alert')).toHaveTextContent(/unsubmit timed out/i)
    expect(ref.current?.submitting).toBe(false)
  })

  it('reconciles a committed unsubmit after its response is lost', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    let requestTimeoutCount = 0
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000 && requestTimeoutCount++ === 0) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)

    let docReads = 0
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) return { ok: true, json: async () => ({ history: [] }) }
      if (
        url.endsWith('/assignment-docs/assignment-1')
        && (!init?.method || init.method === 'GET')
      ) {
        docReads += 1
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: {
              ...makeDoc(),
              is_submitted: docReads === 1,
              submitted_at: docReads === 1 ? '2026-07-01T12:01:00.000Z' : null,
              updated_at: docReads === 1
                ? '2026-07-01T12:01:00.000Z'
                : '2026-07-01T12:02:00.000Z',
            },
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/unsubmit')) {
        return new Promise(() => undefined)
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const ref = createRef<StudentAssignmentEditorHandle>()
    render(
      <StudentAssignmentEditor
        ref={ref}
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await act(async () => { await ref.current?.unsubmit() })

    expect(ref.current?.isSubmitted).toBe(false)
    expect(screen.queryByText(/unsubmit timed out/i)).not.toBeInTheDocument()
    expect(docReads).toBe(2)
  })

  it('saves a debounce-pending draft before restoring history', async () => {
    const operations: string[] = []
    const patchBodies: any[] = []
    const historyEntry = {
      id: 'history-1',
      assignment_doc_id: 'doc-1',
      patch: null,
      snapshot: savedDraft,
      word_count: 3,
      char_count: 18,
      paste_word_count: 0,
      keystroke_count: 0,
      trigger: 'autosave',
      created_at: '2026-07-01T11:00:00.000Z',
    }
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [historyEntry] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        operations.push('save')
        patchBodies.push(body)
        return {
          ok: true,
          json: async () => ({
            doc: { ...makeDoc(), content: body.content, updated_at: '2026-07-01T12:01:00.000Z' },
            historyEntry: null,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/restore')) {
        operations.push('restore')
        return {
          ok: true,
          json: async () => ({
            doc: {
              ...makeDoc(),
              content: savedDraft,
              updated_at: '2026-07-01T12:02:00.000Z',
            },
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getAllByRole('button', { name: 'Select saved version' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    const restoreDialog = screen.getByRole('dialog', { name: 'Restore this version?' })
    expect(restoreDialog).toHaveAttribute('aria-modal', 'true')
    await user.click(within(restoreDialog).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(operations).toEqual(['save', 'restore']))
    expect(patchBodies[0].content).toEqual(latestDraft)
  })

  it('bounds a hung history restore request', async () => {
    const nativeSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 15000) {
        queueMicrotask(() => typeof callback === 'function' && callback(...args))
        return 999 as any
      }
      return nativeSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout)
    const historyEntry = {
      id: 'history-1',
      assignment_doc_id: 'doc-1',
      patch: null,
      snapshot: savedDraft,
      word_count: 3,
      char_count: 18,
      paste_word_count: 0,
      keystroke_count: 0,
      trigger: 'autosave',
      created_at: '2026-07-01T11:00:00.000Z',
    }
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [historyEntry] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1/restore')) {
        return { ok: true, status: 200, json: async () => new Promise(() => undefined) }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getAllByRole('button', { name: 'Select saved version' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    const restoreDialog = screen.getByRole('dialog', { name: 'Restore this version?' })
    expect(restoreDialog).toHaveAttribute('aria-modal', 'true')
    await user.click(within(restoreDialog).getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/restore timed out/i)
    })
  })

  it('waits for an in-flight save before restoring history', async () => {
    let resolveSave: ((response: any) => void) | undefined
    const saveResponse = new Promise<any>((resolve) => {
      resolveSave = resolve
    })
    let restoreCalls = 0
    const patchBodies: any[] = []
    const historyEntry = {
      id: 'history-1',
      assignment_doc_id: 'doc-1',
      patch: null,
      snapshot: savedDraft,
      word_count: 3,
      char_count: 18,
      paste_word_count: 0,
      keystroke_count: 0,
      trigger: 'autosave',
      created_at: '2026-07-01T11:00:00.000Z',
    }
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [historyEntry] }) }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }
      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)))
        return saveResponse
      }
      if (url.endsWith('/assignment-docs/assignment-1/restore')) {
        restoreCalls += 1
        return {
          ok: true,
          json: async () => ({
            doc: {
              ...makeDoc(),
              content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored answer' }] }],
              },
              updated_at: '2026-07-01T12:05:00.000Z',
            },
          }),
        }
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Record keystroke' }))
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(screen.getByText('Saving...')).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: 'Select saved version' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    const restoreDialog = screen.getByRole('dialog', { name: 'Restore this version?' })
    expect(restoreDialog).toHaveAttribute('aria-modal', 'true')
    await user.click(within(restoreDialog).getByRole('button', { name: 'Restore' }))

    expect(restoreCalls).toBe(0)

    resolveSave?.({
      ok: true,
      json: async () => ({ doc: { ...makeDoc(), content: latestDraft }, historyEntry: null }),
    })

    await waitFor(() => expect(restoreCalls).toBe(1))
    await waitFor(() => {
      expect(screen.getByTestId('editor-content')).toHaveTextContent('Restored answer')
    })
    await user.click(screen.getByRole('button', { name: 'Edit older response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))
    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[0].keystroke_count).toBe(1)
    expect(patchBodies[1].keystroke_count).toBe(0)
  })

  it('keeps a background autosave rejection visible and handled', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/history')) {
        return { ok: true, json: async () => ({ history: [] }) }
      }

      if (url.endsWith('/assignment-docs/assignment-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            assignment: makeAssignment(),
            doc: makeDoc(),
            feedback_entries: [],
            submission_requirements: [],
            submission_artifacts: [],
            wasFirstView: false,
          }),
        }
      }

      if (url.endsWith('/assignment-docs/assignment-1') && init?.method === 'PATCH') {
        return { ok: false, json: async () => ({ error: 'Save service unavailable' }) }
      }

      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const user = userEvent.setup()
    render(
      <StudentAssignmentEditor
        classroomId="classroom-1"
        assignmentId="assignment-1"
        variant="embedded"
      />,
    )

    await screen.findByText('Assignment Title')
    await user.click(screen.getByRole('button', { name: 'Edit response' }))
    await user.click(screen.getByRole('button', { name: 'Blur response' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Save service unavailable')
    })
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/submit'))).toHaveLength(0)
  })
})
