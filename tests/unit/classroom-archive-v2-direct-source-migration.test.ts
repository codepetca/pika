import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/107_classroom_archive_v2_direct_source.sql',
  ),
  'utf8',
)
const databaseHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-legacy-quiz-freeze-backfill.sh'),
  'utf8',
)

describe('classroom archive-v2 direct source migration', () => {
  it('purges disposable Quiz compatibility payloads without dropping source tables', () => {
    expect(migration).toContain("where assessment_type = 'quiz'")
    expect(migration).toContain("check (assessment_type = 'test')")
    expect(migration).toContain(
      "where source_contract = 'pika.classroom-archive@1/legacy-quiz'",
    )
    expect(migration).toContain('delete from public.quiz_responses')
    expect(migration).toContain('delete from public.quiz_student_scores')
    expect(migration).toContain('delete from public.quiz_questions')
    expect(migration).toContain('delete from public.quizzes')
    expect(migration).toContain(
      "current_setting('pika.classroom_archive_compaction', true) = 'on'",
    )
    expect(migration).not.toMatch(
      /drop table\s+(?:if exists\s+)?public\.(?:quizzes|quiz_questions|quiz_responses|quiz_student_scores)/i,
    )
  })

  it('promotes the live registry and export operation to source contract 2', () => {
    expect(migration).toContain(
      'from public.classroom_archive_resource_contract_versions',
    )
    expect(migration).toContain('where format_version = 2')
    expect(migration).toContain('p_source_contract_version <> 2')
    expect(migration).toContain('v_operation.source_contract_version <> 2')
    expect(migration).toContain(
      'p_archive_resource_counts is distinct from p_resource_counts',
    )
  })

  it('fails closed around active operations and is exercised by disposable replay', () => {
    expect(migration).toContain(
      "operation_type in ('export', 'restore', 'compact')",
    )
    expect(migration).toContain(
      "status = 'failed' and retryable is true",
    )
    expect(migration).toContain("using errcode = '55006'")
    expect(databaseHarness).toContain(
      '107_classroom_archive_v2_direct_source.sql',
    )
    expect(databaseHarness).toContain(
      'Classroom archive-v2 direct source database contract passes.',
    )
    expect(databaseHarness).toContain(
      'Direct archive-v2 snapshot contains a legacy contract row',
    )
    expect(databaseHarness).toContain(
      'public.complete_classroom_archive_compaction_v2',
    )
  })

  it('requires archive-v2 before compaction and pins restore contract 2', () => {
    expect(migration).toContain(
      'create or replace function public.begin_classroom_archive_compaction_v2',
    )
    expect(migration).toContain(
      "'error_code', 'classroom_archive_reexport_required'",
    )
    expect(migration).toContain(
      'create or replace function public.complete_classroom_archive_compaction_v2',
    )
    expect(migration).toContain(
      'restore_contract_version = p_restore_contract_version',
    )
  })
})
