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
    vi.restoreAllMocks()
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
    await screen.findByText(/Nothing urgent/)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Summary')).toHaveClass('text-primary')
    expect(screen.getByText('Summary')).not.toHaveClass('bg-info-bg')
    expect(screen.getByText('Summary')).not.toHaveTextContent(':')
    expect(screen.queryByText(/No high-priority|Today/)).not.toBeInTheDocument()
  })

  it('surfaces questions inline and expands/collapses while keeping student log actions separate', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40)
    const onStudentClick = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => mockJson({
      summary: { overview: 'Follow-ups identified.', action_items: [
        { studentName: 'Avery Morgan', text: 'Avery Morgan has a question.', detail: 'asks whether the lab report needs a graph.' },
        { studentName: 'Jordan Lee', text: 'Jordan Lee reported an urgent wellbeing concern.', detail: 'reports an injury that prevents taking part in the lab.' },
      ], generated_at: '2026-05-05T14:36:00.000Z' },
      summary_status: 'ready',
    })))
    const { rerender } = render(<LogSummary classroomId="classroom-1" date="2026-05-05" onStudentClick={onStudentClick} />)
    const toggle = await screen.findByRole('button', { name: 'Expand summary' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.closest('[data-summary-text]')).toHaveClass('line-clamp-2')
    fireEvent.click(screen.getByRole('button', { name: 'Go to Avery Morgan in student table' }))
    expect(onStudentClick).toHaveBeenCalledWith('Avery Morgan')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    const expandedToggle = screen.getByRole('button', { name: 'Collapse summary' })
    expect(expandedToggle).toHaveAttribute('aria-expanded', 'true')
    expect(expandedToggle.closest('[data-summary-text]')).toHaveTextContent('Avery asks whether the lab report needs a graph.')
    expect(expandedToggle.closest('[data-summary-text]')).toHaveTextContent('Jordan reports an injury that prevents taking part in the lab.')
    fireEvent.click(screen.getByRole('button', { name: 'Go to Avery Morgan in student table' }))
    expect(onStudentClick).toHaveBeenCalledWith('Avery Morgan')
    expect(expandedToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByText(/reports an injury that prevents taking part/))
    expect(screen.getByRole('button', { name: 'Expand summary' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Expand summary' }))
    rerender(<LogSummary classroomId="classroom-1" date="2026-05-06" onStudentClick={onStudentClick} />)
    expect(await screen.findByRole('button', { name: 'Expand summary' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows a fitting summary without disclosure and preserves multiword first names', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockJson({ summary_status: 'ready', summary: {
      action_items: [{ studentName: 'Mary Jane Smith', text: 'Mary Jane Smith has a question.', detail: 'Asks when the project is due.' }],
    } })))
    render(<LogSummary classroomId="classroom-1" date="2026-05-05" firstNames={{ 'Mary Jane Smith': 'Mary Jane' }} />)
    expect(await screen.findByText(/Mary Jane asks when the project is due/)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/Smith/)).not.toBeInTheDocument()
  })

  it('adds and removes disclosure as the summary overflows after resizing', async () => {
    let height = 60
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40)
    vi.stubGlobal('fetch', vi.fn(() => mockJson({ summary_status: 'ready', summary: {
      action_items: [{ studentName: 'Avery Morgan', text: 'Avery Morgan has a question.', detail: 'Asks when the project is due.' }],
    } })))
    render(<LogSummary classroomId="classroom-1" date="2026-05-05" />)
    expect(await screen.findByRole('button', { name: 'Expand summary' })).toHaveAttribute('aria-expanded', 'false')
    height = 20
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    height = 60
    fireEvent(window, new Event('resize'))
    expect(await screen.findByRole('button', { name: 'Expand summary' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each(['outside', 'internally scrolled'])('reveals a %s keyboard-focused name while retaining the same action', async (mode) => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40)
    const onStudentClick = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => mockJson({ summary_status: 'ready', summary: {
      action_items: [
        { studentName: 'Avery Morgan', text: '', detail: 'asks about the lab report.' },
        { studentName: 'Avery Lee', text: '', detail: 'asks about the deadline.' },
      ],
    } })))
    render(<LogSummary classroomId="classroom-1" date="2026-05-05" onStudentClick={onStudentClick} />)
    const toggle = await screen.findByRole('button', { name: 'Expand summary' })
    const text = toggle.closest('[data-summary-text]')!
    const name = screen.getByRole('button', { name: 'Go to Avery Lee in student table' })
    name.scrollIntoView = vi.fn()
    text.scrollTop = mode === 'internally scrolled' ? 140 : 0
    vi.spyOn(text, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect)
    vi.spyOn(name, 'getBoundingClientRect').mockReturnValue(mode === 'internally scrolled'
      ? { top: 20, bottom: 40, height: 20 } as DOMRect
      : { top: 60, bottom: 80, height: 20 } as DOMRect)
    fireEvent.focus(name)
    expect(screen.getByRole('button', { name: 'Collapse summary' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Go to Avery Lee in student table' })).toBe(name)
    expect(name.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    fireEvent.click(name)
    expect(onStudentClick).toHaveBeenCalledWith('Avery Lee')
  })

  it('explains when a summary is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mockJson({ summary: null, summary_status: 'unavailable' })))
    render(<LogSummary classroomId="classroom-1" date="2026-05-05" />)
    expect(await screen.findByText('Summary is not available for this date.')).toBeInTheDocument()
  })
})
