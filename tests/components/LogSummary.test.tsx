import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    const onAvailabilityChange = vi.fn()
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
      <LogSummary
        classroomId="classroom-1"
        date="2026-05-05"
        onAvailabilityChange={onAvailabilityChange}
      />
    )

    rerender(
      <LogSummary
        classroomId="classroom-2"
        date="2026-05-07"
        onAvailabilityChange={onAvailabilityChange}
      />
    )

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
    expect(onAvailabilityChange).toHaveBeenLastCalledWith(false)
  })

  it('shows only a compact Nothing urgent summary without boilerplate or timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockJson({
      summary: { overview: 'No high-priority items were identified by this automated summary.', action_items: [], generated_at: '2026-05-05T14:36:00.000Z' },
      summary_status: 'ready',
    })))
    render(<LogSummary classroomId="classroom-1" date="2026-05-05" />)
    const toggle = await screen.findByRole('button', { name: /Summary: Nothing urgent/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/No high-priority|Today/)).not.toBeInTheDocument()
  })

  it('surfaces questions inline and expands/collapses while keeping student log actions separate', async () => {
    const onStudentClick = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => mockJson({
      summary: { overview: 'Follow-ups identified.', action_items: [
        { studentName: 'Student One', text: 'Student One has a question.' },
        { studentName: 'Student Two', text: 'Student Two reported an urgent wellbeing concern.' },
      ], generated_at: '2026-05-05T14:36:00.000Z' },
      summary_status: 'ready',
    })))
    const { rerender } = render(<LogSummary classroomId="classroom-1" date="2026-05-05" onStudentClick={onStudentClick} />)
    const toggle = await screen.findByRole('button', { name: /Summary: Student One has a question/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.querySelector('[data-summary-text]')).toHaveClass('line-clamp-3')
    fireEvent.click(toggle)
    const expandedToggle = screen.getByRole('button', { name: 'Summary: Collapse summary' })
    expect(expandedToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Student One' }))
    expect(onStudentClick).toHaveBeenCalledWith('Student One')
    expect(expandedToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByText(/reported an urgent wellbeing concern/))
    expect(screen.getByRole('button', { name: /Summary: Student One has a question/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: /Summary: Student One has a question/ }))
    rerender(<LogSummary classroomId="classroom-1" date="2026-05-06" onStudentClick={onStudentClick} />)
    expect(await screen.findByRole('button', { name: /Summary: Student One has a question/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('explains when a summary is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockJson({ summary: null, summary_status: 'unavailable' })))
    render(<LogSummary classroomId="classroom-1" date="2026-05-05" />)
    expect(await screen.findByText('Summary is not available for this date.')).toBeInTheDocument()
  })
})
