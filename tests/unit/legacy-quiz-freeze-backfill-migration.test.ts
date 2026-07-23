import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/106_freeze_and_backfill_legacy_quiz.sql',
  ),
  'utf8',
)

describe('legacy Quiz freeze and backfill migration', () => {
  it('serializes the freeze, blueprint narrowing, and source snapshot', () => {
    expect(migration).toMatch(/^--[\s\S]*\nbegin;\n/)
    expect(migration.trimEnd()).toMatch(/commit;$/)
    expect(migration).toContain('in access exclusive mode;')
    for (const table of [
      'public.quizzes',
      'public.quiz_questions',
      'public.quiz_responses',
      'public.quiz_student_scores',
      'public.assessment_drafts',
      'public.course_blueprint_assessments',
    ]) {
      expect(migration).toContain(table)
    }
    expect(migration).toContain(
      "where assessment_type = 'quiz'",
    )
    expect(migration).toContain(
      "check (assessment_type = 'test')",
    )
    expect(migration).toContain(
      'create or replace function private.reject_legacy_quiz_source_write()',
    )
    expect(migration.match(/create trigger freeze_legacy_/g)).toHaveLength(10)
  })

  it('uses the application envelope identity and checksum contracts', () => {
    expect(migration).toContain(
      "'pika.classroom-archive@1/legacy-quiz'",
    )
    expect(migration).toContain(
      "'sha256-canonical-json-v1'",
    )
    expect(migration).toContain(
      'private.legacy_quiz_deterministic_uuid_v1(array[',
    )
    expect(migration).toContain(
      'private.legacy_quiz_payload_sha256_v1(to_jsonb(',
    )
    expect(migration).toContain(
      'private.legacy_quiz_json_object_index_v1(entry.key)',
    )
    expect(migration).toContain(
      "abs(v_number) >= 1e21::double precision",
    )
  })

  it('fails closed on graph, actor, collision, and parity defects', () => {
    for (const marker of [
      'Legacy Quiz response has an invalid parent graph',
      'Legacy Quiz draft has an invalid parent Quiz',
      'Legacy Quiz retired-assessment record collision',
      'Legacy Quiz envelope actor cannot be resolved',
      'Legacy Quiz source and envelope counts differ',
      'Legacy Quiz actor source and envelope counts differ',
    ]) {
      expect(migration).toContain(marker)
    }
    expect(migration).toContain(
      'create table private.legacy_quiz_backfill_ledger (',
    )
    expect(migration).toContain(
      'check (source_count = envelope_count)',
    )
    expect(migration).toContain(
      'check (source_aggregate_sha256 = envelope_aggregate_sha256)',
    )
  })

  it('preserves source rows and active Test tables', () => {
    expect(migration).not.toMatch(
      /\b(?:drop|delete from|update)\s+public\.(?:quizzes|quiz_questions|quiz_responses|quiz_student_scores)\b/i,
    )
    expect(migration).not.toMatch(
      /\b(?:insert into|update|delete from|drop table)\s+public\.(?:tests|test_questions|test_responses|test_attempts)\b/i,
    )
  })
})
