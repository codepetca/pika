import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { LogSummary } from '@/app/classrooms/[classroomId]/LogSummary'

function mockJson(data: unknown, ok = true) {
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

describe('LogSummary', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('ignores an older classroom summary response after switching classrooms', async () => {
    const firstRequest = deferred<any>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/teacher/log-summary?classroom_id=classroom-1&date=2026-05-05') {
        return firstRequest.promise
      }
      if (url === '/api/teacher/log-summary?classroom_id=classroom-2&date=2026-05-07') {
        return mockJson({
          summary: null,
          summary_status: 'pending',
        })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(
      <LogSummary classroomId="classroom-1" date="2026-05-05" />
    )

    rerender(<LogSummary classroomId="classroom-2" date="2026-05-07" />)

    expect(await screen.findByText('Summary will be available after the nightly run.')).toBeInTheDocument()

    firstRequest.resolve(await mockJson({
      summary: {
        overview: 'Old summary should stay hidden.',
        action_items: [],
        generated_at: '2026-05-05T12:00:00.000Z',
      },
      summary_status: 'ready',
    }))

    await waitFor(() => {
      expect(screen.queryByText('Old summary should stay hidden.')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Summary will be available after the nightly run.')).toBeInTheDocument()
  })
})
