import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as POST_CLASSROOM_BLUEPRINT } from '@/app/api/teacher/classrooms/[id]/blueprint/route'
import { GET as GET_MERGE_SUGGESTIONS } from '@/app/api/teacher/course-blueprints/[id]/merge-suggestions/route'
import { POST as POST_MERGE_APPLY } from '@/app/api/teacher/course-blueprints/[id]/merge-apply/route'

const mockRequireRole = vi.fn()
const mockCreateBlueprintFromClassroom = vi.fn()
const mockGetMergeSuggestions = vi.fn()
const mockApplyMerge = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: (...args: any[]) => mockRequireRole(...args),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  createCourseBlueprintFromClassroom: (...args: any[]) => mockCreateBlueprintFromClassroom(...args),
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

  it('creates a classroom blueprint and returns the redirect URL', async () => {
    mockCreateBlueprintFromClassroom.mockResolvedValue({
      ok: true,
      blueprint: { id: 'b-9', title: 'Reusable Draft' },
    })

    const response = await POST_CLASSROOM_BLUEPRINT(
      new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/blueprint', {
        method: 'POST',
        body: JSON.stringify({ title: 'Reusable Draft' }),
      }),
      { params: Promise.resolve({ id: 'c-1' }) } as any
    )

    expect(mockCreateBlueprintFromClassroom).toHaveBeenCalledWith('teacher-1', 'c-1', { title: 'Reusable Draft' })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      blueprint_id: 'b-9',
      redirect_url: '/teacher/blueprints?blueprint=b-9&fromClassroom=c-1',
    })
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
