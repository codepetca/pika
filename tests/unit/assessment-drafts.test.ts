import { describe, expect, it, vi } from 'vitest'
import {
  buildNextDraftContent,
  buildQuizDraftContentFromRows,
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  syncQuizQuestionsFromDraft,
  syncTestQuestionsFromDraft,
  updateAssessmentDraft,
  validateQuizDraftContent,
  validateTestDraftContent,
} from '@/lib/server/assessment-drafts'

const QUIZ_ID_1 = '11111111-1111-4111-8111-111111111111'
const QUIZ_ID_2 = '22222222-2222-4222-8222-222222222222'
const TEST_ID_1 = '33333333-3333-4333-8333-333333333333'
const TEST_ID_2 = '44444444-4444-4444-8444-444444444444'

describe('assessment drafts', () => {
  it('validates and normalizes quiz draft content', () => {
    expect(
      validateQuizDraftContent({
        title: '  Quiz Draft  ',
        show_results: true,
        questions: [
          {
            id: QUIZ_ID_1,
            question_text: '  What is 2 + 2?  ',
            options: [' 3 ', ' 4 '],
          },
        ],
      })
    ).toEqual({
      valid: true,
      value: {
        title: 'Quiz Draft',
        show_results: true,
        questions: [
          {
            id: QUIZ_ID_1,
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
          },
        ],
      },
    })
  })

  it('rejects duplicate quiz question ids', () => {
    expect(
      validateQuizDraftContent({
        title: 'Quiz Draft',
        show_results: false,
        questions: [
          { id: QUIZ_ID_1, question_text: 'One', options: ['A', 'B'] },
          { id: QUIZ_ID_1, question_text: 'Two', options: ['A', 'B'] },
        ],
      })
    ).toEqual({
      valid: false,
      error: `Duplicate question id: ${QUIZ_ID_1}`,
    })
  })

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
      validateQuizDraftContent
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
      validateQuizDraftContent
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid patch',
    })
  })

  it('builds draft content from persisted quiz and test rows', () => {
    expect(
      buildQuizDraftContentFromRows(
        { title: 'Quiz', show_results: true },
        [{ id: QUIZ_ID_1, question_text: 'Prompt', options: ['One', '', 'Two'] }]
      )
    ).toEqual({
      title: 'Quiz',
      show_results: true,
      questions: [{ id: QUIZ_ID_1, question_text: 'Prompt', options: [] }],
    })

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
      assessment_type: 'quiz',
      assessment_id: 'quiz-1',
      classroom_id: 'classroom-1',
      content: { title: 'Quiz', show_results: false, questions: [] },
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

    await expect(getAssessmentDraftByType(successSupabase, 'quiz', 'quiz-1')).resolves.toEqual({
      draft: expectedDraft,
      error: null,
    })

    await expect(
      createAssessmentDraft(successSupabase, {
        assessmentType: 'quiz',
        assessmentId: 'quiz-1',
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

    await expect(getAssessmentDraftByType(throwingSupabase, 'quiz', 'quiz-1')).resolves.toMatchObject({
      draft: null,
      error: { code: 'PGRST205', message: 'relation missing' },
    })

    await expect(
      createAssessmentDraft(throwingSupabase, {
        assessmentType: 'quiz',
        assessmentId: 'quiz-1',
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

  it('syncs quiz questions by updating existing rows, inserting new rows, and deleting removed rows', async () => {
    const updates: Array<Record<string, unknown>> = []
    const inserts: Array<Record<string, unknown>> = []
    const deletes: Array<string> = []

    const supabase = {
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: QUIZ_ID_1 }, { id: QUIZ_ID_2 }],
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
      syncQuizQuestionsFromDraft(supabase, 'quiz-1', {
        title: 'Quiz',
        show_results: false,
        questions: [
          { id: QUIZ_ID_1, question_text: 'Updated', options: ['A', 'B'] },
          { id: '55555555-5555-4555-8555-555555555555', question_text: 'New', options: ['C', 'D'] },
        ],
      })
    ).resolves.toEqual({ ok: true })

    expect(updates).toEqual([{ question_text: 'Updated', options: ['A', 'B'], position: 0 }])
    expect(inserts).toEqual([
      {
        id: '55555555-5555-4555-8555-555555555555',
        quiz_id: 'quiz-1',
        question_text: 'New',
        options: ['C', 'D'],
        position: 1,
      },
    ])
    expect(deletes).toEqual([QUIZ_ID_2])
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
})
