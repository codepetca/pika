import { describe, expect, it, vi } from 'vitest'
import {
  activateTestFromDraftAtomic,
  buildNextDraftContent,
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  ensureAssessmentDraft,
  getAssessmentDraftByType,
  isMissingAssessmentDraftsError,
  saveTestDraftAtomic,
  updateAssessmentDraft,
} from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import {
  getTestDraftIdentityResolutionOptions,
  projectPortableTestQuestionIds,
} from '@/lib/test-question-identity'

const TEST_ID_1 = '33333333-3333-4333-8333-333333333333'
const ARTIFACT_ID_1 = '55555555-5555-4555-8555-555555555555'
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

  it.each([
    'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa',
  ])('rejects non-v4 portable question identity %s', (id) => {
    expect(validateTestDraftContent({
      title: 'Canonical identity only',
      show_results: false,
      questions: [{
        id,
        question_type: 'open_response',
        question_text: 'Explain',
        points: 1,
      }],
    })).toEqual({
      valid: false,
      error: 'Q1: Invalid question id',
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
      question_identity_version: 1,
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
        const updateChain: any = {
          eq: vi.fn(() => updateChain),
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: expectedDraft, error: null }),
          })),
        }

        return {
          select: vi.fn(() => selectChain),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: expectedDraft, error: null }),
            })),
          })),
          update: vi.fn(() => updateChain),
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
      updateAssessmentDraft(successSupabase, 'draft-1', 1, 'teacher-1', expectedDraft.content)
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
      updateAssessmentDraft(throwingSupabase, 'draft-1', 1, 'teacher-1', expectedDraft.content)
    ).resolves.toMatchObject({
      draft: null,
      error: { code: 'PGRST205', message: 'relation missing' },
    })
  })

  it('writes a Test draft through the versioned atomic RPC', async () => {
    const content = {
      title: 'Saved Test',
      show_results: false,
      questions: [],
    }
    const draft = {
      id: 'draft-1',
      assessment_type: 'test',
      assessment_id: 'test-1',
      classroom_id: 'classroom-1',
      content,
      version: 4,
      created_by: 'teacher-1',
      updated_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    }
    const rpc = vi.fn().mockResolvedValue({
      data: { cleanup_paths: [], draft, test: { id: 'test-1', status: 'draft' } },
      error: null,
    })

    await expect(saveTestDraftAtomic({ rpc }, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
      content,
    })).resolves.toEqual({
      ok: true,
      draft,
      test: { id: 'test-1', status: 'draft' },
    })
    expect(rpc).toHaveBeenCalledWith('save_test_draft_atomic', {
      p_content: content,
      p_documents: [],
      p_expected_documents: [],
      p_expected_draft_version: 3,
      p_teacher_id: 'teacher-1',
      p_test_id: 'test-1',
      p_update_documents: false,
    })
  })

  it('keeps Test draft saves usable before migration 134 without persisting portable IDs', async () => {
    const portableContent = {
      title: 'Saved before migration',
      show_results: false,
      question_identity_version: 1 as const,
      questions: [{
        id: ARTIFACT_ID_1,
        question_type: 'open_response' as const,
        question_text: 'Explain the rollout',
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
      content: { ...portableContent, question_identity_version: undefined },
      version: 3,
      created_by: 'teacher-1',
      updated_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    }
    const savedLegacyDraft = {
      ...storedDraft,
      version: 4,
      content: {
        ...portableContent,
        question_identity_version: undefined,
        questions: [{ ...portableContent.questions[0], id: TEST_ID_1 }],
      },
    }
    const draftSelect: any = {
      eq: vi.fn(() => draftSelect),
      maybeSingle: vi.fn().mockResolvedValue({ data: storedDraft, error: null }),
    }
    const draftUpdate: any = {
      eq: vi.fn(() => draftUpdate),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: savedLegacyDraft, error: null }),
      })),
    }
    const questionSelect = {
      eq: vi.fn().mockResolvedValue({
        data: [{ id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null }],
        error: null,
      }),
    }
    const testStatusSelect: any = {
      eq: vi.fn(() => testStatusSelect),
      single: vi.fn().mockResolvedValue({ data: { status: 'draft' }, error: null }),
    }
    const testUpdate: any = {
      eq: vi.fn(() => testUpdate),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'test-1', status: 'draft', title: portableContent.title },
          error: null,
        }),
      })),
    }
    const assessmentDraftUpdate = vi.fn(() => draftUpdate)
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'save_test_draft_atomic is missing' },
    })
    const supabase = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'assessment_drafts') {
          return { select: vi.fn(() => draftSelect), update: assessmentDraftUpdate }
        }
        if (table === 'test_questions') {
          return { select: vi.fn(() => questionSelect) }
        }
        return {
          select: vi.fn(() => testStatusSelect),
          update: vi.fn(() => testUpdate),
        }
      }),
    }

    const result = await saveTestDraftAtomic(supabase, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
      content: portableContent,
    })

    expect(result).toMatchObject({
      ok: true,
      draft: {
        version: 4,
        content: {
          question_identity_version: 1,
          questions: [{ id: ARTIFACT_ID_1 }],
        },
      },
    })
    expect(assessmentDraftUpdate).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        questions: [expect.objectContaining({ id: TEST_ID_1 })],
      }),
      version: 4,
    }))
    expect(assessmentDraftUpdate.mock.calls[0]![0].content).not.toHaveProperty(
      'question_identity_version',
    )
  })

  it('rejects a draft-only portable ID that collides with any legacy question row ID before writing', async () => {
    const portableContent = {
      title: 'Rejected before migration',
      show_results: false,
      question_identity_version: 1 as const,
      questions: [{
        id: TEST_ID_1,
        question_type: 'open_response' as const,
        question_text: 'This UUID is already an internal row ID',
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
      content: { ...portableContent, questions: [] },
      version: 3,
      created_by: 'teacher-1',
      updated_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    }
    const draftSelect: any = {
      eq: vi.fn(() => draftSelect),
      maybeSingle: vi.fn().mockResolvedValue({ data: storedDraft, error: null }),
    }
    const identitySelect = {
      eq: vi.fn().mockResolvedValue({
        data: [{ id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null }],
        error: null,
      }),
    }
    const collisionSelect = {
      in: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue({ data: [{ id: TEST_ID_1 }], error: null }),
      })),
    }
    const draftUpdate = vi.fn()
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'save_test_draft_atomic is missing' },
    })
    const supabase = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'assessment_drafts') {
          return { select: vi.fn(() => draftSelect), update: draftUpdate }
        }
        if (table === 'test_questions') {
          return {
            select: vi.fn((columns: string) => columns === 'id'
              ? collisionSelect
              : identitySelect),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    await expect(saveTestDraftAtomic(supabase, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
      content: portableContent,
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Test draft question identity is invalid or ambiguous',
    })
    expect(draftUpdate).not.toHaveBeenCalled()
  })

  it('temporarily refuses Test activation until migration 134 installs the atomic RPC', async () => {
    const collidingPortableId = TEST_ID_1
    const secondRowId = '77777777-7777-4777-8777-777777777777'
    const markedDraft = {
      id: 'draft-1',
      assessment_type: 'test' as const,
      assessment_id: 'test-1',
      classroom_id: 'classroom-1',
      content: {
        title: 'Activate before migration',
        show_results: false,
        question_identity_version: 1 as const,
        questions: [{
          id: collidingPortableId,
          question_type: 'open_response' as const,
          question_text: 'Portable identity wins',
          options: [],
          correct_option: null,
          answer_key: null,
          sample_solution: null,
          points: 1,
          response_max_chars: 5000,
          response_monospace: false,
        }],
      },
      version: 8,
      created_by: 'teacher-1',
      updated_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    }
    const rows = [
      { id: TEST_ID_1, artifact_id: ARTIFACT_ID_1, source_artifact_id: null },
      { id: secondRowId, artifact_id: collidingPortableId, source_artifact_id: null },
    ]
    const draftSelect: any = {
      eq: vi.fn(() => draftSelect),
      maybeSingle: vi.fn().mockResolvedValue({ data: markedDraft, error: null }),
    }
    const persistedDraftUpdate: any = {
      eq: vi.fn(() => persistedDraftUpdate),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: markedDraft.id }, error: null }),
      })),
    }
    const questionUpdate: any = { eq: vi.fn(() => questionUpdate) }
    const questionDelete: any = { eq: vi.fn(() => questionDelete) }
    const questionUpdateFn = vi.fn(() => questionUpdate)
    const questionDeleteFn = vi.fn(() => questionDelete)
    const questionSelectFn = vi.fn((columns: string) => {
      if (columns.includes('question_type')) {
        const inspectionSelect: any = {
          eq: vi.fn(() => inspectionSelect),
          order: vi.fn().mockResolvedValue({
            data: rows.map((row, position) => ({
              ...row,
              question_type: 'open_response',
              question_text: position === 0 ? 'Existing row' : 'Portable identity wins',
              options: [],
              correct_option: null,
              answer_key: null,
              sample_solution: null,
              points: 1,
              response_max_chars: 5000,
              response_monospace: false,
              position,
            })),
            error: null,
          }),
        }
        return inspectionSelect
      }
      return {
        eq: vi.fn().mockResolvedValue({
          data: columns === 'id' ? rows.map(({ id }) => ({ id })) : rows,
          error: null,
        }),
      }
    })
    const usageSelect = {
      eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
    }
    const testUpdate: any = {
      eq: vi.fn(() => testUpdate),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'test-1', status: 'active' },
          error: null,
        }),
      })),
    }
    const testUpdateFn = vi.fn(() => testUpdate)
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'activate_test_from_draft_atomic is missing' },
    })
    const supabase = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'assessment_drafts') {
          return { select: vi.fn(() => draftSelect), update: vi.fn(() => persistedDraftUpdate) }
        }
        if (table === 'test_questions') {
          return {
            select: questionSelectFn,
            update: questionUpdateFn,
            insert: vi.fn().mockResolvedValue({ error: null }),
            delete: questionDeleteFn,
          }
        }
        if (table === 'test_attempts' || table === 'test_responses') {
          return { select: vi.fn(() => usageSelect) }
        }
        return { update: testUpdateFn }
      }),
    }

    await expect(activateTestFromDraftAtomic(supabase, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 8,
    })).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'Atomic Test draft activate requires migration 134 to be applied',
    })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('maps an activation version conflict to a reviewable 409', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'draft_version_conflict' },
    })

    await expect(activateTestFromDraftAtomic({ rpc }, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'The Test changed after activation was requested. Review and try again.',
    })
  })

  it('maps a materialized question lock to a reviewable 409', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '55000',
        message: 'test_questions_locked: Test questions cannot be changed after student work exists',
      },
    })

    await expect(saveTestDraftAtomic({ rpc }, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
      content: { title: 'Test', show_results: false, questions: [] },
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Test questions cannot be changed after student work exists',
    })
  })

  it('maps invalid draft content to a 400 validation error, not an identity conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_draft_content' },
    })

    await expect(saveTestDraftAtomic({ rpc }, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
      content: { title: '', show_results: false, questions: [] },
    })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Draft content is invalid',
    })
  })

  it('maps an invalid draft version to a 400 validation error, not an identity conflict', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_draft_version' },
    })

    await expect(activateTestFromDraftAtomic({ rpc }, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
    })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'A valid draft version is required',
    })
  })

  it('still maps a real question-identity conflict to a reviewable 409', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'duplicate_question_identity' },
    })

    await expect(saveTestDraftAtomic({ rpc }, {
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedDraftVersion: 3,
      content: { title: 'Test', show_results: false, questions: [] },
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Test draft question identity is invalid or ambiguous',
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
        getTestDraftIdentityResolutionOptions(content),
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

  it('keeps a marked portable draft usable across a row-ID collision', async () => {
    const firstRowId = TEST_ID_1
    const firstPortableId = ARTIFACT_ID_1
    const secondPortableId = '66666666-6666-4666-8666-666666666666'
    const storedDraft = {
      id: 'draft-1',
      assessment_type: 'test' as const,
      assessment_id: 'test-1',
      classroom_id: 'classroom-1',
      content: {
        title: 'Portable Test',
        show_results: false,
        question_identity_version: 1 as const,
        questions: [firstPortableId, secondPortableId].map((id) => ({
          id,
          question_type: 'open_response' as const,
          question_text: 'Portable identity',
          options: [],
          correct_option: null,
          answer_key: null,
          sample_solution: null,
          points: 1,
          response_max_chars: 5000,
          response_monospace: false,
        })),
      },
      version: 8,
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
        data: [{
          id: firstRowId,
          artifact_id: firstPortableId,
          source_artifact_id: firstPortableId,
        }, {
          id: firstPortableId,
          artifact_id: secondPortableId,
          source_artifact_id: secondPortableId,
        }],
        error: null,
      }),
    }
    const supabase = {
      from: vi.fn((table: string) => table === 'assessment_drafts'
        ? { select: vi.fn(() => draftSelect) }
        : { select: vi.fn(() => questionSelect) }),
    }

    const result = await ensureAssessmentDraft(supabase, {
      assessmentType: 'test',
      assessment: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Portable Test',
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
        getTestDraftIdentityResolutionOptions(content),
      ),
    })

    expect(result).toMatchObject({
      ok: true,
      draft: {
        version: 8,
        content: {
          question_identity_version: 1,
          questions: [{ id: firstPortableId }, { id: secondPortableId }],
        },
      },
    })
  })

  it('reopens a materialized Test from persisted rows without changing its draft version', async () => {
    const storedDraft = {
      id: 'draft-1',
      assessment_type: 'test' as const,
      assessment_id: 'test-1',
      classroom_id: 'classroom-1',
      content: {
        title: 'Stale draft',
        show_results: false,
        questions: [],
      },
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
        data: [{
          id: TEST_ID_1,
          artifact_id: ARTIFACT_ID_1,
          source_artifact_id: null,
          question_type: 'open_response',
          question_text: 'Materialized question',
          options: [],
          correct_option: null,
          answer_key: null,
          sample_solution: null,
          points: 2,
          response_max_chars: 5000,
          response_monospace: false,
        }],
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
        title: 'Materialized Test',
        show_results: true,
      },
      userId: 'teacher-1',
      questionsTable: 'test_questions',
      questionsForeignKey: 'test_id',
      questionsSelect: 'id, artifact_id, source_artifact_id',
      validateContent: validateTestDraftContent,
      buildFromRows: buildTestDraftContentFromRows,
      preferPersistedRows: true,
    })

    expect(result).toMatchObject({
      ok: true,
      draft: {
        version: 7,
        content: {
          title: 'Materialized Test',
          show_results: true,
          questions: [{ id: ARTIFACT_ID_1, question_text: 'Materialized question' }],
        },
      },
    })
    expect(update).not.toHaveBeenCalled()
  })
})
