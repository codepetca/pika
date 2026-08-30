import { describe, it, expect } from 'vitest'
import type { AssignmentDocHistoryEntry } from '@/types'
import {
  computeCharDiffs,
  groupByDate,
  computeBaselineY,
  computeStemLayout,
  findNearestStem,
  buildWorkSessions,
  computeActivityPositions,
  computeActivityWindow,
  buildHistoryZoomDurations,
  computeHistoryZoomWindow,
  computeHistoryWindowTransform,
  computeLinearChangeHeight,
  easeHistoryZoomProgress,
  groupActivityByDay,
  interpolateActivityWindow,
  positionInActivityWindow,
} from '@/lib/history-graph'

// ── Helpers ────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<AssignmentDocHistoryEntry> & { char_count: number; created_at: string }
): AssignmentDocHistoryEntry {
  return {
    id: crypto.randomUUID(),
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: null,
    word_count: 0,
    paste_word_count: null,
    keystroke_count: null,
    trigger: 'autosave',
    ...overrides,
  }
}

// Create entries newest-first (as from DB)
function makeEntries(
  specs: { charCount: number; time: string; id?: string }[]
): AssignmentDocHistoryEntry[] {
  return specs.map((s) =>
    makeEntry({
      id: s.id ?? crypto.randomUUID(),
      char_count: s.charCount,
      created_at: s.time,
    })
  )
}

// ── computeCharDiffs ───────────────────────────────────────────────

describe('computeCharDiffs', () => {
  it('returns empty for empty input', () => {
    expect(computeCharDiffs([])).toEqual([])
  })

  it('treats the oldest entry as baseline with charDiff 0', () => {
    const entries = makeEntries([
      { charCount: 150, time: '2025-01-15T16:00:00Z' }, // newest
      { charCount: 100, time: '2025-01-15T15:00:00Z' }, // oldest
    ])
    const result = computeCharDiffs(entries)

    expect(result).toHaveLength(2)
    // oldest first
    expect(result[0].charDiff).toBe(0)
    expect(result[0].entry.char_count).toBe(100)
    // second entry
    expect(result[1].charDiff).toBe(50)
    expect(result[1].entry.char_count).toBe(150)
  })

  it('computes negative diffs for deletions', () => {
    const entries = makeEntries([
      { charCount: 80, time: '2025-01-15T17:00:00Z' },
      { charCount: 150, time: '2025-01-15T16:00:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const result = computeCharDiffs(entries)

    expect(result[0].charDiff).toBe(0)   // baseline
    expect(result[1].charDiff).toBe(50)   // 150 - 100
    expect(result[2].charDiff).toBe(-70)  // 80 - 150
  })

  it('handles single entry', () => {
    const entries = makeEntries([
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const result = computeCharDiffs(entries)

    expect(result).toHaveLength(1)
    expect(result[0].charDiff).toBe(0)
  })

  it('handles zero-diff entries', () => {
    const entries = makeEntries([
      { charCount: 100, time: '2025-01-15T16:00:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const result = computeCharDiffs(entries)

    expect(result[0].charDiff).toBe(0) // baseline
    expect(result[1].charDiff).toBe(0) // no change
  })
})

describe('activity days and sessions', () => {
  it('uses the full Toronto calendar days containing the save history', () => {
    const entries = makeEntries([
      { charCount: 120, time: '2025-01-13T16:00:00Z' },
      { charCount: 20, time: '2025-01-10T15:00:00Z' },
    ])

    const window = computeActivityWindow(entries)

    expect(window).toEqual({
      startMs: Date.parse('2025-01-10T05:00:00Z'),
      endMs: Date.parse('2025-01-14T05:00:00Z'),
    })
    expect(positionInActivityWindow(Date.parse(entries[1].created_at), window!)).toBeCloseTo(10 / 96)
  })

  it('shows one complete day when every save is on the same day', () => {
    const entries = makeEntries([
      { charCount: 140, time: '2025-01-20T20:00:00Z' },
      { charCount: 100, time: '2025-01-20T15:00:00Z' },
    ])

    expect(computeActivityWindow(entries)).toEqual({
      startMs: Date.parse('2025-01-20T05:00:00Z'),
      endMs: Date.parse('2025-01-21T05:00:00Z'),
    })
  })

  it('groups saves separated by thirty minutes into distinct sessions', () => {
    const diffs = computeCharDiffs(makeEntries([
      { charCount: 200, time: '2025-01-15T16:05:00Z', id: 'third' },
      { charCount: 120, time: '2025-01-15T15:10:00Z', id: 'second' },
      { charCount: 50, time: '2025-01-15T15:00:00Z', id: 'first' },
    ]))

    const sessions = buildWorkSessions(diffs)

    expect(sessions).toHaveLength(2)
    expect(sessions[0].entries.map((entry) => entry.entry.id)).toEqual(['first', 'second'])
    expect(sessions[1].entries.map((entry) => entry.entry.id)).toEqual(['third'])
  })

  it('clamps timestamps outside the activity window', () => {
    const window = { startMs: 100, endMs: 200 }
    expect(positionInActivityWindow(0, window)).toBe(0)
    expect(positionInActivityWindow(150, window)).toBe(0.5)
    expect(positionInActivityWindow(300, window)).toBe(1)
  })

  it('keeps tightly clustered saves individually visible without leaving the chart', () => {
    const diffs = computeCharDiffs(makeEntries([
      { charCount: 140, time: '2025-01-20T15:00:02Z' },
      { charCount: 130, time: '2025-01-20T15:00:01Z' },
      { charCount: 120, time: '2025-01-20T15:00:00Z' },
    ]))
    const window = computeActivityWindow(diffs.map((entry) => entry.entry))!

    const positions = computeActivityPositions(diffs, window, 256, 5, 4)

    expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(4)
    expect(positions[2] - positions[1]).toBeGreaterThanOrEqual(4)
    expect(positions[0]).toBeGreaterThanOrEqual(5)
    expect(positions[2]).toBeLessThanOrEqual(251)
  })

  it('preserves real timing when there are too many saves to space apart', () => {
    const diffs = computeCharDiffs(makeEntries(
      Array.from({ length: 80 }, (_, index) => ({
        charCount: 1000 - index * 5,
        time: new Date(Date.parse('2025-01-20T15:00:00Z') + (79 - index) * 1000).toISOString(),
      }))
    ))
    const window = computeActivityWindow(diffs.map((entry) => entry.entry))!

    const positions = computeActivityPositions(diffs, window, 256, 5, 4)

    expect(positions[positions.length - 1] - positions[0]).toBeLessThan(1)
  })

  it('aggregates additions and deletions by Toronto activity day', () => {
    const diffs = computeCharDiffs(makeEntries([
      { charCount: 190, time: '2025-01-17T16:00:00Z', id: 'final' },
      { charCount: 140, time: '2025-01-16T19:00:00Z', id: 'rewrite' },
      { charCount: 220, time: '2025-01-16T16:00:00Z', id: 'addition' },
      { charCount: 100, time: '2025-01-15T16:00:00Z', id: 'baseline' },
    ]))

    const groups = groupActivityByDay(diffs)

    expect(groups).toHaveLength(3)
    expect(groups[1]).toMatchObject({
      day: '2025-01-16',
      additions: 120,
      deletions: 80,
    })
    expect(groups[1].finalEntry.entry.id).toBe('rewrite')
    expect(groups[2]).toMatchObject({ additions: 50, deletions: 0 })
  })

  it('builds useful zoom levels and clamps a centered zoom to the project range', () => {
    const window = {
      startMs: Date.parse('2025-01-01T00:00:00Z'),
      endMs: Date.parse('2025-02-12T00:00:00Z'),
    }
    const durations = buildHistoryZoomDurations(window)

    expect(durations[0]).toBe(42 * 24 * 60 * 60 * 1000)
    expect(durations[1]).toBe(14 * 24 * 60 * 60 * 1000)

    expect(computeHistoryZoomWindow(window, durations[1], window.startMs)).toEqual({
      startMs: window.startMs,
      endMs: window.startMs + durations[1],
    })
    expect(computeHistoryZoomWindow(window, durations[1], window.endMs)).toEqual({
      startMs: window.endMs - durations[1],
      endMs: window.endMs,
    })
  })

  it('uses a strictly proportional shared linear character scale', () => {
    expect(computeLinearChangeHeight(400, 400, 28)).toBe(28)
    expect(computeLinearChangeHeight(-200, 400, 28)).toBe(14)
    expect(computeLinearChangeHeight(100, 400, 28)).toBe(7)
    expect(computeLinearChangeHeight(1, 400, 28)).toBeCloseTo(0.07)
    expect(computeLinearChangeHeight(0, 400, 28)).toBe(0)
  })

  it('eases zoom symmetrically while keeping exact endpoints', () => {
    expect(easeHistoryZoomProgress(-1)).toBe(0)
    expect(easeHistoryZoomProgress(0)).toBe(0)
    expect(easeHistoryZoomProgress(0.1)).toBeCloseTo(0.004)
    expect(easeHistoryZoomProgress(0.5)).toBe(0.5)
    expect(easeHistoryZoomProgress(0.9)).toBeCloseTo(0.996)
    expect(easeHistoryZoomProgress(1)).toBe(1)
    expect(easeHistoryZoomProgress(2)).toBe(1)
  })

  it('interpolates the actual history window in both directions', () => {
    const overview = { startMs: 100, endMs: 1100 }
    const detail = { startMs: 400, endMs: 700 }

    expect(interpolateActivityWindow(overview, detail, 0)).toEqual(overview)
    expect(interpolateActivityWindow(overview, detail, 0.5)).toEqual({
      startMs: 250,
      endMs: 900,
    })
    expect(interpolateActivityWindow(overview, detail, 1)).toEqual(detail)
    expect(interpolateActivityWindow(detail, overview, 0.5)).toEqual({
      startMs: 250,
      endMs: 900,
    })
  })

  it('maps one prepared SVG scene onto each rendered zoom window', () => {
    const scene = { startMs: 400, endMs: 700 }
    const overview = { startMs: 100, endMs: 1100 }
    const detail = { startMs: 400, endMs: 700 }

    expect(computeHistoryWindowTransform(scene, detail, 256, 5)).toEqual({
      scaleX: 1,
      translateX: 0,
    })
    expect(computeHistoryWindowTransform(scene, overview, 256, 5)).toEqual({
      scaleX: 0.3,
      translateX: 77.3,
    })
  })
})

// ── groupByDate ────────────────────────────────────────────────────

describe('groupByDate', () => {
  it('returns empty for empty input', () => {
    expect(groupByDate([])).toEqual([])
  })

  it('groups entries by Toronto date and hour, newest-day-first', () => {
    const entries = makeEntries([
      { charCount: 200, time: '2025-01-16T15:00:00Z' }, // Jan 16, 10am Toronto
      { charCount: 150, time: '2025-01-15T20:00:00Z' }, // Jan 15, 3pm Toronto
      { charCount: 100, time: '2025-01-15T15:00:00Z' }, // Jan 15, 10am Toronto
    ])
    const diffs = computeCharDiffs(entries)
    const groups = groupByDate(diffs)

    expect(groups).toHaveLength(2)
    // Newest day first
    expect(groups[0].date).toBe('Thu Jan 16')
    expect(groups[0].hours).toHaveLength(1)
    expect(groups[0].hours[0].hour).toBe(10)
    expect(groups[0].hours[0].label).toBe('10a')
    expect(groups[0].hours[0].entries).toHaveLength(1)

    expect(groups[1].date).toBe('Wed Jan 15')
    expect(groups[1].hours).toHaveLength(2)
    // Hours oldest-first
    expect(groups[1].hours[0].hour).toBe(10)
    expect(groups[1].hours[0].entries).toHaveLength(1)
    expect(groups[1].hours[1].hour).toBe(15)
    expect(groups[1].hours[1].entries).toHaveLength(1)
  })

  it('handles entries near midnight correctly in Toronto timezone', () => {
    // 4:30 AM UTC on Jan 16 = 11:30 PM EST on Jan 15
    const entries = makeEntries([
      { charCount: 150, time: '2025-01-16T04:30:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const groups = groupByDate(diffs)

    expect(groups).toHaveLength(1) // Both are Jan 15 Toronto time
    expect(groups[0].date).toBe('Wed Jan 15')
    expect(groups[0].hours).toHaveLength(2) // 10am and 11pm
    expect(groups[0].hours[0].hour).toBe(10)
    expect(groups[0].hours[1].hour).toBe(23)
    expect(groups[0].hours[1].label).toBe('11p')
  })

  it('groups multiple entries in the same hour together', () => {
    const entries = makeEntries([
      { charCount: 200, time: '2025-01-15T15:30:00Z' }, // 10:30 AM Toronto
      { charCount: 150, time: '2025-01-15T15:15:00Z' }, // 10:15 AM Toronto
      { charCount: 100, time: '2025-01-15T15:00:00Z' }, // 10:00 AM Toronto
    ])
    const diffs = computeCharDiffs(entries)
    const groups = groupByDate(diffs)

    expect(groups).toHaveLength(1)
    expect(groups[0].hours).toHaveLength(1)
    expect(groups[0].hours[0].hour).toBe(10)
    expect(groups[0].hours[0].entries).toHaveLength(3)
  })
})

// ── computeBaselineY ───────────────────────────────────────────────

describe('computeBaselineY', () => {
  it('returns middle for empty entries', () => {
    expect(computeBaselineY([], 32)).toBe(16)
  })

  it('always centers baseline regardless of additions/deletions', () => {
    const entries = makeEntries([
      { charCount: 300, time: '2025-01-15T15:02:00Z' },
      { charCount: 200, time: '2025-01-15T15:01:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    expect(computeBaselineY(diffs, 32)).toBe(16)
  })
})

// ── computeStemLayout ──────────────────────────────────────────────

describe('computeStemLayout', () => {
  it('returns empty layout for empty entries', () => {
    const layout = computeStemLayout([], 240)

    expect(layout.stems).toEqual([])
    expect(layout.baselineY).toBe(16) // 32/2
  })

  it('creates stems for all entries', () => {
    const entries = makeEntries([
      { charCount: 200, time: '2025-01-15T15:02:00Z' },
      { charCount: 150, time: '2025-01-15T15:01:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    expect(layout.stems).toHaveLength(3)
  })

  it('marks first entry as baseline with muted color', () => {
    const entries = makeEntries([
      { charCount: 150, time: '2025-01-15T15:01:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    expect(layout.stems[0].isBaseline).toBe(true)
    expect(layout.stems[0].color).toBe('muted')
    expect(layout.stems[0].height).toBe(0.15) // fixed baseline height
  })

  it('assigns success color for additions', () => {
    const entries = makeEntries([
      { charCount: 150, time: '2025-01-15T15:01:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    expect(layout.stems[1].color).toBe('success')
    expect(layout.stems[1].direction).toBe('up')
  })

  it('assigns danger color for deletions', () => {
    const entries = makeEntries([
      { charCount: 50, time: '2025-01-15T15:01:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    expect(layout.stems[1].color).toBe('danger')
    expect(layout.stems[1].direction).toBe('down')
  })

  it('assigns warning color for large changes (>200 chars)', () => {
    const entries = makeEntries([
      { charCount: 600, time: '2025-01-15T15:01:00Z' },
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    expect(layout.stems[1].color).toBe('warning')
    expect(layout.stems[1].charDiff).toBe(500)
  })

  it('uses sqrt height scaling clamped at 200', () => {
    const entries = makeEntries([
      { charCount: 300, time: '2025-01-15T15:01:00Z' }, // diff = 200
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    // diff = 200, sqrt(200)/sqrt(200) = 1.0
    expect(layout.stems[1].height).toBe(1)
  })

  it('gives small diffs visible height via sqrt', () => {
    const entries = makeEntries([
      { charCount: 110, time: '2025-01-15T15:01:00Z' }, // diff = 10
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    // sqrt(10)/sqrt(200) ≈ 0.2236
    const expected = Math.sqrt(10) / Math.sqrt(200)
    expect(layout.stems[1].height).toBeCloseTo(expected, 4)
  })

  it('positions stems proportionally within the hour', () => {
    // Entries at :00 and :30 within the same hour (10 AM Toronto = 15:xx UTC)
    const entries = makeEntries([
      { charCount: 150, time: '2025-01-15T15:30:00Z' }, // 10:30 AM Toronto
      { charCount: 100, time: '2025-01-15T15:00:00Z' }, // 10:00 AM Toronto
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    // :00 = second 0, :30 = second 1800 within the hour
    // usableWidth = 240 - 2*2 = 236
    // x1 = 2 + (0/3600)*236 = 2
    // x2 = 2 + (1800/3600)*236 = 120
    expect(layout.stems[0].x).toBeCloseTo(2, 0)
    expect(layout.stems[1].x).toBeCloseTo(2 + (1800 / 3600) * 236, 0)
  })

  it('enforces minimum spacing between close stems', () => {
    // Two entries at the same minute → should be nudged apart by STEM_WIDTH + STEM_GAP = 3
    const entries = makeEntries([
      { charCount: 150, time: '2025-01-15T15:00:30Z' }, // same minute
      { charCount: 100, time: '2025-01-15T15:00:00Z' }, // same minute
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    const gap = layout.stems[1].x - layout.stems[0].x
    expect(gap).toBeGreaterThanOrEqual(3) // STEM_WIDTH(2) + STEM_GAP(1)
  })

  it('handles single entry (just baseline)', () => {
    const entries = makeEntries([
      { charCount: 100, time: '2025-01-15T15:00:00Z' },
    ])
    const diffs = computeCharDiffs(entries)
    const layout = computeStemLayout(diffs, 240)

    expect(layout.stems).toHaveLength(1)
    expect(layout.stems[0].isBaseline).toBe(true)
  })
})

// ── findNearestStem ────────────────────────────────────────────────

describe('findNearestStem', () => {
  it('returns -1 for empty stems', () => {
    expect(findNearestStem(100, [])).toBe(-1)
  })

  it('finds the closest stem by x position', () => {
    const stems = [
      { x: 10 },
      { x: 50 },
      { x: 90 },
    ] as any[]

    expect(findNearestStem(12, stems)).toBe(0)
    expect(findNearestStem(48, stems)).toBe(1)
    expect(findNearestStem(80, stems)).toBe(2)
  })

  it('snaps to nearest when equidistant (first wins)', () => {
    const stems = [
      { x: 10 },
      { x: 30 },
    ] as any[]

    // Exactly between: first wins because < not <=
    expect(findNearestStem(20, stems)).toBe(0)
  })

  it('handles single stem', () => {
    const stems = [{ x: 50 }] as any[]
    expect(findNearestStem(0, stems)).toBe(0)
    expect(findNearestStem(100, stems)).toBe(0)
  })
})
