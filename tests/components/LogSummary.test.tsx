import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
    vi.useRealTimers()
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

  it('aligns summary copy with its title and omits internal horizontal rules', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T15:00:00.000Z'))
    vi.stubGlobal('fetch', vi.fn(() => mockJson({
      summary: {
        overview: 'Students reflected on their project progress.',
        action_items: [{
          studentName: 'Student One',
          text: 'Student One needs support with the final section.',
        }],
        generated_at: '2026-05-05T14:36:00.000Z',
      },
      summary_status: 'ready',
    })))

    render(<LogSummary classroomId="classroom-1" date="2026-05-05" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const overview = screen.getByText('Students reflected on their project progress.')
    const summaryContent = overview.parentElement
    const generatedAt = screen.getByText('Today 10:36 AM')

    expect(summaryContent).toHaveClass('px-3')
    expect(summaryContent).not.toHaveClass('p-4')
    expect(generatedAt).not.toHaveClass('border-t', 'border-border')
    expect(screen.queryByText('Needs Attention')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Class log follow-ups' })).toBeInTheDocument()
    expect(screen.getByText(/Student One needs support/)).toBeInTheDocument()
  })

  it('explains when a legacy broad summary has been retired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockJson({
      summary: null,
      summary_status: 'unavailable',
    })))

    render(<LogSummary classroomId="classroom-1" date="2026-05-05" />)

    expect(await screen.findByText(
      'A high-priority automated summary is not available for this date.'
    )).toBeInTheDocument()
  })
})
