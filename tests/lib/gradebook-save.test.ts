import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveGradebookAssessment } from '@/lib/gradebook-save'

const assessment = { assessment_id: 'a1', assessment_type: 'assignment' as const, title: 'Old', weight: 10, code: 'A1', possible: 30, include_in_final: true }
const ok = (data: unknown = {}) => ({ ok: true, json: async () => data })
afterEach(() => vi.unstubAllGlobals())

describe('saveGradebookAssessment', () => {
  it('renames through Classwork then saves category and weight', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetch)
    await saveGradebookAssessment({ classroomId: 'c1', assessment, title: 'New', categoryId: null, weight: 20 })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/teacher/assignments/a1', '/api/teacher/gradebook'])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ title: 'New' })
  })
  it('uses the versioned draft endpoint for Test titles without replacing questions', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ draft: { version: 7 } })).mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetch)
    await saveGradebookAssessment({ classroomId: 'c1', assessment: { ...assessment, assessment_type: 'test' }, title: 'New', categoryId: null, weight: 20 })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ version: 7, patch: [{ op: 'replace', path: '/title', value: 'New' }] })
  })
  it('does not save weights when renaming fails', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Draft updated elsewhere' }) })
    vi.stubGlobal('fetch', fetch)
    await expect(saveGradebookAssessment({ classroomId: 'c1', assessment, title: 'New', categoryId: null, weight: 20 })).rejects.toThrow('Draft updated elsewhere')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('reports a partial save accurately instead of claiming that nothing changed', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValue({ ok: false, json: async () => ({ error: 'Unavailable' }) })
    vi.stubGlobal('fetch', fetch)
    await expect(saveGradebookAssessment({ classroomId: 'c1', assessment, title: 'New', categoryId: null, weight: 20 })).rejects.toThrow('Title saved')
  })
})
