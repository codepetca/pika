import { describe, it, expect } from 'vitest'
import { analyzeAuthenticity } from '@/lib/authenticity'
import type { AssignmentDocHistoryEntry } from '@/types'

function makeEntry(
  overrides: Partial<AssignmentDocHistoryEntry> & { word_count: number; created_at: string }
): AssignmentDocHistoryEntry {
  return {
    id: Math.random().toString(),
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: null,
    char_count: overrides.word_count * 5,
    paste_word_count: null,
    keystroke_count: null,
    trigger: 'autosave',
    ...overrides,
  }
}

describe('analyzeAuthenticity', () => {
  it('returns null score for empty entries', () => {
    const result = analyzeAuthenticity([])
    expect(result.score).toBeNull()
    expect(result.flags).toEqual([])
  })

  it('returns null score for single entry', () => {
    const result = analyzeAuthenticity([
      makeEntry({ word_count: 100, created_at: '2025-01-01T00:00:00Z' }),
    ])
    expect(result.score).toBeNull()
  })

  it('scores ~100 for organic typing (~1 WPS)', () => {
    // 10 words every 10 seconds = 1 WPS (organic)
    const entries = Array.from({ length: 11 }, (_, i) =>
      makeEntry({
        word_count: i * 10,
        created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, i * 10)).toISOString(),
        trigger: 'autosave',
      })
    )
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })

  it('scores low for pure paste (high WPS)', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({ word_count: 500, created_at: '2025-01-01T00:00:02Z', trigger: 'autosave' }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(0)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].wordDelta).toBe(500)
    expect(result.flags[0].reason).toBe('high_wps')
  })

  it('handles mixed organic and paste', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      // Organic: 50 words in 50 seconds = 1 WPS
      makeEntry({ word_count: 50, created_at: '2025-01-01T00:00:50Z', trigger: 'autosave' }),
      // Paste: 50 words in 1 second = 50 WPS
      makeEntry({ word_count: 100, created_at: '2025-01-01T00:00:51Z', trigger: 'autosave' }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(50)
    expect(result.flags).toHaveLength(1)
  })

  it('skips restore trigger entries', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({ word_count: 50, created_at: '2025-01-01T00:00:50Z', trigger: 'autosave' }),
      // Restore — should be skipped even though it looks like a paste
      makeEntry({ word_count: 200, created_at: '2025-01-01T00:00:51Z', trigger: 'restore' }),
      makeEntry({ word_count: 250, created_at: '2025-01-01T00:01:41Z', trigger: 'autosave' }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })

  it('skips baseline trigger entries', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({ word_count: 100, created_at: '2025-01-01T00:00:01Z', trigger: 'baseline' }),
      makeEntry({ word_count: 150, created_at: '2025-01-01T00:01:01Z', trigger: 'autosave' }),
    ]
    const result = analyzeAuthenticity(entries)
    // Only the 100->150 interval counts (50 words in 60s = organic)
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })

  it('ignores deletions (negative word deltas)', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({ word_count: 100, created_at: '2025-01-01T00:01:40Z', trigger: 'autosave' }),
      makeEntry({ word_count: 50, created_at: '2025-01-01T00:01:45Z', trigger: 'autosave' }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })

  it('returns null when only baseline + submit with no content change', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:01:00Z', trigger: 'submit' }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBeNull()
  })

  it('skips submit trigger entries', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({ word_count: 50, created_at: '2025-01-01T00:00:50Z', trigger: 'autosave' }),
      // Submit entry with same word count — should be skipped
      makeEntry({ word_count: 50, created_at: '2025-01-01T00:01:00Z', trigger: 'submit' }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })

  // Paste detection — informational only, does not affect score
  it('records paste flag but does not lower score', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({
        word_count: 50,
        created_at: '2025-01-01T00:01:00Z',
        trigger: 'autosave',
        paste_word_count: 50,
        keystroke_count: 0,
      }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100) // Paste doesn't affect score
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].reason).toBe('paste')
  })

  it('caps effective paste words by word delta (rearrangement tolerance)', () => {
    const entries = [
      makeEntry({ word_count: 100, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      // Word count went up by 20, but 100 words pasted (cut+paste rearrangement)
      makeEntry({
        word_count: 120,
        created_at: '2025-01-01T00:01:00Z',
        trigger: 'autosave',
        paste_word_count: 100,
        keystroke_count: 5,
      }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100) // Paste doesn't affect score
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].reason).toBe('paste')
    expect(result.flags[0].wordDelta).toBe(20) // Capped by word delta
  })

  it('ignores paste when word delta is 0 (pure rearrangement)', () => {
    const entries = [
      makeEntry({ word_count: 100, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      // Same word count — paste was just a rearrangement
      makeEntry({
        word_count: 100,
        created_at: '2025-01-01T00:01:00Z',
        trigger: 'autosave',
        paste_word_count: 50,
        keystroke_count: 10,
      }),
    ]
    const result = analyzeAuthenticity(entries)
    // No words added → null score
    expect(result.score).toBeNull()
  })

  it('does not flag low keystroke ratio (signal removed)', () => {
    const entries = [
      makeEntry({ word_count: 0, char_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      makeEntry({
        word_count: 50,
        char_count: 250,
        created_at: '2025-01-01T00:01:00Z',
        trigger: 'autosave',
        paste_word_count: 0,
        keystroke_count: 10, // Low keystrokes but no longer flagged
      }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })

  // Signal 2: WPS anti-spoof
  it('uses WPS fallback for old entries (null paste_word_count)', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      // 500 words in 2 seconds, no paste tracking
      makeEntry({
        word_count: 500,
        created_at: '2025-01-01T00:00:02Z',
        trigger: 'autosave',
        paste_word_count: null,
        keystroke_count: null,
      }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(0)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].reason).toBe('high_wps')
  })

  it('WPS acts as safety net when client reports 0 paste but speed is impossible', () => {
    const entries = [
      makeEntry({ word_count: 0, char_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      // Client says 0 paste, 2000 keystrokes, but 500 words in 2 seconds
      makeEntry({
        word_count: 500,
        char_count: 2500,
        created_at: '2025-01-01T00:00:02Z',
        trigger: 'autosave',
        paste_word_count: 0,
        keystroke_count: 2000,
      }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(0)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].reason).toBe('high_wps')
  })

  // Hybrid old + new entries
  it('handles mix of old (null) and new (tracked) entries', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00Z', trigger: 'baseline' }),
      // Old entry: organic by WPS
      makeEntry({
        word_count: 50,
        created_at: '2025-01-01T00:00:50Z',
        trigger: 'autosave',
        paste_word_count: null,
        keystroke_count: null,
      }),
      // New entry: paste at normal speed — informational flag, doesn't affect score
      makeEntry({
        word_count: 100,
        created_at: '2025-01-01T00:01:50Z',
        trigger: 'autosave',
        paste_word_count: 50,
        keystroke_count: 0,
      }),
    ]
    const result = analyzeAuthenticity(entries)
    expect(result.score).toBe(100) // Paste doesn't affect score
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].reason).toBe('paste')
  })

  it('clamps seconds to minimum of 1', () => {
    const entries = [
      makeEntry({ word_count: 0, created_at: '2025-01-01T00:00:00.000Z', trigger: 'baseline' }),
      // Same timestamp (0 seconds apart) — should use 1 second minimum
      makeEntry({ word_count: 2, created_at: '2025-01-01T00:00:00.500Z', trigger: 'autosave' }),
    ]
    const result = analyzeAuthenticity(entries)
    // 2 words / 1 second = 2 WPS, under threshold
    expect(result.score).toBe(100)
    expect(result.flags).toHaveLength(0)
  })
})
