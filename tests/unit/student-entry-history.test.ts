import { describe, it, expect } from 'vitest'
import {
  getEntryPreview,
  upsertEntryIntoHistory,
} from '@/lib/student-entry-history'
import type { Entry } from '@/types'

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: overrides.id ?? 'e1',
    student_id: overrides.student_id ?? 's1',
    classroom_id: overrides.classroom_id ?? 'c1',
    date: overrides.date ?? '2025-12-16',
    text: overrides.text ?? 'hello',
    minutes_reported: overrides.minutes_reported ?? null,
    mood: overrides.mood ?? null,
    created_at: overrides.created_at ?? '2025-12-16T01:00:00Z',
    updated_at: overrides.updated_at ?? '2025-12-16T01:00:00Z',
    on_time: overrides.on_time ?? true,
  }
}

describe('student-entry-history', () => {
  it('creates a compact preview', () => {
    expect(getEntryPreview('  hello\n\nworld  ', 150)).toBe('hello world')
    expect(getEntryPreview('a'.repeat(151), 150)).toHaveLength(151) // includes ellipsis
  })

  it('upserts into a limited, reverse-chronological list', () => {
    const existing = [
      entry({ id: 'e-old', date: '2025-12-15' }),
      entry({ id: 'e-mid', date: '2025-12-16' }),
    ]

    const next = upsertEntryIntoHistory(existing, entry({ id: 'e-new', date: '2025-12-17' }), 2)
    expect(next.map(e => e.id)).toEqual(['e-new', 'e-mid'])
  })

  it('replaces entries by id or date', () => {
    const existing = [
      entry({ id: 'e1', date: '2025-12-16', text: 'old' }),
      entry({ id: 'e2', date: '2025-12-15' }),
    ]

    const next = upsertEntryIntoHistory(existing, entry({ id: 'e1', date: '2025-12-16', text: 'new' }), 10)
    expect(next.find(e => e.id === 'e1')?.text).toBe('new')
  })
})
