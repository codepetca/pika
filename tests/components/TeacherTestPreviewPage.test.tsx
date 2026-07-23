import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'

vi.mock('@/components/StudentTestForm', () => ({
  StudentTestForm: ({
    questions,
    testId,
  }: {
    questions: Array<{ question_text?: string }>
    testId: string
  }) => (
    <div data-testid="student-test-form">
      {testId}:{questions.map((question) => question.question_text).join('|')}
    </div>
  ),
}))

vi.mock('@/components/TestTextDocumentViewer', () => ({
  TestTextDocumentViewer: ({ content }: { content: string }) => (
    <div data-testid="text-document-viewer">{content}</div>
  ),
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function previewResponse({
  documents = [],
  question = 'Question',
  title = 'Test Preview',
}: {
  documents?: unknown[]
  question?: string
  title?: string
}) {
  return {
    ok: true,
    json: async () => ({
      test: {
        title,
        documents,
      },
      questions: [
        {
          id: 'question-1',
          question_text: question,
          question_type: 'multiple_choice',
          options: ['A', 'B'],
          position: 0,
        },
      ],
    }),
  }
}

const originalFullscreenElement = Object.getOwnPropertyDescriptor(
  document,
  'fullscreenElement',
)
const originalRequestFullscreen = Object.getOwnPropertyDescriptor(
  document.documentElement,
  'requestFullscreen',
)
const originalMoveTo = Object.getOwnPropertyDescriptor(window, 'moveTo')
const originalResizeTo = Object.getOwnPropertyDescriptor(window, 'resizeTo')

describe('TeacherTestPreviewPage', () => {
  let fullscreenElement: Element | null

  beforeEach(() => {
    fullscreenElement = document.documentElement
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })
    Object.defineProperty(window, 'moveTo', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window, 'resizeTo', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.style.overflow = ''

    if (originalFullscreenElement) {
      Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement)
    } else {
      delete (document as Document & { fullscreenElement?: Element | null })
        .fullscreenElement
    }

    if (originalRequestFullscreen) {
      Object.defineProperty(
        document.documentElement,
        'requestFullscreen',
        originalRequestFullscreen,
      )
    } else {
      delete (
        document.documentElement as HTMLElement & {
          requestFullscreen?: () => Promise<void>
        }
      ).requestFullscreen
    }

    if (originalMoveTo) {
      Object.defineProperty(window, 'moveTo', originalMoveTo)
    } else {
      delete (window as Window & { moveTo?: Window['moveTo'] }).moveTo
    }
    if (originalResizeTo) {
      Object.defineProperty(window, 'resizeTo', originalResizeTo)
    } else {
      delete (window as Window & { resizeTo?: Window['resizeTo'] }).resizeTo
    }
  })

  it('does not let an older test request repaint a newly selected preview', async () => {
    const testA = deferred<ReturnType<typeof previewResponse>>()
    const testB = deferred<ReturnType<typeof previewResponse>>()
    const fetchMock = vi.mocked(fetch)
      .mockReturnValueOnce(testA.promise as ReturnType<typeof fetch>)
      .mockReturnValueOnce(testB.promise as ReturnType<typeof fetch>)

    const { rerender } = render(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-a"
        embedded
      />,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/test-a', {
        cache: 'no-store',
      })
    })

    rerender(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-b"
        embedded
      />,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/test-b', {
        cache: 'no-store',
      })
    })

    await act(async () => {
      testB.resolve(previewResponse({ title: 'Test B', question: 'Question B' }))
      await testB.promise
    })

    expect(await screen.findByRole('heading', { name: 'Test B' })).toBeInTheDocument()
    expect(screen.getByTestId('student-test-form')).toHaveTextContent(
      'test-b:Question B',
    )

    await act(async () => {
      testA.resolve(previewResponse({ title: 'Test A', question: 'Question A' }))
      await testA.promise
    })

    expect(screen.getByRole('heading', { name: 'Test B' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Test A' })).not.toBeInTheDocument()
    expect(screen.getByTestId('student-test-form')).toHaveTextContent(
      'test-b:Question B',
    )
  })

  it('keeps a refreshed preview when an older same-test request resolves later', async () => {
    const initialRequest = deferred<ReturnType<typeof previewResponse>>()
    const refreshedRequest = deferred<ReturnType<typeof previewResponse>>()
    const fetchMock = vi.mocked(fetch)
      .mockReturnValueOnce(initialRequest.promise as ReturnType<typeof fetch>)
      .mockReturnValueOnce(refreshedRequest.promise as ReturnType<typeof fetch>)

    render(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-1"
        embedded
        listenForUpdates
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    window.dispatchEvent(
      new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, {
        detail: { classroomId: 'classroom-1' },
      }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    await act(async () => {
      refreshedRequest.resolve(
        previewResponse({
          title: 'Refreshed Test',
          question: 'Current question',
        }),
      )
      await refreshedRequest.promise
    })

    expect(await screen.findByRole('heading', { name: 'Refreshed Test' })).toBeVisible()
    expect(screen.getByTestId('student-test-form')).toHaveTextContent(
      'test-1:Current question',
    )

    await act(async () => {
      initialRequest.resolve(
        previewResponse({
          title: 'Stale Test',
          question: 'Stale question',
        }),
      )
      await initialRequest.promise
    })

    expect(screen.getByRole('heading', { name: 'Refreshed Test' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Stale Test' })).not.toBeInTheDocument()
    expect(screen.getByTestId('student-test-form')).toHaveTextContent(
      'test-1:Current question',
    )
  })

  it('does not sync the previous test documents under a new test owner', async () => {
    const testB = deferred<ReturnType<typeof previewResponse>>()
    const testASync = deferred<ReturnType<typeof previewResponse>>()
    const fetchMock = vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/teacher/tests/test-a') {
        return Promise.resolve(previewResponse({
          title: 'Test A',
          documents: [{
            id: 'document-a',
            title: 'Test A reference',
            source: 'link',
            url: 'https://example.com/test-a',
          }],
        })) as ReturnType<typeof fetch>
      }
      if (url === '/api/teacher/tests/test-a/documents/document-a/sync') {
        return testASync.promise as ReturnType<typeof fetch>
      }
      if (url === '/api/teacher/tests/test-b') {
        return testB.promise as ReturnType<typeof fetch>
      }
      return Promise.reject(new Error(`Unexpected preview request: ${url}`))
    })

    const { rerender } = render(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-a"
        embedded
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Test A' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-a/documents/document-a/sync',
        { method: 'POST' },
      )
    })

    rerender(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-b"
        embedded
      />,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/test-b', {
        cache: 'no-store',
      })
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/teacher/tests/test-b/documents/document-a/sync',
      { method: 'POST' },
    )

    await act(async () => {
      testB.resolve(previewResponse({ title: 'Test B', question: 'Question B' }))
      testASync.resolve(previewResponse({ title: 'Test A' }))
      await Promise.all([testB.promise, testASync.promise])
    })

    expect(await screen.findByRole('heading', { name: 'Test B' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/teacher/tests/test-b/documents/document-a/sync',
      { method: 'POST' },
    )
  })

  it('moves focus into a document and restores it to the trigger on return', async () => {
    vi.mocked(fetch).mockResolvedValue(
      previewResponse({
        documents: [
          {
            id: 'document-1',
            title: 'Reference sheet',
            source: 'text',
            content: 'Reference content',
          },
        ],
      }) as Awaited<ReturnType<typeof fetch>>,
    )

    render(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-1"
        embedded
      />,
    )

    const documentButton = await screen.findByRole('button', {
      name: 'Reference sheet',
    })
    fireEvent.click(documentButton)

    const backButton = screen.getByRole('button', {
      name: 'Back to documents list',
    })
    await waitFor(() => {
      expect(backButton).toHaveFocus()
    })
    expect(screen.getByTestId('text-document-viewer')).toHaveTextContent(
      'Reference content',
    )

    fireEvent.click(backButton)

    await waitFor(() => {
      expect(documentButton).toHaveFocus()
    })
  })

  it('renders a framed preview region and delegates embedded close', async () => {
    vi.mocked(fetch).mockResolvedValue(
      previewResponse({ title: 'Framed Test' }) as Awaited<ReturnType<typeof fetch>>,
    )
    const onClose = vi.fn()

    render(
      <TeacherTestPreviewPage
        classroomId="classroom-1"
        testId="test-1"
        embedded
        onClose={onClose}
      />,
    )

    expect(
      await screen.findByRole('region', { name: 'Teacher test preview' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
