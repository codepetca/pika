import { describe, expect, it } from 'vitest'
import { buildOrderedClassworkItems } from '@/lib/classwork-order'

describe('buildOrderedClassworkItems', () => {
  it('interleaves assignments and materials by shared position', () => {
    const items = buildOrderedClassworkItems(
      [
        { id: 'a-1', title: 'Essay', position: 2, created_at: '2026-01-02T00:00:00.000Z' },
        { id: 'a-2', title: 'Reflection', position: 4, created_at: '2026-01-04T00:00:00.000Z' },
      ],
      [
        { id: 'm-1', title: 'Reading', position: 1, created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'm-2', title: 'Example', position: 3, created_at: '2026-01-03T00:00:00.000Z' },
      ],
    )

    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual([
      'material:m-1',
      'assignment:a-1',
      'material:m-2',
      'assignment:a-2',
    ])
  })

  it('falls back to assignment-first order when material positions are unavailable', () => {
    const items = buildOrderedClassworkItems(
      [
        { id: 'a-1', title: 'Essay', position: 0, created_at: '2026-01-01T00:00:00.000Z' },
      ],
      [
        { id: 'm-1', title: 'Reading', created_at: '2026-01-02T00:00:00.000Z' },
      ],
    )

    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual([
      'assignment:a-1',
      'material:m-1',
    ])
  })
})
