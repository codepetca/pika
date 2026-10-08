import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrderedClassworkItems, placeCreatedClasswork } from '@/lib/classwork-order'
import { saveCreatedClassworkPlacement } from '@/lib/created-classwork-placement'
import { invalidateClassworkLists } from '@/lib/created-classwork-placement'

const { read, write, invalidate } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/request-cache', () => ({ fetchCachedJSON: read, fetchJSON: write, invalidateCachedJSON: invalidate }))
const assignments = [
  { id: 'released', title: 'Released', is_draft: false, position: 0 },
  { id: 'draft', title: 'Draft', is_draft: true, position: 2 },
  { id: 'new', title: 'New', is_draft: true, position: 4 },
]
const materials = [{ id: 'material', title: 'Material', is_draft: false, position: 1 }]
const surveys = [{ id: 'survey', title: 'Survey', status: 'draft', position: 3 }]
const created = { type: 'assignment' as const, id: 'new' }

beforeEach(() => { vi.clearAllMocks(); write.mockResolvedValue({ success: true }) })

describe('created classwork placement', () => {
  it('inserts after the last released item across all three kinds, preserving prior order', () => {
    const input = buildOrderedClassworkItems(assignments, materials, surveys)
    expect(placeCreatedClasswork(input, created).map(({ id }) => id)).toEqual(['released', 'material', 'new', 'draft', 'survey'])
    expect(input.map(({ id }) => id)).toEqual(['released', 'material', 'draft', 'survey', 'new'])
    const releasedSurveys = [{ ...surveys[0], status: 'active' }]
    expect(placeCreatedClasswork(buildOrderedClassworkItems(assignments, materials, releasedSurveys), created).map(({ id }) => id))
      .toEqual(['released', 'material', 'draft', 'survey', 'new'])
  })

  it('places first among drafts and appends after an entirely released list', () => {
    const drafts = assignments.map((item) => ({ ...item, is_draft: true }))
    expect(placeCreatedClasswork(buildOrderedClassworkItems(drafts, [], []), created).map(({ id }) => id)).toEqual(['new', 'released', 'draft'])
    const released = assignments.map((item) => ({ ...item, is_draft: false }))
    expect(placeCreatedClasswork(buildOrderedClassworkItems(released, [], []), created).map(({ id }) => id)).toEqual(['released', 'draft', 'new'])
    expect(placeCreatedClasswork(buildOrderedClassworkItems([assignments[2]], [], []), created)).toHaveLength(1)
  })

  it.each(['active', 'closed'])('treats %s surveys as released and inserts a new material after them', (status) => {
    const input = buildOrderedClassworkItems(assignments.slice(0, 2), [...materials, { id: 'new-material', title: 'New', is_draft: true, position: 5 }], [{ ...surveys[0], status }])
    expect(placeCreatedClasswork(input, { type: 'material', id: 'new-material' }).map(({ id }) => id)).toEqual(['released', 'material', 'draft', 'survey', 'new-material'])
  })

  it('places a new survey before existing drafts', () => {
    const input = buildOrderedClassworkItems(assignments.slice(0, 2), materials, [...surveys, { id: 'new-survey', title: 'New', status: 'draft', position: 5 }])
    expect(placeCreatedClasswork(input, { type: 'survey', id: 'new-survey' }).map(({ id }) => id)).toEqual(['released', 'material', 'new-survey', 'draft', 'survey'])
  })

  it('loads fresh lists and saves a complete mixed order with existing rows', async () => {
    read.mockImplementation((key: string) => Promise.resolve(key.includes('assignments') ? { assignments } : key.includes('materials') ? { materials } : { surveys }))
    await saveCreatedClassworkPlacement('class', created)
    expect(read).toHaveBeenCalledTimes(3)
    for (const call of read.mock.calls) expect(call[2]).toEqual({ ttlMs: 0 })
    expect(JSON.parse(write.mock.calls[0][1].init.body).items).toEqual([
      { type: 'assignment', id: 'released' }, { type: 'material', id: 'material' },
      created, { type: 'assignment', id: 'draft' }, { type: 'survey', id: 'survey' },
    ])
    expect(invalidate).toHaveBeenCalledTimes(12)
  })

  it('rejects a missing created row without attempting a reorder', async () => {
    read.mockImplementation((key: string) => Promise.resolve(key.includes('assignments') ? { assignments: [] } : key.includes('materials') ? { materials: [] } : { surveys: [] }))
    await expect(saveCreatedClassworkPlacement('class', created)).rejects.toThrow('missing')
    expect(write).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledTimes(12)
  })

  it('surfaces a list conflict, invalidates all views and never repeats creation', async () => {
    read.mockImplementation((key: string) => Promise.resolve(key.includes('assignments') ? { assignments } : key.includes('materials') ? { materials } : { surveys }))
    write.mockRejectedValueOnce(new Error('Classwork list changed'))
    await expect(saveCreatedClassworkPlacement('class', created)).rejects.toThrow('list changed')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('/reorder')
    expect(invalidate).toHaveBeenCalledTimes(12)
  })
})
