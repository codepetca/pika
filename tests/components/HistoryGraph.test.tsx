import { act, fireEvent, render, screen } from '@testing-library/react'
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

const yearLongEntries = [
  entry('year-end', '2026-02-05T16:00:00Z', 200, 1200),
  entry('year-start', '2025-01-01T16:00:00Z', 20, 100),
]

const transitionEntries = [
  entry('day-final', '2025-01-10T19:00:00Z', 120, 700),
  entry('specific-save', '2025-01-10T17:00:00Z', 80, 450),
  entry('day-first', '2025-01-10T15:00:00Z', 40, 250),
  entry('transition-baseline', '2025-01-01T15:00:00Z', 20, 100),
]

function installAnimationFrameHarness() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId
    nextId += 1
    callbacks.set(id, callback)
    return id
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id)
  })

  return {
    request,
    cancel,
    step(timestamp: number) {
      act(() => {
        const queued = Array.from(callbacks.values())
        callbacks.clear()
        queued.forEach((callback) => callback(timestamp))
      })
    },
    restore() {
      request.mockRestore()
      cancel.mockRestore()
    },
  }
}

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

  it('renders a selected-day ring behind a tiny directional marker', () => {
    const selectedTinyEntries = [
      entry('selected-tiny', '2025-01-10T16:00:00Z', 220, 1101),
      entry('large-change', '2025-01-05T16:00:00Z', 220, 1100),
      entry('baseline', '2025-01-01T16:00:00Z', 20, 100),
    ]
    render(
      <HistoryGraph
        entries={selectedTinyEntries}
        activeEntryId="selected-tiny"
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    const selectedGroup = chart.querySelector('[data-activity-day="2025-01-10"]')
    const selectedRing = selectedGroup?.querySelector('[data-selected-day="true"]')
    const tinyMarker = selectedGroup?.querySelector('[data-small-change-marker="up"]')
    const children = Array.from(selectedGroup?.children ?? [])

    expect(selectedRing).toBeInTheDocument()
    expect(tinyMarker).toBeInTheDocument()
    expect(children.indexOf(selectedRing!)).toBeLessThan(children.indexOf(tinyMarker!))
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

  it('zooms with the wheel and pans a zoomed window horizontally', () => {
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

    fireEvent.wheel(chart, { deltaY: -100, clientX: 500 })

    expect(chart).toHaveAttribute('data-view-mode', 'saves')
    expect(screen.getByText('Showing 7 days')).toBeInTheDocument()
    const initialStart = Number(chart.getAttribute('data-visible-start-ms'))

    fireEvent.wheel(chart, { deltaY: -100, clientX: 500 })
    expect(screen.getByText('Showing 7 days')).toBeInTheDocument()

    fireEvent.wheel(chart, { deltaX: -500, deltaY: 0, clientX: 500 })

    expect(Number(chart.getAttribute('data-visible-start-ms'))).toBeLessThan(initialStart)
  })

  it('eases wheel zoom around the pointer position', () => {
    const frames = installAnimationFrameHarness()
    const { unmount } = render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
        showHeading={false}
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
    const initialStart = Number(chart.getAttribute('data-rendered-start-ms'))
    const initialEnd = Number(chart.getAttribute('data-rendered-end-ms'))

    fireEvent.wheel(chart, { deltaY: -100, clientX: 250 })

    const targetStart = Number(chart.getAttribute('data-visible-start-ms'))
    const targetEnd = Number(chart.getAttribute('data-visible-end-ms'))

    expect(chart.querySelector('[data-history-view-layer="daily"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(chart.querySelector('[data-history-view-layer="saves"]')).toHaveAttribute(
      'aria-hidden',
      'false',
    )
    expect(Number(chart.getAttribute('data-rendered-start-ms'))).toBe(initialStart)
    expect(Number(chart.getAttribute('data-rendered-end-ms'))).toBe(initialEnd)

    frames.step(0)
    frames.step(210)

    expect(Number(chart.getAttribute('data-rendered-start-ms')))
      .toBeCloseTo((initialStart + targetStart) / 2)
    expect(Number(chart.getAttribute('data-rendered-end-ms')))
      .toBeCloseTo((initialEnd + targetEnd) / 2)
    expect(chart).toHaveAttribute('data-zoom-tween-progress', '0.5')
    expect(chart.querySelector('[data-history-view-layer="daily"]')).toHaveAttribute('opacity', '0.5')
    expect(chart.querySelector('[data-history-view-layer="saves"]')).toHaveAttribute('opacity', '0.5')

    frames.step(420)

    expect(Number(chart.getAttribute('data-rendered-start-ms'))).toBe(targetStart)
    expect(Number(chart.getAttribute('data-rendered-end-ms'))).toBe(targetEnd)
    expect(chart).not.toHaveAttribute('data-zoom-tween-progress')
    unmount()
    frames.restore()
  })

  it('tweens the rendered window smoothly back out', () => {
    const frames = installAnimationFrameHarness()
    const { unmount } = render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
        showHeading={false}
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    const fullStart = Number(chart.getAttribute('data-visible-start-ms'))
    const fullEnd = Number(chart.getAttribute('data-visible-end-ms'))

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    frames.step(0)
    frames.step(420)
    const detailStart = Number(chart.getAttribute('data-rendered-start-ms'))
    const detailEnd = Number(chart.getAttribute('data-rendered-end-ms'))

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out history' }))

    expect(Number(chart.getAttribute('data-rendered-start-ms'))).toBe(detailStart)
    expect(Number(chart.getAttribute('data-rendered-end-ms'))).toBe(detailEnd)
    frames.step(1000)
    frames.step(1210)
    expect(Number(chart.getAttribute('data-rendered-start-ms')))
      .toBeCloseTo((detailStart + fullStart) / 2)
    expect(Number(chart.getAttribute('data-rendered-end-ms')))
      .toBeCloseTo((detailEnd + fullEnd) / 2)
    frames.step(1420)
    expect(Number(chart.getAttribute('data-rendered-start-ms'))).toBe(fullStart)
    expect(Number(chart.getAttribute('data-rendered-end-ms'))).toBe(fullEnd)
    unmount()
    frames.restore()
  })

  it('tweens even a year-long history without a large first-frame jump', () => {
    const frames = installAnimationFrameHarness()
    const { unmount } = render(
      <HistoryGraph
        entries={yearLongEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
        showHeading={false}
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    const fullStart = Number(chart.getAttribute('data-rendered-start-ms'))
    const fullEnd = Number(chart.getAttribute('data-rendered-end-ms'))
    const fullDuration = Number(chart.getAttribute('data-visible-end-ms'))
      - Number(chart.getAttribute('data-visible-start-ms'))

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))

    expect(Number(chart.getAttribute('data-rendered-start-ms'))).toBe(fullStart)
    expect(Number(chart.getAttribute('data-rendered-end-ms'))).toBe(fullEnd)
    const zoomDuration = Number(chart.getAttribute('data-visible-end-ms'))
      - Number(chart.getAttribute('data-visible-start-ms'))
    expect(zoomDuration / fullDuration).toBeLessThan(0.05)

    frames.step(0)
    frames.step(42)
    const earlyDuration = Number(chart.getAttribute('data-rendered-end-ms'))
      - Number(chart.getAttribute('data-rendered-start-ms'))
    expect(earlyDuration).toBeGreaterThan(fullDuration * 0.99)

    frames.step(420)
    expect(
      Number(chart.getAttribute('data-rendered-end-ms'))
      - Number(chart.getAttribute('data-rendered-start-ms'))
    ).toBe(zoomDuration)
    unmount()
    frames.restore()
  })

  it('does not animate zoom when reduced motion is requested', () => {
    const frames = installAnimationFrameHarness()
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))

    expect(frames.request).not.toHaveBeenCalled()
    expect(chart.getAttribute('data-rendered-start-ms')).toBe(
      chart.getAttribute('data-visible-start-ms')
    )
    expect(chart.getAttribute('data-rendered-end-ms')).toBe(
      chart.getAttribute('data-visible-end-ms')
    )
    matchMedia.mockRestore()
    frames.restore()
  })

  it('cancels zoom animation before panning or pointer selection', () => {
    const panFrames = installAnimationFrameHarness()
    const { unmount } = render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        onEntryHover={vi.fn()}
        audience="teacher"
        showHeading={false}
      />
    )

    let chart = screen.getByRole('slider', { name: 'Complete save history' })
    const bounds = {
      left: 0,
      width: 1000,
      top: 0,
      right: 1000,
      bottom: 78,
      height: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue(bounds)
    fireEvent.wheel(chart, { deltaY: -100, clientX: 500 })

    fireEvent.wheel(chart, { deltaX: -100, deltaY: 0, clientX: 500 })

    expect(panFrames.cancel).toHaveBeenCalledTimes(1)
    unmount()
    panFrames.restore()

    const pointerFrames = installAnimationFrameHarness()
    const onEntryClick = vi.fn()
    const secondRender = render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={onEntryClick}
        onEntryHover={vi.fn()}
        audience="teacher"
        showHeading={false}
      />
    )
    chart = screen.getByRole('slider', { name: 'Complete save history' })
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue(bounds)
    fireEvent.wheel(chart, { deltaY: -100, clientX: 500 })

    fireEvent.click(chart, { clientX: 500, clientY: 39 })

    expect(pointerFrames.cancel).toHaveBeenCalledTimes(1)
    expect(onEntryClick).toHaveBeenCalledTimes(1)
    secondRender.unmount()
    pointerFrames.restore()
  })

  it('keeps hover preview active against the rendered layer during a tween', () => {
    const frames = installAnimationFrameHarness()
    const onEntryHover = vi.fn()
    const { unmount } = render(
      <HistoryGraph
        entries={transitionEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        onEntryHover={onEntryHover}
        audience="teacher"
        showHeading={false}
      />
    )

    const chart = screen.getByRole('slider', { name: 'Complete save history' })
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 256,
      top: 0,
      right: 256,
      bottom: 78,
      height: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    frames.step(0)
    frames.step(300)

    const saveGroups = Array.from(
      chart.querySelectorAll('[data-history-view-layer="saves"] > g')
    )
    const specificSave = saveGroups.find((group) => (
      group.querySelector('title')?.textContent?.includes('+200 characters since previous')
    ))
    const line = specificSave?.querySelector('line')
    fireEvent.mouseMove(chart, {
      clientX: Number(line?.getAttribute('x2')),
      clientY: Number(line?.getAttribute('y2')),
    })

    expect(onEntryHover).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'specific-save' })
    )
    expect(frames.cancel).not.toHaveBeenCalled()
    unmount()
    frames.restore()
  })

  it('pins from the dominant rendered layer in both tween directions', () => {
    const zoomInFrames = installAnimationFrameHarness()
    const onZoomInClick = vi.fn()
    const firstRender = render(
      <HistoryGraph
        entries={transitionEntries}
        activeEntryId={null}
        onEntryClick={onZoomInClick}
        audience="teacher"
        showHeading={false}
      />
    )
    let chart = screen.getByRole('slider', { name: 'Complete save history' })
    const bounds = {
      left: 0,
      width: 256,
      top: 0,
      right: 256,
      bottom: 78,
      height: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue(bounds)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    const dailyGroups = Array.from(
      chart.querySelectorAll('[data-history-view-layer="daily"] > g')
    )
    const finalDay = dailyGroups.find((group) => (
      group.querySelector('title')?.textContent?.includes('Jan 10')
    ))
    const dayLine = finalDay?.querySelector('line')
    fireEvent.click(chart, {
      clientX: Number(dayLine?.getAttribute('x2')),
      clientY: Number(dayLine?.getAttribute('y2')),
    })
    expect(onZoomInClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'day-final' }))
    firstRender.unmount()
    zoomInFrames.restore()

    const zoomOutFrames = installAnimationFrameHarness()
    const onZoomOutClick = vi.fn()
    const secondRender = render(
      <HistoryGraph
        entries={transitionEntries}
        activeEntryId={null}
        onEntryClick={onZoomOutClick}
        audience="teacher"
        showHeading={false}
      />
    )
    chart = screen.getByRole('slider', { name: 'Complete save history' })
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue(bounds)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    zoomOutFrames.step(0)
    zoomOutFrames.step(420)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out history' }))
    const saveGroups = Array.from(
      chart.querySelectorAll('[data-history-view-layer="saves"] > g')
    )
    const specificSave = saveGroups.find((group) => (
      group.querySelector('title')?.textContent?.includes('+200 characters since previous')
    ))
    const saveLine = specificSave?.querySelector('line')
    fireEvent.click(chart, {
      clientX: Number(saveLine?.getAttribute('x2')),
      clientY: Number(saveLine?.getAttribute('y2')),
    })
    expect(onZoomOutClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'specific-save' })
    )
    secondRender.unmount()
    zoomOutFrames.restore()
  })

  it('retargets a mid-tween pan from the rendered window without snapping', () => {
    const frames = installAnimationFrameHarness()
    const { unmount } = render(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId={null}
        onEntryClick={vi.fn()}
        audience="teacher"
        showHeading={false}
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
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    frames.step(0)
    frames.step(210)
    const renderedStart = chart.getAttribute('data-rendered-start-ms')
    const renderedEnd = chart.getAttribute('data-rendered-end-ms')
    const priorTargetStart = chart.getAttribute('data-visible-start-ms')
    const cancelCountBeforePan = frames.cancel.mock.calls.length

    fireEvent.wheel(chart, { deltaX: -250, deltaY: 0, clientX: 500 })

    expect(chart.getAttribute('data-rendered-start-ms')).toBe(renderedStart)
    expect(chart.getAttribute('data-rendered-end-ms')).toBe(renderedEnd)
    expect(chart.getAttribute('data-visible-start-ms')).not.toBe(priorTargetStart)
    expect(frames.cancel.mock.calls.length).toBeGreaterThan(cancelCountBeforePan)
    unmount()
    frames.restore()
  })

  it('pans with Shift plus a conventional vertical scroll wheel', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    const initialStart = Number(chart.getAttribute('data-visible-start-ms'))

    fireEvent.wheel(chart, { deltaY: -500, shiftKey: true, clientX: 500 })

    expect(Number(chart.getAttribute('data-visible-start-ms'))).toBeLessThan(initialStart)
  })

  it('keeps button zoom centered on the window after panning', () => {
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
    const zoomIn = screen.getByRole('button', { name: 'Zoom in history' })
    fireEvent.click(zoomIn)
    fireEvent.wheel(chart, { deltaX: -500, deltaY: 0, clientX: 500 })
    const pannedCenter = (
      Number(chart.getAttribute('data-visible-start-ms'))
      + Number(chart.getAttribute('data-visible-end-ms'))
    ) / 2

    fireEvent.click(zoomIn)

    const zoomedCenter = (
      Number(chart.getAttribute('data-visible-start-ms'))
      + Number(chart.getAttribute('data-visible-end-ms'))
    ) / 2
    expect(zoomedCenter).toBe(pannedCenter)
  })

  it('contains horizontal pan gestures at the timeline boundary', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in history' }))
    const boundaryPan = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 500,
    })

    fireEvent(chart, boundaryPan)

    expect(boundaryPan.defaultPrevented).toBe(true)
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
    expect(screen.getByText('Jan 19 9:05 PM'))
      .toHaveAttribute('data-history-context', 'hover')

    fireEvent.click(chart, { clientX: 990 })
    expect(onEntryClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'third' }))

    fireEvent.mouseLeave(chart)
    expect(screen.queryByText('Jan 19 9:05 PM'))
      .not.toBeInTheDocument()
  })

  it('keeps the selected save timestamp visible in both saves and daily overview', () => {
    const { rerender } = render(
      <HistoryGraph
        entries={entries}
        activeEntryId="second"
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    expect(screen.getByText('Jan 19 8:10 PM'))
      .toHaveAttribute('data-history-context', 'selected')

    rerender(
      <HistoryGraph
        entries={multiWeekEntries}
        activeEntryId="long-19"
        onEntryClick={vi.fn()}
        audience="teacher"
      />
    )

    expect(screen.getByText('Jan 10 11:00 AM'))
      .toHaveAttribute('data-history-context', 'selected')
  })

  it('shows only the timestamp visually while retaining accessible change details', () => {
    const largeDailyEntries = [
      entry('large-final', '2025-01-10T17:00:00Z', 20, 100),
      entry('large-addition', '2025-01-10T16:00:00Z', 20000, 100100),
      entry('large-baseline', '2025-01-01T16:00:00Z', 20, 100),
    ]
    render(
      <div className="w-60">
        <HistoryGraph
          entries={largeDailyEntries}
          activeEntryId="large-final"
          onEntryClick={vi.fn()}
          audience="student"
        />
      </div>
    )

    const context = screen.getByText('Jan 10 12:00 PM')
    expect(context).toHaveAttribute('data-history-context', 'selected')
    expect(context).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('slider', { name: 'Complete save history' }))
      .toHaveAttribute('aria-valuetext', 'Jan 10, 12:00 PM, -100000 characters since previous')
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
