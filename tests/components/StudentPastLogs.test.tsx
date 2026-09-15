import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StudentPastLogs } from '@/app/classrooms/[classroomId]/StudentPastLogs'
import type { Entry } from '@/types'

const logs = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-09-${String(14 - index).padStart(2, '0')}`,
  entry: { id: `entry-${index}`, text: `Student log ${index}` } as Entry,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('StudentPastLogs', () => {
  it('pages through every log, collapses on page changes, and adapts to resizing', () => {
    let availableHeight = 270
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.tagName === 'SECTION' ? window.innerHeight - availableHeight : 0, bottom: window.innerHeight, height: this.tagName === 'HEADER' ? 45 : 0 } as DOMRect
    })
    let resize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    render(<StudentPastLogs logs={logs} />)
    expect(screen.getByText('1–3 of 10')).toBeInTheDocument()
    expect(screen.queryByText('Student log 3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand log from Mon Sep 14' }))
    expect(screen.getByRole('button', { name: 'Collapse log from Mon Sep 14' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    expect(screen.getByText('4–6 of 10')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    expect(screen.getByText('Student log 9')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }))
    expect(screen.getByRole('button', { name: 'Expand log from Mon Sep 14' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Older' }))
    availableHeight = 900
    act(() => resize())
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByText('Student log 9')).toBeInTheDocument()
  })

  it('preserves missing-log and empty states', () => {
    const view = render(<StudentPastLogs logs={[{ date: '2026-09-14', entry: null }]} />)
    expect(screen.getByText('No log submitted')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(<StudentPastLogs logs={[]} />)
    expect(screen.getByText('No past logs yet')).toBeInTheDocument()
  })
})
