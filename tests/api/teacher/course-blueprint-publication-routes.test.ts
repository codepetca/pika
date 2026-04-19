import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as GET_CLASSROOM_ARCHIVE } from '@/app/api/teacher/classrooms/[id]/archive/route'
import { POST as POST_CLASSROOM_ARCHIVE_IMPORT } from '@/app/api/teacher/classrooms/archive/import/route'
import { GET as GET_MERGE_SUGGESTIONS } from '@/app/api/teacher/course-blueprints/[id]/merge-suggestions/route'
import { POST as POST_MERGE_APPLY } from '@/app/api/teacher/course-blueprints/[id]/merge-apply/route'

const mockRequireRole = vi.fn()
const mockExportArchive = vi.fn()
const mockImportArchive = vi.fn()
const mockGetMergeSuggestions = vi.fn()
const mockApplyMerge = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: (...args: any[]) => mockRequireRole(...args),
}))

vi.mock('@/lib/server/classroom-archives', () => ({
  exportClassroomArchive: (...args: any[]) => mockExportArchive(...args),
  importClassroomArchive: (...args: any[]) => mockImportArchive(...args),
}))

vi.mock('@/lib/server/course-sites', () => ({
  getBlueprintMergeSuggestionSet: (...args: any[]) => mockGetMergeSuggestions(...args),
  applyBlueprintMergeSuggestions: (...args: any[]) => mockApplyMerge(...args),
}))

describe('teacher blueprint publication routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRole.mockResolvedValue({ id: 'teacher-1' })
  })

  it('downloads classroom archives', async () => {
    mockExportArchive.mockResolvedValue({
      ok: true,
      manifest: { classroom_title: 'Computer Science 11' },
      archive: new Uint8Array([1, 2, 3]),
    })

    const response = await GET_CLASSROOM_ARCHIVE(
      new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/archive'),
      { params: Promise.resolve({ id: 'c-1' }) } as any
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-tar')
    expect(response.headers.get('content-disposition')).toContain('computer-science-11.classroom-archive.tar')
  })

  it('imports classroom archives', async () => {
    mockImportArchive.mockResolvedValue({
      ok: true,
      classroom: { id: 'c-2', title: 'Restored class' },
    })

    const response = await POST_CLASSROOM_ARCHIVE_IMPORT(new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/archive/import',
      { method: 'POST', body: new Uint8Array([9, 8, 7]) }
    ))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ classroom: { id: 'c-2', title: 'Restored class' } })
  })

  it('returns blueprint merge suggestions', async () => {
    mockGetMergeSuggestions.mockResolvedValue({
      ok: true,
      suggestionSet: { classroom_id: 'c-1', suggestions: [] },
    })

    const response = await GET_MERGE_SUGGESTIONS(
      new NextRequest('http://localhost:3000/api/teacher/course-blueprints/b-1/merge-suggestions?classroomId=11111111-1111-4111-8111-111111111111'),
      { params: Promise.resolve({ id: 'b-1' }) } as any
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ suggestion_set: { classroom_id: 'c-1', suggestions: [] } })
  })

  it('applies selected blueprint merge areas', async () => {
    mockApplyMerge.mockResolvedValue({ ok: true })

    const response = await POST_MERGE_APPLY(
      new NextRequest('http://localhost:3000/api/teacher/course-blueprints/b-1/merge-apply', {
        method: 'POST',
        body: JSON.stringify({
          classroomId: '11111111-1111-4111-8111-111111111111',
          areas: ['overview', 'assignments'],
        }),
      }),
      { params: Promise.resolve({ id: 'b-1' }) } as any
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })
})
