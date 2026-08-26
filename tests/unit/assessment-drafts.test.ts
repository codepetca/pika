import { describe, expect, it, vi } from 'vitest'
import {
  buildNextDraftContent,
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  ensureAssessmentDraft,
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  syncTestQuestionsFromDraft,
  updateAssessmentDraft,
} from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { projectPortableTestQuestionIds } from '@/lib/test-question-identity'

const TEST_ID_1 = '33333333-3333-4333-8333-333333333333'
const TEST_ID_2 = '44444444-4444-4444-8444-444444444444'
const ARTIFACT_ID_1 = '55555555-5555-4555-8555-555555555555'
const ARTIFACT_ID_2 = '66666666-6666-4666-8666-666666666666'
const MIXED_CASE_ARTIFACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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

  it('canonicalizes UUID case and rejects case-only duplicate question IDs', () => {
    const question = {
      question_type: 'open_response',
      question_text: 'Explain',
      points: 1,
    }

    expect(validateTestDraftContent({
      title: 'Canonical UUIDs',
      show_results: false,
      questions: [{ id: MIXED_CASE_ARTIFACT_ID.toUpperCase(), ...question }],
    })).toMatchObject({
      valid: true,
      value: {
        questions: [{ id: MIXED_CASE_ARTIFACT_ID }],
      },
    })

    expect(validateTestDraftContent({
      title: 'Duplicate UUIDs',
      show_results: false,
      questions: [
        { id: MIXED_CASE_ARTIFACT_ID, ...question },
        { id: MIXED_CASE_ARTIFACT_ID.toUpperCase(), ...question },
      ],
    })).toEqual({
      valid: false,
      error: `Duplicate question id: ${MIXED_CASE_ARTIFACT_ID}`,
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
            artifact_id: ARTIFACT_ID_1,
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
          id: ARTIFACT_ID_1,
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

  it('creates a Tests-only baseline draft when none exists', async () => {
    const createdDraft = {
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
    const assessmentDraftSelect: any = {
      eq: vi.fn(() => assessmentDraftSelect),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const questionSelect: any = {
      eq: vi.fn(() => questionSelect),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'test_questions') {
          return { select: vi.fn(() => questionSelect) }
        }
        return {
          select: vi.fn(() => assessmentDraftSelect),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: createdDraft, error: null }),
            })),
          })),
        }
      }),
    }

    await expect(ensureAssessmentDraft(supabase, {
      assessmentType: 'test',
      assessment: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Test',
        show_results: false,
      },
      userId: 'teacher-1',
      questionsTable: 'test_questions',
      questionsForeignKey: 'test_id',
      questionsSelect: 'id',
      validateContent: validateTestDraftContent,
      buildFromRows: buildTestDraftContentFromRows,
    })).resolves.toEqual({ ok: true, draft: createdDraft })
  })

  it('projects a valid pre-migration draft to portable IDs without persisting it', async () => {
    const legacyContent = {
      title: 'Legacy Test',
      show_results: false,
      questions: [{
        id: TEST_ID_1,
        question_type: 'open_response' as const,
        question_text: 'Legacy identity',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }],
    }
    const storedDraft = {
      id: 'draft-1',
      assessment_type: 'test' as const,
      assessment_id: 'test-1',
      classroom_id: 'classroom-1',
      content: legacyContent,
      version: 7,
      created_by: 'teacher-1',
      updated_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    }
    const draftSelect: any = {
      eq: vi.fn(() => draftSelect),
      maybeSingle: vi.fn().mockResolvedValue({ data: storedDraft, error: null }),
    }
    const questionSelect: any = {
      eq: vi.fn(() => questionSelect),
      order: vi.fn().mockResolvedValue({
        data: [{ id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null }],
        error: null,
      }),
    }
    const update = vi.fn()
    const supabase = {
      from: vi.fn((table: string) => table === 'assessment_drafts'
        ? { select: vi.fn(() => draftSelect), update }
        : { select: vi.fn(() => questionSelect) }),
    }

    const result = await ensureAssessmentDraft(supabase, {
      assessmentType: 'test',
      assessment: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Legacy Test',
        show_results: false,
      },
      userId: 'teacher-1',
      questionsTable: 'test_questions',
      questionsForeignKey: 'test_id',
      questionsSelect: 'id, artifact_id, source_artifact_id',
      validateContent: validateTestDraftContent,
      buildFromRows: buildTestDraftContentFromRows,
      projectContent: (content, rows) => projectPortableTestQuestionIds(
        content,
        rows as Array<{ id: string; artifact_id?: string | null; source_artifact_id?: string | null }>,
      ),
    })

    expect(result).toMatchObject({
      ok: true,
      draft: {
        version: 7,
        content: { questions: [{ id: ARTIFACT_ID_1 }] },
      },
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('returns a 500 error when syncing test questions fails during update', async () => {
    const supabase = {
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null }],
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
            id: ARTIFACT_ID_1,
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
            data: [
              { id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null },
              { id: TEST_ID_2, artifact_id: ARTIFACT_ID_2, source_artifact_id: null },
            ],
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
            id: ARTIFACT_ID_1,
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
            id: '77777777-7777-4777-8777-777777777777',
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
        test_id: 'test-1',
        artifact_id: '77777777-7777-4777-8777-777777777777',
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

  it('updates the exact persisted row when a pre-migration draft uses its internal id', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const parentEq = vi.fn(() => ({ eq: updateEq }))
    const update = vi.fn(() => ({ eq: parentEq }))
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null }],
            error: null,
          }),
        })),
        update,
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        })),
      })),
    }

    await expect(
      syncTestQuestionsFromDraft(supabase, 'test-1', {
        title: 'Legacy draft',
        show_results: false,
        questions: [{
          id: TEST_ID_1,
          question_type: 'multiple_choice',
          question_text: 'Legacy identity',
          options: ['A', 'B'],
          correct_option: 0,
          answer_key: null,
          sample_solution: null,
          points: 1,
          response_max_chars: 5000,
          response_monospace: false,
        }],
      })
    ).resolves.toEqual({ ok: true })
    expect(update).toHaveBeenCalledTimes(1)
    expect(parentEq).toHaveBeenCalledWith('test_id', 'test-1')
    expect(updateEq).toHaveBeenCalledWith('id', TEST_ID_1)
  })

  it('matches an uppercase portable UUID to the existing persisted row', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: updateEq })),
    }))
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: TEST_ID_1, artifact_id: MIXED_CASE_ARTIFACT_ID, source_artifact_id: null }],
            error: null,
          }),
        })),
        update,
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        })),
      })),
    }

    await expect(syncTestQuestionsFromDraft(supabase, 'test-1', {
      title: 'Case normalized',
      show_results: false,
      questions: [{
        id: MIXED_CASE_ARTIFACT_ID.toUpperCase(),
        question_type: 'open_response',
        question_text: 'Explain',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }],
    })).resolves.toEqual({ ok: true })
    expect(updateEq).toHaveBeenCalledWith('id', TEST_ID_1)
  })

  it('preserves a draft-only artifact identity through activation and draft reconstruction', async () => {
    const draftOnlyId = '77777777-7777-4777-8777-777777777777'
    let inserted: Record<string, unknown> | null = null
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserted = payload
          return Promise.resolve({ error: null })
        }),
      })),
    }

    const draft: Parameters<typeof syncTestQuestionsFromDraft>[2] = {
      title: 'Lifecycle Test',
      show_results: false,
      questions: [{
        id: draftOnlyId,
        question_type: 'open_response',
        question_text: 'Explain the lifecycle',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }],
    }

    await expect(syncTestQuestionsFromDraft(supabase, 'test-1', draft))
      .resolves.toEqual({ ok: true })
    expect(inserted).toMatchObject({
      test_id: 'test-1',
      artifact_id: draftOnlyId,
    })
    expect(inserted).not.toHaveProperty('id')

    const recaptured = buildTestDraftContentFromRows(
      { title: draft.title, show_results: draft.show_results },
      [{
        ...(inserted as Record<string, unknown>),
        id: '88888888-8888-4888-8888-888888888888',
      }],
    )
    expect(recaptured.questions[0]?.id).toBe(draftOnlyId)
  })

  it('fails closed when portable identity matches multiple persisted rows', async () => {
    const updateSpy = vi.fn()
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null },
              { id: TEST_ID_2, artifact_id: ARTIFACT_ID_2, source_artifact_id: ARTIFACT_ID_1 },
            ],
            error: null,
          }),
        })),
        update: updateSpy,
      })),
    }

    await expect(
      syncTestQuestionsFromDraft(supabase, 'test-1', {
        title: 'Ambiguous draft',
        show_results: false,
        questions: [
          {
            id: ARTIFACT_ID_2,
            question_type: 'open_response',
            question_text: 'Unique identity before the conflict',
            options: [],
            correct_option: null,
            answer_key: null,
            sample_solution: null,
            points: 1,
            response_max_chars: 5000,
            response_monospace: false,
          },
          {
            id: ARTIFACT_ID_1,
            question_type: 'multiple_choice',
            question_text: 'Ambiguous identity',
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
      status: 409,
      error: 'Test draft question identity is ambiguous or requires backfill',
    })
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
