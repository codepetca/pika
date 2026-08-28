import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as createDraft } from '@/app/api/teacher/classrooms/[id]/curriculum-import/draft/route'
import { POST as applyDraft } from '@/app/api/teacher/classrooms/[id]/curriculum-import/apply/route'
import { ApiError } from '@/lib/api-handler'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  extractCourseGuideImportDraft: vi.fn(),
  getServiceRoleClient: vi.fn(),
  hydrateClassroomRecord: vi.fn((value) => value),
  createProvenanceToken: vi.fn(() => 'p'.repeat(80)),
  verifyProvenanceToken: vi.fn(),
  acquireExtractionSlot: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: mocks.assertTeacherCanMutateClassroom,
  hydrateClassroomRecord: mocks.hydrateClassroomRecord,
}))
vi.mock('@/lib/server/course-guide-import', () => ({
  extractCourseGuideImportDraft: mocks.extractCourseGuideImportDraft,
}))
vi.mock('@/lib/server/course-guide-import-provenance', () => ({
  createCourseGuideImportProvenanceToken: mocks.createProvenanceToken,
  verifyCourseGuideImportProvenanceToken: mocks.verifyProvenanceToken,
}))
vi.mock('@/lib/server/course-guide-import-rate-limit', () => ({
  acquireCourseGuideImportExtractionSlot: mocks.acquireExtractionSlot,
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
  mocks.verifyProvenanceToken.mockReturnValue({
    citationMarkdown: 'Source: Ontario curriculum — curriculum.pdf',
  })
  mocks.acquireExtractionSlot.mockReturnValue(vi.fn())
})

describe('POST curriculum import draft', () => {
  it('authorizes before extracting a validated PDF and returns only a draft', async () => {
    const draft = {
      sourceTitle: 'Ontario curriculum',
      sourceUrl: null,
      sourceFilename: 'curriculum.pdf',
      draftMarkdown: 'Reviewed draft',
      citationMarkdown: 'Source: Ontario curriculum — curriculum.pdf',
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
    await expect(response.json()).resolves.toEqual({ draft, provenanceToken: 'p'.repeat(80) })
    expect(mocks.assertTeacherCanMutateClassroom).toHaveBeenCalledWith('teacher-1', 'classroom-1')
    expect(mocks.extractCourseGuideImportDraft).toHaveBeenCalledWith(expect.objectContaining({
      type: 'file',
      filename: 'curriculum.pdf',
    }))
    expect(mocks.createProvenanceToken).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
      draft,
    }))
    expect(mocks.acquireExtractionSlot).toHaveBeenCalledWith({
      teacherId: 'teacher-1',
      classroomId: 'classroom-1',
    })
  })

  it('returns 429 before extraction when the teacher has exhausted the bounded slot', async () => {
    mocks.acquireExtractionSlot.mockImplementation(() => {
      throw new ApiError(429, 'Too many curriculum import attempts. Try again in a few minutes.')
    })
    const formData = new FormData()
    formData.set('sourceType', 'url')
    formData.set('sourceUrl', 'https://example.ca/curriculum.pdf')
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/draft',
      { method: 'POST', body: formData },
    )

    const response = await createDraft(request, context())

    expect(response.status).toBe(429)
    expect(mocks.extractCourseGuideImportDraft).not.toHaveBeenCalled()
  })

  it('releases the bounded extraction slot when the provider fails', async () => {
    const release = vi.fn()
    mocks.acquireExtractionSlot.mockReturnValue(release)
    mocks.extractCourseGuideImportDraft.mockRejectedValue(new Error('provider failed'))
    const formData = new FormData()
    formData.set('sourceType', 'url')
    formData.set('sourceUrl', 'https://example.ca/curriculum.pdf')
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/draft',
      { method: 'POST', body: formData },
    )

    const response = await createDraft(request, context())

    expect(response.status).toBe(422)
    expect(release).toHaveBeenCalledTimes(1)
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
    query.is = vi.fn(() => query)
    query.select = vi.fn(() => query)
    query.maybeSingle = vi.fn().mockResolvedValue(result)
    const supabase = { from: vi.fn(() => query) }
    mocks.getServiceRoleClient.mockReturnValue(supabase)
    return { query, supabase }
  }

  it('appends only after confirmation and compares the expected teacher content', async () => {
    const updatedClassroom = {
      id: 'classroom-1',
      course_overview_markdown: 'Teacher content\n\n---\n\nReviewed draft\n\nSource: Ontario curriculum — curriculum.pdf',
    }
    const { query } = setupUpdate({ data: updatedClassroom, error: null })
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/apply',
      {
        method: 'POST',
        body: JSON.stringify({
          draftMarkdown: 'Reviewed draft',
          expectedOverviewMarkdown: 'Teacher content',
          provenanceToken: 'p'.repeat(80),
        }),
      },
    )

    const response = await applyDraft(request, context())

    expect(response.status).toBe(200)
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      course_overview_markdown: 'Teacher content\n\n---\n\nReviewed draft\n\nSource: Ontario curriculum — curriculum.pdf',
    }))
    expect(query.eq).toHaveBeenCalledWith('course_overview_markdown', 'Teacher content')
    expect(query.eq).toHaveBeenCalledWith('teacher_id', 'teacher-1')
    expect(query.is).toHaveBeenCalledWith('archived_at', null)
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
          provenanceToken: 'p'.repeat(80),
        }),
      },
    )

    const response = await applyDraft(request, context())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'The Course Guide changed while you were reviewing. Reopen the import assistant and try again.',
    })
  })

  it('authorizes before parsing the apply body', async () => {
    setupUpdate({ data: null, error: null })
    mocks.assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/apply',
      { method: 'POST', body: '{' },
    )

    const response = await applyDraft(request, context())

    expect(response.status).toBe(403)
    expect(mocks.verifyProvenanceToken).not.toHaveBeenCalled()
  })

  it('rejects tampered or expired provenance before updating the classroom', async () => {
    const { query } = setupUpdate({ data: null, error: null })
    mocks.verifyProvenanceToken.mockReturnValue(null)
    const request = new NextRequest(
      'http://localhost/api/teacher/classrooms/classroom-1/curriculum-import/apply',
      {
        method: 'POST',
        body: JSON.stringify({
          draftMarkdown: 'Reviewed draft',
          expectedOverviewMarkdown: 'Teacher content',
          provenanceToken: 'x'.repeat(80),
        }),
      },
    )

    const response = await applyDraft(request, context())

    expect(response.status).toBe(409)
    expect(query.update).not.toHaveBeenCalled()
  })
})
