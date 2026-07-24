import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/tests/[id]/draft/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  buildNextDraftContent,
  ensureAssessmentDraft,
  updateAssessmentDraft,
} from '@/lib/server/assessment-drafts'
import { updateTestDocumentsAtomic } from '@/lib/server/test-document-authoring'

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
      show_results: false,
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
  updateAssessmentDraft: vi.fn(),
}))
vi.mock('@/lib/server/test-document-authoring', () => ({
  updateTestDocumentsAtomic: vi.fn(),
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

    vi.mocked(updateAssessmentDraft).mockResolvedValue({
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
      error: null,
    } as any)
    vi.mocked(updateTestDocumentsAtomic).mockImplementation(async (input) => ({
      ok: true,
      cleanupPaths: [],
      test: {
        id: 'test-1',
        documents: input.proposedDocuments,
      },
    }))
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
    expect(updateTestDocumentsAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocuments: undefined,
        proposedDocuments: documents,
        showResults: true,
        teacherId: 'teacher-1',
        testId: 'test-1',
        title: 'Updated Test',
      })
    )
    expect(updateAssessmentDraft).toHaveBeenCalledWith(
      mockSupabaseClient,
      'draft-1',
      4,
      'teacher-1',
      expect.objectContaining({
        source_format: 'markdown',
        source_markdown: 'Title: Updated Test',
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
    expect(updateAssessmentDraft).not.toHaveBeenCalled()
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
    vi.mocked(updateTestDocumentsAtomic).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'The test documents changed elsewhere. Reload and try again.',
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
