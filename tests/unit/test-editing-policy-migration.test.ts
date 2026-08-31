import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('supabase/migrations/142_test_prompt_corrections_after_start.sql', 'utf8')
describe('migration 142 Test editing boundary', () => {
  it('persists an irreversible first-start boundary and backfills historical work', () => {
    expect(sql).toContain('add column questions_locked_at timestamptz')
    expect(sql).toContain('new.questions_locked_at := old.questions_locked_at')
    expect(sql).toContain('from public.test_attempts attempt')
    expect(sql).toContain('from public.test_responses response')
  })
  it('serializes attempt starts and submissions with teacher saves', () => {
    const save = sql.slice(sql.indexOf('create or replace function public.save_test_attempt_atomic'), sql.indexOf('create or replace function public.submit_test_attempt_atomic'))
    expect(save).toContain('from public.classrooms classroom')
    expect(save.match(/for update;/g)?.length).toBeGreaterThanOrEqual(2)
    expect(save).toContain("if p_responses is null then")
    expect(save).toContain("v_responses := coalesce(v_responses, '{}'::jsonb)")
    expect(save).toContain('set questions_locked_at = clock_timestamp()')
  })
  it('allows only prompt text while preserving operational and provenance exceptions', () => {
    expect(sql).toContain("array['question_text', 'updated_at'")
    expect(sql).toContain("'ai_reference_cache_key'")
    expect(sql).toContain("'source_blueprint_version_id'")
    for (const field of ['options', 'correct_option', 'answer_key', 'sample_solution', 'points', 'response_max_chars', 'response_monospace', 'position']) {
      expect(sql).not.toContain(`array['question_text', '${field}'`)
    }
  })
  it('returns only student-visible question fields from the start transaction', () => {
    const snapshot = sql.slice(sql.indexOf("'questions', (select"), sql.indexOf('create or replace function public.submit_test_attempt_atomic'))
    expect(snapshot).not.toContain("'answer_key'")
    expect(snapshot).not.toContain("'sample_solution'")
    expect(snapshot).not.toContain("'correct_option'")
  })
  it('keeps legacy and current Classroom archives restorable without weakening the lock', () => {
    expect(sql).toContain("if p_table_name = 'tests' then")
    expect(sql).toContain("jsonb_build_object('questions_locked_at', null)")
    expect(sql).toContain("public.is_classroom_archive_maintenance_mode('restore')")
    expect(sql).toContain("public.is_classroom_archive_maintenance_mode('compaction')")
    expect(sql).toContain('create trigger restore_test_question_lock_from_attempt')
    expect(sql).toContain('create trigger restore_test_question_lock_from_response')
    expect(sql).toContain('set questions_locked_at = coalesce(test.questions_locked_at, new.created_at)')
  })
})
