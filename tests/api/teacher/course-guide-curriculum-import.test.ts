import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as createDraft } from '@/app/api/teacher/classrooms/[id]/curriculum-import/draft/route'
import { POST as applyDraft } from '@/app/api/teacher/classrooms/[id]/curriculum-import/apply/route'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  extractCourseGuideImportDraft: vi.fn(),
  getServiceRoleClient: vi.fn(),
  hydrateClassroomRecord: vi.fn((value) => value),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: mocks.assertTeacherCanMutateClassroom,
  hydrateClassroomRecord: mocks.hydrateClassroomRecord,
}))
vi.mock('@/lib/server/course-guide-import', () => ({
  extractCourseGuideImportDraft: mocks.extractCourseGuideImportDraft,
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))

function context() {
  return { params: { id: 'classroom-1' } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ id: 'teacher-1' })
  mocks.assertTeacherCanMutateClassroom.mockResolvedValue({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
  })
})

describe('POST curriculum import draft', () => {
  it('authorizes before extracting a validated PDF and returns only a draft', async () => {
    const draft = {
      sourceTitle: 'Ontario curriculum',
      sourceUrl: null,
      sourceFilename: 'curriculum.pdf',
      draftMarkdown: 'Reviewed draft',
    }
    mocks.extractCourseGuideImportDraft.mockResolvedValue(draft)
    const formData = new FormData()
    formData.set('sourceType', 'file')
    formData.set('sourceUrl', '')
    formData.set('file', new File(['%PDF-1.7 curriculum'], 'curriculum.pdf', {
      type: 'application/pdf',
    }))
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/draft',
      { method: 'POST', body: formData },
    )

    const response = await createDraft(request, context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ draft })
    expect(mocks.assertTeacherCanMutateClassroom).toHaveBeenCalledWith('teacher-1', 'classroom-1')
    expect(mocks.extractCourseGuideImportDraft).toHaveBeenCalledWith(expect.objectContaining({
      type: 'file',
      filename: 'curriculum.pdf',
    }))
  })

  it('does not extract when the teacher cannot mutate the classroom', async () => {
    mocks.assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/draft',
      { method: 'POST', body: new FormData() },
    )

    const response = await createDraft(request, context())

    expect(response.status).toBe(403)
    expect(mocks.extractCourseGuideImportDraft).not.toHaveBeenCalled()
  })
})

describe('POST curriculum import apply', () => {
  function setupUpdate(result: { data: unknown; error: unknown }) {
    const query: Record<string, ReturnType<typeof vi.fn>> = {}
    query.update = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.select = vi.fn(() => query)
    query.maybeSingle = vi.fn().mockResolvedValue(result)
    const supabase = { from: vi.fn(() => query) }
    mocks.getServiceRoleClient.mockReturnValue(supabase)
    return { query, supabase }
  }

  it('appends only after confirmation and compares the expected teacher content', async () => {
    const updatedClassroom = {
      id: 'classroom-1',
      course_overview_markdown: 'Teacher content\n\n---\n\nReviewed draft\n\nSource: Ontario curriculum (curriculum.pdf)',
    }
    const { query } = setupUpdate({ data: updatedClassroom, error: null })
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/apply',
      {
        method: 'POST',
        body: JSON.stringify({
          draftMarkdown: 'Reviewed draft',
          expectedOverviewMarkdown: 'Teacher content',
          sourceTitle: 'Ontario curriculum',
          sourceUrl: null,
          sourceFilename: 'curriculum.pdf',
        }),
      },
    )

    const response = await applyDraft(request, context())

    expect(response.status).toBe(200)
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      course_overview_markdown: 'Teacher content\n\n---\n\nReviewed draft\n\nSource: Ontario curriculum (curriculum.pdf)',
    }))
    expect(query.eq).toHaveBeenCalledWith('course_overview_markdown', 'Teacher content')
    await expect(response.json()).resolves.toEqual({ classroom: updatedClassroom })
  })

  it('returns a conflict instead of overwriting a guide changed during review', async () => {
    setupUpdate({ data: null, error: null })
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/apply',
      {
        method: 'POST',
        body: JSON.stringify({
          draftMarkdown: 'Reviewed draft',
          expectedOverviewMarkdown: 'Stale teacher content',
          sourceTitle: 'Ontario curriculum',
          sourceUrl: 'https://example.ca/curriculum.pdf',
          sourceFilename: null,
        }),
      },
    )

    const response = await applyDraft(request, context())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'The Course Guide changed while you were reviewing. Reopen the import assistant and try again.',
    })
  })
})
