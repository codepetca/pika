import { describe, expect, it } from 'vitest'
import {
  projectPortableTestQuestionIds,
  resolveTestQuestionIdentities,
} from '@/lib/test-question-identity'

const ROW_ID = '10000000-0000-4000-8000-000000000001'
const ARTIFACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ROW_ID = '30000000-0000-4000-8000-000000000001'

describe('Test question identity', () => {
  it('uses one exact dual-read contract for portable and legacy row IDs', () => {
    const rows = [{ id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null }]

    expect(resolveTestQuestionIdentities([ARTIFACT_ID], rows)).toEqual({
      ok: true,
      identities: [{
        inputId: ARTIFACT_ID,
        portableId: ARTIFACT_ID,
        matchingRowId: ROW_ID,
      }],
    })
    expect(resolveTestQuestionIdentities([ROW_ID], rows)).toEqual({
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

  it('fails closed when an internal row ID collides with another portable identity', () => {
    expect(resolveTestQuestionIdentities([ROW_ID], [
      { id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null },
      { id: OTHER_ROW_ID, artifact_id: ROW_ID, source_artifact_id: null },
    ])).toEqual({ ok: false })
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

    expect(projectPortableTestQuestionIds(content, rows)).toEqual({
      ok: true,
      content: {
        ...content,
        questions: [
          { ...content.questions[0], id: ARTIFACT_ID },
          content.questions[1],
        ],
      },
    })
    expect(rows).toEqual([{ id: ROW_ID, artifact_id: ARTIFACT_ID, source_artifact_id: null }])
  })
})
