import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/tests/[id]/draft/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  buildNextDraftContent,
  getAssessmentDraftByType,
  updateAssessmentDraft,
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
  createAssessmentDraft: vi.fn(),
  getAssessmentDraftByType: vi.fn(),
  isMissingAssessmentDraftsError: vi.fn(() => false),
  updateAssessmentDraft: vi.fn(),
  validateTestDraftContent: vi.fn((content: any) => ({ valid: true, value: content })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PATCH /api/teacher/tests/[id]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(getAssessmentDraftByType).mockResolvedValue({
      draft: {
        id: 'draft-1',
        assessment_type: 'test',
        assessment_id: 'test-1',
        classroom_id: 'classroom-1',
        content: {
          title: 'Seed Test',
          show_results: false,
          questions: [],
        },
        version: 3,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      error: null,
    } as any)

    vi.mocked(buildNextDraftContent).mockReturnValue({
      ok: true,
      content: {
        title: 'Updated Test',
        show_results: true,
        questions: [],
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
        },
        version: 4,
        created_by: 'teacher-1',
        updated_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z',
      },
      error: null,
    } as any)
  })

  it('persists validated documents when provided', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return { update: updateSpy }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

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
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Updated Test',
        show_results: true,
        documents,
      })
    )
    expect(data.draft.content.title).toBe('Updated Test')
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
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })
})
