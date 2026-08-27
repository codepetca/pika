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
  entry('third', '2025-01-20T02:05:00Z', 120, 720),
  entry('second', '2025-01-20T01:10:00Z', 60, 360),
  entry('first', '2025-01-20T01:00:00Z', 20, 120),
]

const lifecycle = {
  startAt: '2025-01-10T14:00:00Z',
  dueAt: '2025-01-20T03:00:00Z',
  submittedAt: null,
}

describe('HistoryGraph', () => {
  it('shows a calm empty state when no saves exist yet', () => {
    render(
      <HistoryGraph
        entries={[]}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="student"
        lifecycle={lifecycle}
      />
    )

    expect(screen.getByRole('region', { name: 'Version history' })).toBeInTheDocument()
    expect(screen.getByText('No saves yet')).toBeInTheDocument()
  })

  it('shows every teacher save in one compact full-lifecycle chart', () => {
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
        lifecycle={lifecycle}
      />
    )

    expect(screen.getByRole('region', { name: 'Student activity' })).toBeInTheDocument()
    expect(screen.getByText('3 saves · 2 work sessions')).toBeInTheDocument()
    expect(screen.getAllByRole('slider', { name: 'Complete save history' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.getByText((_content, element) => (
      element?.tagName === 'SPAN' && element.textContent === 'AssignedJan 10'
    ))).toBeInTheDocument()
    expect(screen.getByText((_content, element) => (
      element?.tagName === 'SPAN' && element.textContent === 'DueJan 19'
    ))).toBeInTheDocument()
  })

  it('uses student language without duplicating a caller-owned heading', () => {
    render(
      <HistoryGraph
        entries={entries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="student"
        showHeading={false}
        lifecycle={lifecycle}
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
        lifecycle={lifecycle}
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
        lifecycle={lifecycle}
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
})
