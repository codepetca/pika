import { describe, expect, it } from 'vitest'
import {
  getTestDraftIdentityResolutionOptions,
  PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
  projectPortableTestQuestionIds,
  resolveTestQuestionIdentities,
} from '@/lib/test-question-identity'

const ROW_ID = '10000000-0000-4000-8000-000000000001'
const ARTIFACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ROW_ID = '30000000-0000-4000-8000-000000000001'

describe('Test question identity', () => {
  it('uses portable identity by default and requires an explicit legacy boundary', () => {
    const rows = [{ id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null }]

    expect(resolveTestQuestionIdentities([ARTIFACT_ID], rows)).toEqual({
      ok: true,
      identities: [{
        inputId: ARTIFACT_ID,
        portableId: ARTIFACT_ID,
        matchingRowId: ROW_ID,
      }],
    })
    expect(resolveTestQuestionIdentities([ROW_ID], rows)).toEqual({ ok: false })
    expect(resolveTestQuestionIdentities(
      [ROW_ID],
      rows,
      getTestDraftIdentityResolutionOptions({}),
    )).toEqual({
      ok: true,
      identities: [{
        inputId: ROW_ID,
        portableId: ARTIFACT_ID,
        matchingRowId: ROW_ID,
      }],
    })
  })

  it('normalizes UUID case and rejects case-only duplicate draft IDs', () => {
    expect(resolveTestQuestionIdentities([ARTIFACT_ID.toUpperCase()], [{
      id: ROW_ID,
      artifact_id: ARTIFACT_ID,
      source_artifact_id: null,
    }])).toEqual({
      ok: true,
      identities: [{
        inputId: ARTIFACT_ID,
        portableId: ARTIFACT_ID,
        matchingRowId: ROW_ID,
      }],
    })

    expect(resolveTestQuestionIdentities([
      ARTIFACT_ID,
      ARTIFACT_ID.toUpperCase(),
    ], [])).toEqual({ ok: false })
  })

  it('uses exact row precedence only for unmarked legacy drafts', () => {
    const nextPortableId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const rows = [
      { id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null },
      { id: ARTIFACT_ID, artifact_id: nextPortableId, source_artifact_id: null },
    ]

    expect(resolveTestQuestionIdentities(
      [ROW_ID, ARTIFACT_ID],
      rows,
      getTestDraftIdentityResolutionOptions({}),
    )).toEqual({
      ok: true,
      identities: [{
        inputId: ROW_ID,
        portableId: ARTIFACT_ID,
        matchingRowId: ROW_ID,
      }, {
        inputId: ARTIFACT_ID,
        portableId: nextPortableId,
        matchingRowId: ARTIFACT_ID,
      }],
    })

    expect(resolveTestQuestionIdentities(
      [ARTIFACT_ID, nextPortableId],
      rows,
      getTestDraftIdentityResolutionOptions({
        question_identity_version: PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
      }),
    )).toEqual({
      ok: true,
      identities: [{
        inputId: ARTIFACT_ID,
        portableId: ARTIFACT_ID,
        matchingRowId: ROW_ID,
      }, {
        inputId: nextPortableId,
        portableId: nextPortableId,
        matchingRowId: ARTIFACT_ID,
      }],
    })
  })

  it('ignores internal row IDs when validating canonical materialized content', () => {
    const nextPortableId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    expect(resolveTestQuestionIdentities([ROW_ID, nextPortableId], [
      { id: OTHER_ROW_ID, artifact_id: ROW_ID, source_artifact_id: null },
      { id: ROW_ID, artifact_id: nextPortableId, source_artifact_id: null },
    ], {
      acceptInternalRowIds: false,
      allowDraftOnly: false,
    })).toEqual({
      ok: true,
      identities: [{
        inputId: ROW_ID,
        portableId: ROW_ID,
        matchingRowId: OTHER_ROW_ID,
      }, {
        inputId: nextPortableId,
        portableId: nextPortableId,
        matchingRowId: ROW_ID,
      }],
    })
  })

  it('uses one source-first portable identity instead of treating both lineage columns as aliases', () => {
    const sourceArtifactId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const rows = [{
      id: ROW_ID,
      artifact_id: ARTIFACT_ID,
      source_artifact_id: sourceArtifactId,
    }]

    expect(resolveTestQuestionIdentities([sourceArtifactId], rows, {
      acceptInternalRowIds: false,
      allowDraftOnly: false,
    })).toEqual({
      ok: true,
      identities: [{
        inputId: sourceArtifactId,
        portableId: sourceArtifactId,
        matchingRowId: ROW_ID,
      }],
    })
    expect(resolveTestQuestionIdentities([ARTIFACT_ID], rows, {
      acceptInternalRowIds: false,
      allowDraftOnly: false,
    })).toEqual({ ok: false })
  })

  it('fails closed when distinct legacy rows collapse to one portable identity', () => {
    expect(resolveTestQuestionIdentities([ROW_ID, OTHER_ROW_ID], [
      { id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null },
      { id: OTHER_ROW_ID, artifact_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', source_artifact_id: ARTIFACT_ID },
    ], getTestDraftIdentityResolutionOptions({}))).toEqual({ ok: false })
  })

  it('projects persisted legacy IDs read-only and preserves draft-only identities', () => {
    const draftOnlyId = '40000000-0000-4000-8000-000000000001'
    const rows = [{ id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null }]
    const content = {
      title: 'Identity Test',
      show_results: false,
      questions: [{
        id: ROW_ID,
        question_type: 'open_response' as const,
        question_text: 'Persisted',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }, {
        id: draftOnlyId,
        question_type: 'open_response' as const,
        question_text: 'Draft only',
        options: [],
        correct_option: null,
        answer_key: null,
        sample_solution: null,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }],
    }

    expect(projectPortableTestQuestionIds(
      content,
      rows,
      getTestDraftIdentityResolutionOptions(content),
    )).toEqual({
      ok: true,
      content: {
        ...content,
        question_identity_version: PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
        questions: [
          { ...content.questions[0], id: ARTIFACT_ID },
          content.questions[1],
        ],
      },
    })
    expect(rows).toEqual([{ id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null }])
  })
})
