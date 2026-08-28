import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryGraph } from '@/components/HistoryGraph'
import type { AssignmentDocHistoryEntry } from '@/types'

function entry(
  id: string,
  createdAt: string,
  wordCount: number,
  charCount: number
): AssignmentDocHistoryEntry {
  return {
    id,
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: null,
    word_count: wordCount,
    char_count: charCount,
    paste_word_count: null,
    keystroke_count: null,
    trigger: 'autosave',
    created_at: createdAt,
  }
}

const entries = [
  entry('third', '2025-01-20T02:05:00Z', 50, 300),
  entry('second', '2025-01-20T01:10:00Z', 60, 360),
  entry('first', '2025-01-20T01:00:00Z', 20, 120),
]

const multiWeekEntries = Array.from({ length: 20 }, (_, index) => {
  const chronologicalIndex = 19 - index
  const day = Math.floor(chronologicalIndex / 2)
  const save = chronologicalIndex % 2
  return entry(
    `long-${chronologicalIndex}`,
    new Date(Date.UTC(2025, 0, 1 + day, 15 + save)).toISOString(),
    20 + chronologicalIndex * 10,
    100 + chronologicalIndex * 50
  )
})

describe('HistoryGraph', () => {
  it('shows a calm empty state when no saves exist yet', () => {
    render(
      <HistoryGraph
        entries={[]}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="student"
      />
    )

    expect(screen.getByRole('region', { name: 'Version history' })).toBeInTheDocument()
    expect(screen.getByText('No saves yet')).toBeInTheDocument()
  })

  it('shows additions and deletions across the actual activity days with minimal copy', () => {
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    expect(screen.getByRole('region', { name: 'Student activity' })).toBeInTheDocument()
    expect(screen.getAllByRole('slider', { name: 'Complete save history' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/work session/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/assigned|due|submitted/i)).not.toBeInTheDocument()
    expect(screen.getByText('Jan 19')).toBeInTheDocument()

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    expect(chart).toHaveAttribute('aria-valuetext', expect.stringContaining('-60 characters since previous'))
    expect(chart.querySelectorAll('[data-change-direction="up"]')).toHaveLength(1)
    expect(chart.querySelectorAll('[data-change-direction="down"]')).toHaveLength(1)

    const largestAddition = chart.querySelector('[data-change-value="240"]')
    const deletion = chart.querySelector('[data-change-value="60"]')
    expect(Number(largestAddition?.getAttribute('y1')) - Number(largestAddition?.getAttribute('y2')))
      .toBe(28)
    expect(Number(deletion?.getAttribute('y2')) - Number(deletion?.getAttribute('y1')))
      .toBe(7)
  })

  it('fits multi-week work by day and zooms into individual saves', () => {
    render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
        showHeading={false}
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    expect(chart).toHaveAttribute('data-view-mode', 'daily')
    expect(chart.querySelectorAll('[data-activity-day]')).toHaveLength(10)
    expect(screen.getByText('Showing all activity')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out history' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))

    expect(chart).toHaveAttribute('data-view-mode', 'saves')
    expect(screen.getByText('Showing 7 days')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out history' })).toBeEnabled()
  })

  it('uses student language without duplicating a caller-owned heading', () => {
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="student"
        showHeading={false}
      />
    )

    expect(screen.getByRole('region', { name: 'Version history' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Version history' })).not.toBeInTheDocument()
  })

  it('supports arrow, Home, and End navigation across the complete history', () => {
    const onEntryClick = vi.fn()
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId="first"
        onEntryClick={onEntryClick}
        audience="teacher"
      />
    )

    const slider = screen.getByRole('slider', { name: 'Complete save history' })
    expect(slider).toHaveAttribute('aria-valuenow', '1')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'second' }))

    fireEvent.keyDown(slider, { key: 'End' })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'third' }))

    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'first' }))
  })

  it('previews and pins the nearest save from the same chart', () => {
    const onEntryClick = vi.fn()
    const onEntryHover = vi.fn()
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId={null}
        onEntryClick={onEntryClick}
        onEntryHover={onEntryHover}
        audience="teacher"
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      right: 1000,
      bottom: 78,
      height: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.mouseMove(chart, { clientX: 990 })
    expect(onEntryHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'third' }))

    fireEvent.click(chart, { clientX: 990 })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'third' }))
  })

  it('does not carry a hovered position into a replacement history', () => {
    const onEntryHover = vi.fn()
    const { rerender } = render(
      <HistoryGraph
        entries={entries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        onEntryHover={onEntryHover}
        audience="teacher"
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      right: 1000,
      bottom: 78,
      height: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.mouseMove(chart, { clientX: 990 })
    expect(onEntryHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'third' }))

    const replacementEntries = [
      entry('replacement', '2025-01-20T02:30:00Z', 15, 90),
    ]
    rerender(
      <HistoryGraph
        entries={replacementEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        onEntryHover={onEntryHover}
        audience="teacher"
      />
    )

    expect(screen.queryByText('No saves yet')).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Complete save history' }))
      .toHaveAttribute('aria-valuenow', '1')
    expect(screen.queryByRole('button', { name: 'Zoom in history' })).not.toBeInTheDocument()
  })
})
