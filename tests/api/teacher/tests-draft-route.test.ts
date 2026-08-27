import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/tests/[id]/draft/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  buildNextDraftContent,
  ensureAssessmentDraft,
  getAssessmentDraftByType,
  saveTestDraftAtomic,
} from '@/lib/server/assessment-drafts'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      classroom_id: 'classroom-1',
      title: 'Seed Test',
      status: 'draft',
      show_results: false,
      documents: [],
      classrooms: { archived_at: null },
    },
  })),
}))

vi.mock('@/lib/server/assessment-drafts', () => ({
  buildNextDraftContent: vi.fn(),
  buildTestDraftContentFromRows: vi.fn(() => ({
    title: 'Seed Test',
    show_results: false,
    questions: [],
  })),
  ensureAssessmentDraft: vi.fn(),
  getAssessmentDraftByType: vi.fn(),
  saveTestDraftAtomic: vi.fn(),
}))

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('PATCH /api/teacher/tests/[id]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(ensureAssessmentDraft).mockResolvedValue({
      ok: true,
      draft: {
        id: 'draft-1',
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        content: {
          title: 'Seed Test',
          show_results: false,
          questions: [],
          source_format: 'markdown',
          source_markdown: 'Title: Seed Test',
        },
        version: 3,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    } as any)

    vi.mocked(buildNextDraftContent).mockReturnValue({
      ok: true,
      content: {
        title: 'Updated Test',
        show_results: true,
        questions: [],
        source_format: 'markdown',
        source_markdown: 'Title: Updated Test',
      },
    } as any)

    vi.mocked(saveTestDraftAtomic).mockResolvedValue({
      ok: true,
      draft: {
        id: 'draft-1',
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        content: {
          title: 'Updated Test',
          show_results: true,
          questions: [],
          source_format: 'markdown',
          source_markdown: 'Title: Updated Test',
        },
        version: 4,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z',
      },
      test: { id: 'test-1', status: 'draft' },
    } as any)
  })

  it('loads the draft through the shared assessment draft helper', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.draft.id).toBe('draft-1')
    expect(ensureAssessmentDraft).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({
        assessmentType: 'test',
        assessment: expect.objectContaining({
          id: 'test-1',
          classroom_id: 'classroom-1',
        }),
        userId: 'teacher-1',
        questionsTable: 'test_questions',
        questionsForeignKey: 'test_id',
        validateOptions: { allowEmptyQuestionText: true },
      })
    )
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith('teacher-1', 'test-1', {
      checkArchived: true,
    })
  })

  it('configures marked drafts to ignore coincident internal row IDs', async () => {
    await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft'),
      { params: Promise.resolve({ id: 'test-1' }) },
    )

    const config = vi.mocked(ensureAssessmentDraft).mock.calls[0]?.[1] as any
    const firstRowId = '10000000-0000-4000-8000-000000000001'
    const firstPortableId = '20000000-0000-4000-8000-000000000001'
    const secondPortableId = '30000000-0000-4000-8000-000000000001'
    const content = {
      title: 'Portable Test',
      show_results: false,
      question_identity_version: 1,
      questions: [firstPortableId, secondPortableId].map((id) => ({ id })),
    }
    const rows = [{
      id: firstRowId,
      artifact_id: firstPortableId,
      source_artifact_id: firstPortableId,
    }, {
      id: firstPortableId,
      artifact_id: secondPortableId,
      source_artifact_id: secondPortableId,
    }]

    expect(config.projectContent(content, rows)).toEqual({ ok: true, content })
  })

  it('persists validated documents when provided', async () => {
    const documents = [
      {
        id: 'doc-1',
        source: 'link',
        title: 'Java API',
        url: 'https://docs.oracle.com/en/java/',
      },
      {
        id: 'doc-2',
        source: 'text',
        title: 'Allowed formulas',
        content: 'distance = rate * time',
      },
    ]

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          content: { title: 'Updated Test', show_results: true, questions: [] },
          documents,
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(saveTestDraftAtomic).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({
        expectedDocuments: [],
        documents,
        expectedDraftVersion: 3,
        teacherId: 'teacher-1',
        testId: 'test-1',
      })
    )
    expect(data.draft.content.title).toBe('Updated Test')
    expect(ensureAssessmentDraft).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({
        assessmentType: 'test',
        assessment: expect.objectContaining({ id: 'test-1' }),
        userId: 'teacher-1',
      })
    )
  })

  it('validates draft content through the route-owned validation boundary', async () => {
    vi.mocked(buildNextDraftContent).mockImplementationOnce(
      ((_currentContent, payload, validate) => {
        const validation = validate(payload.content)
        return validation.valid
          ? { ok: true, content: validation.value }
          : { ok: false, status: 400, error: validation.error }
      }) as typeof buildNextDraftContent
    )

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          content: { title: '  ', show_results: true, questions: [] },
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Title is required')
    expect(saveTestDraftAtomic).not.toHaveBeenCalled()
  })

  it('bases active Test patches on materialized rows so stale draft questions stay deleted', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Activated Test',
        status: 'active',
        show_results: false,
        classrooms: { archived_at: null },
      },
    } as any)

    const loadResponse = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft'),
      { params: Promise.resolve({ id: 'test-1' }) },
    )

    expect(loadResponse.status).toBe(200)
    expect(ensureAssessmentDraft).toHaveBeenLastCalledWith(
      mockSupabaseClient,
      expect.objectContaining({
        preferPersistedRows: true,
      }),
    )

    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Activated Test',
        status: 'active',
        show_results: false,
        documents: [],
        classrooms: { archived_at: null },
      },
    } as any)
    const materializedContent = {
      title: 'Activated Test',
      show_results: false,
      questions: [{
        id: 'artifact-retained',
        type: 'short_answer',
        question_text: 'Edited through the row API',
        points: 2,
        position: 0,
      }],
      source_format: 'markdown',
      source_markdown: 'Title: Activated Test',
    }
    vi.mocked(ensureAssessmentDraft).mockResolvedValueOnce({
      ok: true,
      draft: {
        id: 'draft-1',
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        content: materializedContent,
        version: 3,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    } as any)
    vi.mocked(buildNextDraftContent).mockImplementationOnce(
      ((currentContent) => ({
        ok: true,
        content: { ...currentContent, title: 'Active save' },
      })) as typeof buildNextDraftContent,
    )

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          patch: [{ op: 'replace', path: '/title', value: 'Active save' }],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) },
    )

    expect(response.status).toBe(200)
    expect(saveTestDraftAtomic).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({
        content: {
          ...materializedContent,
          title: 'Active save',
        },
        expectedDraftVersion: 3,
        teacherId: 'teacher-1',
        testId: 'test-1',
      }),
    )
    expect(ensureAssessmentDraft).toHaveBeenLastCalledWith(
      mockSupabaseClient,
      expect.objectContaining({ preferPersistedRows: true }),
    )
    expect(buildNextDraftContent).toHaveBeenCalledWith(
      materializedContent,
      {
        patch: [{ op: 'replace', path: '/title', value: 'Active save' }],
        content: undefined,
      },
      expect.any(Function),
    )
  })

  it('returns 400 and blocks save when documents payload is invalid', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return { update: updateSpy }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          content: { title: 'Updated Test', show_results: true, questions: [] },
          documents: [{ id: 'bad-doc', source: 'link', title: 'Bad', url: 'javascript:alert(1)' }],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('valid id/title')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith('teacher-1', 'test-1', {
      checkArchived: true,
    })
  })

  it('returns the saved draft with 409 when document metadata changed concurrently', async () => {
    vi.mocked(saveTestDraftAtomic).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'The test documents changed elsewhere. Reload and try again.',
    })
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        version: 4,
        content: { title: 'Updated Test', show_results: true, questions: [] },
      } as any,
      error: null,
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/draft', {
        method: 'PATCH',
        body: JSON.stringify({
          version: 3,
          content: { title: 'Updated Test', show_results: true, questions: [] },
          documents: [{
            id: 'doc-1',
            title: 'Reference',
            source: 'link',
            url: 'https://docs.example.com/reference',
          }],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.draft.version).toBe(4)
    expect(data.error).toContain('changed elsewhere')
  })
})
