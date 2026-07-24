import { describe, expect, it, vi } from 'vitest'
import {
  buildNextDraftContent,
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  syncTestQuestionsFromDraft,
  updateAssessmentDraft,
} from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'

const TEST_ID_1 = '33333333-3333-4333-8333-333333333333'
const TEST_ID_2 = '44444444-4444-4444-8444-444444444444'

describe('assessment drafts', () => {
  it('validates test draft content and allows empty question text when requested', () => {
    expect(
      validateTestDraftContent(
        {
          title: 'Draft Test',
          show_results: false,
          source_format: 'markdown',
          source_markdown: 'Title: Draft Test\r\n\r\n## Questions',
          questions: [
            {
              id: TEST_ID_1,
              question_type: 'open_response',
              question_text: '   ',
              points: 5,
              response_max_chars: 1200,
            },
          ],
        },
        { allowEmptyQuestionText: true }
      )
    ).toEqual({
      valid: true,
      value: {
        title: 'Draft Test',
        show_results: false,
        source_format: 'markdown',
        source_markdown: 'Title: Draft Test\n\n## Questions',
        questions: [
          {
            id: TEST_ID_1,
            question_type: 'open_response',
            question_text: '',
            options: [],
            correct_option: null,
            answer_key: null,
            sample_solution: null,
            points: 5,
            response_max_chars: 1200,
            response_monospace: false,
          },
        ],
      },
    })
  })

  it('preserves markdown metadata when applying a full test draft update', () => {
    const result = buildNextDraftContent(
      {
        title: 'Current Test',
        show_results: false,
        questions: [],
        source_format: 'markdown' as const,
        source_markdown: 'Title: Current Test',
      },
      {
        content: {
          title: 'Updated Test',
          show_results: true,
          questions: [],
          source_format: 'markdown',
          source_markdown: 'Title: Updated Test',
        },
      },
      validateTestDraftContent
    )

    expect(result).toEqual({
      ok: true,
      content: {
        title: 'Updated Test',
        show_results: true,
        questions: [],
        source_format: 'markdown',
        source_markdown: 'Title: Updated Test',
      },
    })
  })

  it('returns indexed validation errors for invalid test draft questions', () => {
    expect(
      validateTestDraftContent({
        title: 'Draft Test',
        show_results: false,
        questions: [
          {
            id: TEST_ID_1,
            question_type: 'multiple_choice',
            question_text: 'Pick one',
            options: ['Only one'],
            correct_option: 0,
          },
        ],
      })
    ).toEqual({
      valid: false,
      error: 'Q1: At least 2 options are required',
    })
  })

  it('applies json patches before validating next draft content', () => {
    const result = buildNextDraftContent(
      {
        title: 'Current title',
        show_results: false,
        questions: [],
      },
      {
        patch: [{ op: 'replace', path: '/title', value: 'Updated title' }],
      },
      validateTestDraftContent
    )

    expect(result).toEqual({
      ok: true,
      content: {
        title: 'Updated title',
        show_results: false,
        questions: [],
      },
    })
  })

  it('returns 400 when a json patch cannot be applied', () => {
    const result = buildNextDraftContent(
      {
        title: 'Current title',
        show_results: false,
        questions: [],
      },
      {
        patch: [{ op: 'replace', path: '/missing', value: 'Updated title' }],
      },
      validateTestDraftContent
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid patch',
    })
  })

  it('builds draft content from persisted test rows', () => {
    expect(
      buildTestDraftContentFromRows(
        { title: 'Test', show_results: false },
        [
          {
            id: TEST_ID_1,
            question_type: 'open_response',
            question_text: 'Explain',
            options: ['Ignored'],
            correct_option: 'bad',
            answer_key: '  key  ',
            sample_solution: '  return answer;  ',
            points: '2',
            response_max_chars: null,
            response_monospace: true,
          },
        ]
      )
    ).toEqual({
      title: 'Test',
      show_results: false,
      source_format: 'markdown',
      questions: [
        {
          id: TEST_ID_1,
          question_type: 'open_response',
          question_text: 'Explain',
          options: ['Ignored'],
          correct_option: null,
          answer_key: 'key',
          sample_solution: 'return answer;',
          points: 2,
          response_max_chars: 5000,
          response_monospace: true,
        },
      ],
    })
  })

  it('detects missing assessment draft table errors', () => {
    expect(
      isMissingAssessmentDraftsError({
        code: '42P01',
        message: 'relation assessment_drafts does not exist',
      })
    ).toBe(true)

    expect(
      isMissingAssessmentDraftsError({
        code: 'PGRST205',
        hint: 'assessment_drafts missing from schema cache',
      })
    ).toBe(true)

    expect(isMissingAssessmentDraftsError({ code: '42703', message: 'column missing' })).toBe(false)
  })

  it('wraps draft fetch/create/update operations and normalizes thrown errors', async () => {
    const expectedDraft = {
      id: 'draft-1',
      assessment_type: 'test',
      assessment_id: 'test-1',
      classroom_id: 'classroom-1',
      content: { title: 'Test', show_results: false, questions: [] },
      version: 1,
      created_by: 'teacher-1',
      updated_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    }

    const successSupabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe('assessment_drafts')

        const selectChain: any = {
          eq: vi.fn(() => selectChain),
          maybeSingle: vi.fn().mockResolvedValue({ data: expectedDraft, error: null }),
          single: vi.fn().mockResolvedValue({ data: expectedDraft, error: null }),
        }

        return {
          select: vi.fn(() => selectChain),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: expectedDraft, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: expectedDraft, error: null }),
              })),
            })),
          })),
        }
      }),
    }

    await expect(getAssessmentDraftByType(successSupabase, 'test', 'test-1')).resolves.toEqual({
      draft: expectedDraft,
      error: null,
    })

    await expect(
      createAssessmentDraft(successSupabase, {
        assessmentType: 'test',
        assessmentId: 'test-1',
        classroomId: 'classroom-1',
        userId: 'teacher-1',
        content: expectedDraft.content,
      })
    ).resolves.toEqual({
      draft: expectedDraft,
      error: null,
    })

    await expect(
      updateAssessmentDraft(successSupabase, 'draft-1', 2, 'teacher-1', expectedDraft.content)
    ).resolves.toEqual({
      draft: expectedDraft,
      error: null,
    })

    const throwingSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          throw new Error('relation missing')
        }),
        insert: vi.fn(() => {
          throw new Error('relation missing')
        }),
        update: vi.fn(() => {
          throw new Error('relation missing')
        }),
      })),
    }

    await expect(getAssessmentDraftByType(throwingSupabase, 'test', 'test-1')).resolves.toMatchObject({
      draft: null,
      error: { code: 'PGRST205', message: 'relation missing' },
    })

    await expect(
      createAssessmentDraft(throwingSupabase, {
        assessmentType: 'test',
        assessmentId: 'test-1',
        classroomId: 'classroom-1',
        userId: 'teacher-1',
        content: expectedDraft.content,
      })
    ).resolves.toMatchObject({
      draft: null,
      error: { code: 'PGRST205', message: 'relation missing' },
    })

    await expect(
      updateAssessmentDraft(throwingSupabase, 'draft-1', 2, 'teacher-1', expectedDraft.content)
    ).resolves.toMatchObject({
      draft: null,
      error: { code: 'PGRST205', message: 'relation missing' },
    })
  })

  it('returns a 500 error when syncing test questions fails during update', async () => {
    const supabase = {
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: TEST_ID_1 }],
            error: null,
          }),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: { message: 'write failed' } }),
          })),
        })),
        insert: vi.fn(),
        delete: vi.fn(),
      })),
    }

    await expect(
      syncTestQuestionsFromDraft(supabase, 'test-1', {
        title: 'Test',
        show_results: false,
        questions: [
          {
            id: TEST_ID_1,
            question_type: 'multiple_choice',
            question_text: 'Updated',
            options: ['A', 'B'],
            correct_option: 0,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          },
        ],
      })
    ).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'Failed to update synced test question',
    })
  })

  it('syncs test questions by updating existing rows, inserting new rows, and deleting removed rows', async () => {
    const updates: Array<Record<string, unknown>> = []
    const inserts: Array<Record<string, unknown>> = []
    const deletes: Array<string> = []

    const supabase = {
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: TEST_ID_1 }, { id: TEST_ID_2 }],
            error: null,
          }),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push(payload)
          return {
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserts.push(payload)
          return Promise.resolve({ error: null })
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_column: string, id: string) => {
              deletes.push(id)
              return Promise.resolve({ error: null })
            }),
          })),
        })),
      })),
    }

    await expect(
      syncTestQuestionsFromDraft(supabase, 'test-1', {
        title: 'Test',
        show_results: false,
        questions: [
          {
            id: TEST_ID_1,
            question_type: 'multiple_choice',
            question_text: 'Updated',
            options: ['A', 'B'],
            correct_option: 0,
            answer_key: null,
            sample_solution: null,
            points: 2,
            response_max_chars: 5000,
            response_monospace: false,
          },
          {
            id: '66666666-6666-4666-8666-666666666666',
            question_type: 'open_response',
            question_text: 'New',
            options: [],
            correct_option: null,
            answer_key: 'Key',
            sample_solution: null,
            points: 1,
            response_max_chars: 1200,
            response_monospace: true,
          },
        ],
      })
    ).resolves.toEqual({ ok: true })

    expect(updates).toEqual([
      {
        question_type: 'multiple_choice',
        question_text: 'Updated',
        options: ['A', 'B'],
        correct_option: 0,
        answer_key: null,
        sample_solution: null,
        points: 2,
        response_max_chars: 5000,
        response_monospace: false,
        position: 0,
      },
    ])
    expect(inserts).toEqual([
      {
        id: '66666666-6666-4666-8666-666666666666',
        test_id: 'test-1',
        question_type: 'open_response',
        question_text: 'New',
        options: [],
        correct_option: null,
        answer_key: 'Key',
        sample_solution: null,
        points: 1,
        response_max_chars: 1200,
        response_monospace: true,
        position: 1,
      },
    ])
    expect(deletes).toEqual([TEST_ID_2])
  })
})
