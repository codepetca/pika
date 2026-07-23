import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'

vi.mock('@/components/StudentTestForm', () => ({
  StudentTestForm: ({ questions }: { questions: Array<{ question_text?: string }> }) => (
    <div>{questions.map((question) => question.question_text).join(', ')}</div>
  ),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response
}

describe('TeacherTestPreviewPage', () => {
  it('keeps a refreshed preview when an older request resolves later', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    })
    const initialRequest = deferred<Response>()
    const refreshedRequest = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(refreshedRequest.promise)
    vi.stubGlobal('fetch', fetchMock)

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
        jsonResponse({
          test: { title: 'Refreshed Test' },
          questions: [{ id: 'question-2', question_text: 'Current question' }],
        }),
      )
    })

    expect(await screen.findByRole('heading', { name: 'Refreshed Test' })).toBeVisible()
    expect(screen.getByText('Current question')).toBeVisible()

    await act(async () => {
      initialRequest.resolve(
        jsonResponse({
          test: { title: 'Stale Test' },
          questions: [{ id: 'question-1', question_text: 'Stale question' }],
        }),
      )
    })

    expect(screen.getByRole('heading', { name: 'Refreshed Test' })).toBeVisible()
    expect(screen.getByText('Current question')).toBeVisible()
    expect(screen.queryByText('Stale question')).not.toBeInTheDocument()
  })
})
