import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@/lib/server/classroom-archive-format'
import { adaptLegacyQuizArchiveResources } from '@/lib/server/classroom-archive-quiz-retirement'
import {
  LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
  RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
  retiredAssessmentPayloadChecksum,
} from '@/lib/server/classroom-retired-assessment-contract'

const CLASSROOM_ID = '00000000-0000-4000-8000-000000000001'
const TEACHER_ID = '00000000-0000-4000-8000-000000000002'
const STUDENT_ID = '00000000-0000-4000-8000-000000000003'
const QUIZ_ID = '10000000-0000-4000-8000-000000000001'
const QUESTION_ID = '10000000-0000-4000-8000-000000000002'
const RESPONSE_ID = '10000000-0000-4000-8000-000000000003'
const SCORE_ID = '10000000-0000-4000-8000-000000000004'
const QUIZ_DRAFT_ID = '10000000-0000-4000-8000-000000000005'
const TEST_DRAFT_ID = '10000000-0000-4000-8000-000000000006'

function resources() {
  return {
    classrooms: [{ id: CLASSROOM_ID, teacher_id: TEACHER_ID }],
    tests: [{ id: '20000000-0000-4000-8000-000000000001', classroom_id: CLASSROOM_ID }],
    quizzes: [{
      id: QUIZ_ID,
      classroom_id: CLASSROOM_ID,
      title: 'Historical quiz',
      created_by: TEACHER_ID,
      created_at: '2026-01-01T12:00:00.000Z',
      updated_at: '2026-01-02T12:00:00.000Z',
    }],
    quiz_questions: [{
      id: QUESTION_ID,
      quiz_id: QUIZ_ID,
      question_text: 'Historical question',
      options: ['A', 'B'],
      created_at: '2026-01-01T12:00:00.000Z',
      updated_at: '2026-01-02T12:00:00.000Z',
    }],
    quiz_responses: [{
      id: RESPONSE_ID,
      quiz_id: QUIZ_ID,
      question_id: QUESTION_ID,
      student_id: STUDENT_ID,
      selected_option: 1,
      submitted_at: '2026-01-03T12:00:00.000Z',
    }],
    quiz_student_scores: [{
      id: SCORE_ID,
      quiz_id: QUIZ_ID,
      student_id: STUDENT_ID,
      manual_override_score: 9,
      graded_at: '2026-01-04T12:00:00.000Z',
      graded_by: 'teacher@example.test',
      created_at: '2026-01-04T12:00:00.000Z',
      updated_at: '2026-01-04T12:00:00.000Z',
    }],
    assessment_drafts: [
      {
        id: QUIZ_DRAFT_ID,
        assessment_type: 'quiz',
        assessment_id: QUIZ_ID,
        classroom_id: CLASSROOM_ID,
        content: { title: 'Unsaved historical quiz' },
        created_by: TEACHER_ID,
        updated_by: TEACHER_ID,
        created_at: '2026-01-01T12:00:00.000Z',
        updated_at: '2026-01-02T12:00:00.000Z',
      },
      {
        id: TEST_DRAFT_ID,
        assessment_type: 'test',
        assessment_id: '20000000-0000-4000-8000-000000000001',
        classroom_id: CLASSROOM_ID,
        content: { title: 'Current test' },
        created_by: TEACHER_ID,
        updated_by: TEACHER_ID,
      },
    ],
  }
}

const archiveActors = [{ id: TEACHER_ID }, { id: STUDENT_ID }]

describe('legacy Quiz archive retirement adapter', () => {
  it('converts all four Quiz resources and Quiz drafts into opaque v2 envelopes', () => {
    const source = resources()
    const sourceBefore = structuredClone(source)
    const adapted = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: source,
      actors: archiveActors,
    })

    expect(source).toEqual(sourceBefore)
    expect(adapted.records).toHaveLength(5)
    expect(adapted.records.map((record) => record.source_resource)).toEqual([
      'assessment_drafts',
      'quiz_questions',
      'quiz_responses',
      'quiz_student_scores',
      'quizzes',
    ])
    expect(adapted.resources.assessment_drafts).toEqual([
      expect.objectContaining({ id: TEST_DRAFT_ID, assessment_type: 'test' }),
    ])
    expect(adapted.resources.tests).toEqual(source.tests)
    expect(adapted.resources).not.toHaveProperty('quizzes')
    expect(adapted.resources).not.toHaveProperty('quiz_questions')
    expect(adapted.resources).not.toHaveProperty('quiz_responses')
    expect(adapted.resources).not.toHaveProperty('quiz_student_scores')
    expect(adapted.resources.classroom_retired_assessment_records)
      .toEqual(adapted.records)
    expect(adapted.resources.classroom_retired_assessment_record_actors)
      .toEqual(adapted.actors)
  })

  it('preserves complete payloads, parent identity, manual scores, and actors', () => {
    const adapted = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: resources(),
      actors: archiveActors,
    })
    const response = adapted.records.find((record) =>
      record.source_resource === 'quiz_responses',
    )
    const score = adapted.records.find((record) =>
      record.source_resource === 'quiz_student_scores',
    )
    const draft = adapted.records.find((record) =>
      record.source_resource === 'assessment_drafts',
    )

    expect(response).toMatchObject({
      source_row_id: RESPONSE_ID,
      parent_source_resource: 'quiz_questions',
      parent_source_row_id: QUESTION_ID,
      payload: {
        quiz_id: QUIZ_ID,
        selected_option: 1,
        student_id: STUDENT_ID,
      },
    })
    expect(score?.payload.manual_override_score).toBe(9)
    expect(draft).toMatchObject({
      parent_source_resource: 'quizzes',
      parent_source_row_id: QUIZ_ID,
    })
    expect(adapted.actors).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor_id: TEACHER_ID, source_column: 'created_by' }),
      expect.objectContaining({ actor_id: TEACHER_ID, source_column: 'updated_by' }),
      expect.objectContaining({ actor_id: STUDENT_ID, source_column: 'student_id' }),
    ]))
    for (const record of adapted.records) {
      expect(record.payload_sha256).toBe(
        createHash('sha256')
          .update(canonicalJsonStringify(record.payload))
          .digest('hex'),
      )
    }
  })

  it('is deterministic and preserves the adapted envelope on replay', () => {
    const first = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: resources(),
      actors: archiveActors,
    })
    const second = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: resources(),
      actors: archiveActors,
    })

    expect(second).toEqual(first)
    expect(adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: first.resources,
      actors: archiveActors,
    })).toEqual(first)
    expect(new Set(first.records.map((record) => record.id)).size)
      .toBe(first.records.length)
    expect(new Set(first.actors.map((actor) => actor.id)).size)
      .toBe(first.actors.length)
  })

  it('preserves unrelated pre-existing retired assessment records', () => {
    const source = resources() as ReturnType<typeof resources> & {
      classroom_retired_assessment_records: Record<string, unknown>[]
      classroom_retired_assessment_record_actors: Record<string, unknown>[]
    }
    const payload = {
      id: '90000000-0000-4000-8000-000000000001',
      classroom_id: CLASSROOM_ID,
      title: 'Prior quiz',
    }
    const existing = {
      id: '90000000-0000-4000-8000-000000000002',
      classroom_id: CLASSROOM_ID,
      source_contract: LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
      source_contract_version: 1,
      source_resource: 'quizzes',
      source_row_id: payload.id,
      parent_source_resource: null,
      parent_source_row_id: null,
      payload,
      payload_sha256: retiredAssessmentPayloadChecksum(payload),
      checksum_algorithm: RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
      source_created_at: null,
      source_updated_at: null,
    }
    source.classroom_retired_assessment_records = [existing]
    source.classroom_retired_assessment_record_actors = []

    const adapted = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: source,
      actors: archiveActors,
    })

    expect(adapted.records).toContainEqual(existing)
    expect(adapted.records).toHaveLength(6)
  })

  it('fails closed on missing or inconsistent Quiz parents', () => {
    const missingQuestion = resources()
    missingQuestion.quiz_questions = []
    expect(() => adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: missingQuestion,
      actors: archiveActors,
    })).toThrow('source parent is missing')

    const inconsistentQuiz = resources()
    inconsistentQuiz.quiz_responses[0].quiz_id =
      '30000000-0000-4000-8000-000000000001'
    expect(() => adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: inconsistentQuiz,
      actors: archiveActors,
    })).toThrow('inconsistent quiz identity')

    const missingDraftQuiz = resources()
    missingDraftQuiz.assessment_drafts[0].assessment_id =
      '30000000-0000-4000-8000-000000000001'
    expect(() => adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: missingDraftQuiz,
      actors: archiveActors,
    })).toThrow('source parent is missing')
  })

  it('fails closed when a root row belongs to another classroom', () => {
    const source = resources()
    source.quizzes[0].classroom_id = '40000000-0000-4000-8000-000000000001'

    expect(() => adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: source,
      actors: archiveActors,
    })).toThrow('belongs to another classroom')
  })

  it('fails closed when a referenced actor is absent from the archive snapshot', () => {
    expect(() => adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: resources(),
      actors: [{ id: TEACHER_ID }],
    })).toThrow('actor is missing from archive snapshots')
  })
})
