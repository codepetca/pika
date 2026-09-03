import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, GET, PATCH } from '@/app/api/teacher/tests/[id]/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { deleteTeacherTestAtomic } from '@/lib/server/test-deletion'
import {
  getAssessmentDraftByType,
  publishTestFromDraftAtomic,
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
      title: 'Unit Test',
      classroom_id: 'classroom-1',
      status: 'draft',
      show_results: false,
      position: 0,
      points_possible: null,
      include_in_final: false,
      created_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      classrooms: { archived_at: null },
    },
  })),
}))
vi.mock('@/lib/server/test-deletion', () => ({
  deleteTeacherTestAtomic: vi.fn(async () => ({ deleted: true, responsesCount: 3 })),
}))
vi.mock('@/lib/server/test-document-authoring', () => ({
  updateTestDocumentsAtomic: vi.fn(),
}))

vi.mock('@/lib/server/assessment-drafts', () => ({
  publishTestFromDraftAtomic: vi.fn(async () => ({
    ok: true,
    draftVersion: 3,
    test: { id: 'test-1', status: 'closed', title: 'Unit Test', show_results: false },
  })),
  getAssessmentDraftByType: vi.fn(async () => ({ draft: null, error: null })),
  isMissingAssessmentDraftsError: vi.fn(() => false),
}))

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('DELETE /api/teacher/tests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes through the atomic test boundary', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'test-1' }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, responses_count: 3 })
    expect(deleteTeacherTestAtomic).toHaveBeenCalledWith({
      testId: 'test-1',
      teacherId: 'teacher-1',
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/teacher/tests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc = vi.fn(async () => ({ data: {}, error: null }))
    vi.mocked(updateTestDocumentsAtomic).mockImplementation(async (input) => ({
      ok: true,
      cleanupPaths: [],
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: input.title ?? 'Unit Test',
        status: input.status ?? 'draft',
        show_results: input.showResults ?? false,
        documents: input.proposedDocuments,
      },
    }))
  })

  it('returns canonical questions for closed tests even when a draft overlay exists', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Closed Test',
        classroom_id: 'classroom-1',
        status: 'closed',
        show_results: false,
        position: 0,
        points_possible: null,
        include_in_final: false,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { archived_at: null },
      } as any,
    })
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        content: {
          title: 'Stale Draft Title',
          show_results: true,
          questions: [
            {
              id: 'q-1',
              question_type: 'open_response',
              question_text: 'Draft question text',
              options: [],
              correct_option: null,
              answer_key: null,
              sample_solution: 'stale draft sample solution',
              points: 5,
              response_max_chars: 5000,
              response_monospace: true,
            },
          ],
        },
      } as any,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-1',
                  test_id: 'test-1',
                  artifact_id: '20000000-0000-4000-8000-000000000001',
                  source_artifact_id: '30000000-0000-4000-8000-000000000001',
                  question_type: 'open_response',
                  question_text: 'Canonical question text',
                  options: [],
                  correct_option: null,
                  answer_key: null,
                  sample_solution: 'canonical sample solution',
                  points: 5,
                  response_max_chars: 5000,
                  response_monospace: true,
                  position: 0,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).not.toHaveProperty('quiz')
    expect(data.test.title).toBe('Closed Test')
    expect(data.test.show_results).toBe(false)
    expect(data.questions[0].question_text).toBe('Canonical question text')
    expect(data.questions[0].sample_solution).toBe('canonical sample solution')
    expect(data.questions[0]).not.toHaveProperty('artifact_id')
    expect(data.questions[0]).not.toHaveProperty('source_artifact_id')
    // The response id must be the portable identity, matching what draft-status
    // Tests already return here (and what Blueprint capture/activation treat as
    // canonical) — never the internal row id — so this field means the same
    // thing regardless of Test lifecycle stage.
    expect(data.questions[0].id).toBe('30000000-0000-4000-8000-000000000001')
  })

  it('keeps marked portable draft IDs out of the legacy row-ID namespace', async () => {
    const rowAId = '10000000-0000-4000-8000-000000000001'
    const portableAId = '20000000-0000-4000-8000-000000000001'
    const portableBId = '30000000-0000-4000-8000-000000000001'

    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        content: {
          title: 'Migrated Test',
          show_results: false,
          question_identity_version: 1,
          questions: [
            {
              id: portableAId,
              question_type: 'open_response',
              question_text: 'Question A',
              options: [],
              correct_option: null,
              answer_key: null,
              sample_solution: null,
              points: 1,
              response_max_chars: 5000,
              response_monospace: false,
            },
            {
              id: portableBId,
              question_type: 'open_response',
              question_text: 'Question B',
              options: [],
              correct_option: null,
              answer_key: null,
              sample_solution: null,
              points: 1,
              response_max_chars: 5000,
              response_monospace: false,
            },
          ],
        },
      } as any,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: rowAId,
                  test_id: 'test-1',
                  artifact_id: portableAId,
                  source_artifact_id: null,
                  question_type: 'open_response',
                  question_text: 'Question A',
                  options: [],
                  correct_option: null,
                  answer_key: null,
                  sample_solution: null,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                  position: 0,
                },
                {
                  id: portableAId,
                  test_id: 'test-1',
                  artifact_id: portableBId,
                  source_artifact_id: null,
                  question_type: 'open_response',
                  question_text: 'Question B',
                  options: [],
                  correct_option: null,
                  answer_key: null,
                  sample_solution: null,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                  position: 1,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.questions.map((question: { id: string }) => question.id)).toEqual([
      portableAId,
      portableBId,
    ])
  })

  it('does not allow a draft to bypass publication into the legacy active state', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active', draft_version: 3 }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Cannot transition from draft to active' })
    expect(publishTestFromDraftAtomic).not.toHaveBeenCalled()
  })

  it('returns 400 when publishing with an incomplete question', async () => {
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        version: 3,
        content: {
          title: 'Unit Test',
          show_results: false,
          question_identity_version: 1,
          questions: [{
            id: '20000000-0000-4000-8000-000000000001',
            question_type: 'multiple_choice',
            question_text: '   ',
            options: ['Option 1', 'Option 2'],
            correct_option: 0,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
      } as any,
      error: null,
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed', draft_version: 3 }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Q1: Question text is required')
    expect(publishTestFromDraftAtomic).not.toHaveBeenCalled()
  })

  it('returns 400 when publishing with a generated placeholder title', async () => {
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        version: 3,
        content: {
          title: 'Untitled 2026-05-14 10:45:00',
          show_results: false,
          question_identity_version: 1,
          questions: [{
            id: '20000000-0000-4000-8000-000000000001',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            correct_option: 1,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
      } as any,
      error: null,
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed', draft_version: 3 }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Add a title before publishing this Test',
    })
    expect(publishTestFromDraftAtomic).not.toHaveBeenCalled()
  })

  it('publishes a draft test closed when all questions are complete', async () => {
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        version: 3,
        content: {
          title: 'Unit Test',
          show_results: false,
          question_identity_version: 1,
          questions: [{
            id: '20000000-0000-4000-8000-000000000001',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            correct_option: 1,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
      } as any,
      error: null,
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed', draft_version: 3 }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.test.status).toBe('closed')
    expect(publishTestFromDraftAtomic).toHaveBeenCalledWith(mockSupabaseClient, {
      expectedDraftVersion: 3,
      teacherId: 'teacher-1',
      testId: 'test-1',
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('fails closed when the publication RPC returns a non-closed Test', async () => {
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        content: {
          title: 'Unit Test',
          show_results: false,
          question_identity_version: 1,
          questions: [{
            id: '30000000-0000-4000-8000-000000000014',
            question_type: 'multiple_choice',
            question_text: 'Ready to publish?',
            options: ['Yes', 'No'],
            correct_option: 0,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
        version: 3,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      error: null,
    })
    vi.mocked(publishTestFromDraftAtomic).mockResolvedValueOnce({
      ok: true,
      draftVersion: 3,
      test: { id: 'test-1', status: 'active' },
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed', draft_version: 3 }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) },
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to publish test' })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('updates test documents when payload is valid', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const documents = [
      {
        id: 'doc-1',
        title: 'Java API',
        url: 'https://docs.oracle.com/en/java/',
        source: 'link',
      },
    ]

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ documents }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateTestDocumentsAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocuments: undefined,
        expectedStatus: 'draft',
        proposedDocuments: documents,
        teacherId: 'teacher-1',
        testId: 'test-1',
      })
    )
    expect(data.test.documents).toEqual(documents)
  })

  it('returns 400 for invalid test documents payload', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: vi.fn(),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({
          documents: [{ id: 'doc-1', title: 'Broken', url: 'javascript:alert(1)', source: 'link' }],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('valid id/title')
  })

  it('updates text documents when payload is valid', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const documents = [
      {
        id: 'doc-text',
        title: 'Allowed formulas',
        source: 'text',
        content: 'distance = rate * time',
      },
    ]

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ documents }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateTestDocumentsAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        proposedDocuments: documents,
      })
    )
    expect(data.test.documents).toEqual(documents)
  })

  it('returns 409 instead of falling back when the document CAS loses', async () => {
    vi.mocked(updateTestDocumentsAtomic).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'The test documents changed elsewhere. Reload and try again.',
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({
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

    expect(response.status).toBe(409)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('rejects the legacy active-to-closed lifecycle path', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        status: 'active',
        show_results: false,
        position: 0,
        points_possible: null,
        include_in_final: false,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { archived_at: null },
      } as any,
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Cannot transition from active to closed' })
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('rejects the legacy closed-to-active lifecycle path', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        status: 'closed',
        show_results: false,
        position: 0,
        points_possible: null,
        include_in_final: false,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { archived_at: null },
      } as any,
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Cannot transition from closed to active' })
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})
