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

  it('keeps tiny changes proportional and adds a separate visibility marker', () => {
    const proportionalEntries = [
      entry('tiny', '2025-01-20T03:00:00Z', 51, 301),
      ...entries,
    ]
    render(
      <HistoryGraph
        entries={proportionalEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    const tinyChange = chart.querySelector('[data-change-value="1"]')
    const tinyHeight = Number(tinyChange?.getAttribute('y1'))
      - Number(tinyChange?.getAttribute('y2'))

    expect(tinyHeight).toBeCloseTo(28 / 240)
    expect(chart.querySelector('[data-small-change-marker="up"]')).toBeInTheDocument()
  })

  it('uses a direction-neutral selection marker for a mixed daily overview', () => {
    const mixedDayEntries = [
      entry('selected-deletion', '2025-01-10T17:00:00Z', 42, 250),
      entry('large-addition', '2025-01-10T16:00:00Z', 84, 500),
      entry('baseline', '2025-01-01T16:00:00Z', 20, 100),
    ]
    render(
      <HistoryGraph
        entries={mixedDayEntries}
        activeEntryId="selected-deletion"
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    const selectedDay = chart.querySelector('[data-selected-day="true"]')

    expect(chart).toHaveAttribute('data-view-mode', 'daily')
    expect(selectedDay).toHaveAttribute('cy', '39')
    expect(selectedDay).toHaveAttribute('stroke', 'var(--color-text-default)')
  })

  it('distinguishes the baseline from a later save with no character-count change', () => {
    const zeroChangeEntries = [
      entry('unchanged', '2025-01-20T02:00:00Z', 20, 120),
      entry('baseline', '2025-01-20T01:00:00Z', 20, 120),
    ]
    const { rerender } = render(
      <HistoryGraph
        entries={zeroChangeEntries}
        activeEntryId="baseline"
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    expect(chart).toHaveAttribute('aria-valuetext', expect.stringContaining('first save'))

    rerender(
      <HistoryGraph
        entries={zeroChangeEntries}
        activeEntryId="unchanged"
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )
    expect(chart).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('no character-count change since previous')
    )
    expect(chart).not.toHaveAttribute('aria-valuetext', expect.stringContaining('first save'))
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

  it('supports horizontal and vertical arrows, Home, and End navigation', () => {
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

    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'second' }))

    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'first' }))

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

  it('keeps a pinned save stable on hover while still allowing a new click', () => {
    const onEntryClick = vi.fn()
    const onEntryHover = vi.fn()
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId="second"
        hoverEnabled={false}
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
    expect(onEntryHover).not.toHaveBeenCalled()
    expect(chart).toHaveAttribute('aria-valuenow', '2')

    fireEvent.click(chart, { clientX: 990 })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'third' }))
  })

  it('centers zoom on the latest save after a transient hover ends', () => {
    render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        onEntryHover={vi.fn()}
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

    fireEvent.mouseMove(chart, { clientX: 10 })
    fireEvent.mouseLeave(chart)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))

    expect(chart).toHaveAttribute('data-view-mode', 'saves')
    expect(screen.getByText('Jan 4')).toBeInTheDocument()
    expect(screen.queryByText('Jan 1')).not.toBeInTheDocument()
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
