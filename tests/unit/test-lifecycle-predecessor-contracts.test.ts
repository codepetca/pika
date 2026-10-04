import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = read('supabase/migrations/244_test_attempt_revision_and_return_guards.sql')
const lifecycle = read('supabase/migrations/063_atomic_test_attempt_lifecycle.sql')
const submissions = read('supabase/migrations/088_atomic_test_attempt_submit.sql')
const grading = read('supabase/migrations/094_atomic_test_grading_contracts.sql')
const lintCorrections = read('supabase/migrations/149_resolve_current_database_lint_warnings.sql')
const reviews = read('supabase/migrations/104_teacher_grading_reviews.sql')

// Read function bodies, including trigger functions whose LANGUAGE follows the
// closing delimiter. A CREATE-only inventory misses installed-body patches149.
function body(source: string, name: string) {
  const definition = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i').exec(source)
  if (!definition) throw new Error(`Missing definition for ${name}`)
  const rest = source.slice(definition.index)
  const opening = /\bas\s+(\$[a-z_]*\$)/i.exec(rest)
  if (!opening) throw new Error(`Missing body for ${name}`)
  const start = opening.index + opening[0].length
  const end = rest.indexOf(opening[1], start)
  if (end < start) throw new Error(`Missing body end for ${name}`)
  return rest.slice(start, end).trim()
}

describe('migration244 preserves authoritative predecessor contracts', () => {
  it('keeps the unsubmit empty no-op, then enforces149 actor and current locked Classroom authority before writes', () => {
    const unsubmit = body(migration, 'unsubmit_test_attempts_atomic')
    const noOp = unsubmit.indexOf("'unsubmitted_count', 0")
    const lock = unsubmit.indexOf('private.lock_test_lifecycle(p_test_id)')
    const authority = unsubmit.indexOf('v_classroom_teacher_id is distinct from p_updated_by')
    const mutation = unsubmit.indexOf('with target_attempts as materialized (')
    expect(noOp).toBeGreaterThan(-1)
    expect(lock).toBeGreaterThan(noOp)
    expect(authority).toBeGreaterThan(lock)
    expect(mutation).toBeGreaterThan(authority)
    expect(unsubmit.slice(lock, mutation)).toContain('p_updated_by is null')
    expect(unsubmit.slice(lock, mutation)).toContain('v_archived_at is not null')
    expect(unsubmit.slice(lock, mutation)).toContain("'Test unsubmission is not allowed' using errcode = '42501'")
    // Missing Test/Classroom must preserve149's authority error rather than
    // leak the new generic lifecycle helper's P0002 domain.
    expect(unsubmit.slice(lock, authority)).toMatch(/exception\s+when no_data_found then/)
    expect(lintCorrections).toContain("E'    or p_updated_by is null\\n'")
    const previous = body(lifecycle, 'unsubmit_test_attempts_atomic')
    expect(unsubmit.slice(mutation)).toBe(previous.slice(previous.indexOf('with target_attempts as materialized (')))
  })

  it('preserves149 null-clock rejection before clear locks or mutations and retains the094 grading contracts', () => {
    const clear = body(migration, 'clear_test_open_response_grades_atomic')
    expect(clear).toMatch(/if p_now is null\s+or p_expected_responses is null/)
    expect(clear.indexOf('p_now is null')).toBeLessThan(clear.indexOf('pg_advisory_xact_lock'))
    expect(lintCorrections).toContain("E'  if p_now is null\\n    or p_expected_responses is null\\n'")
    // Compare the whole deployed body after removing only244's declared
    // lifecycle-lock and disclosure-revocation additions.
    const without244 = clear
      .replace('  perform private.lock_test_lifecycle(p_test_id);\n', '')
      .replace('  perform private.revoke_incomplete_test_returns(p_test_id, v_student_ids);\n\n', '')
    const installed149 = body(grading, 'clear_test_open_response_grades_atomic')
      .replace('  if p_expected_responses is null\n', '  if p_now is null\n    or p_expected_responses is null\n')
    expect(without244).toBe(installed149)
  })

  it('preserves the entire094 grade-save body apart from the named244 lock/revocation additions', () => {
    const save = body(migration, 'save_test_response_grades_atomic')
    const without244 = save
      .replace('  perform private.lock_test_lifecycle(p_test_id);\n', '')
      .replace(/  perform private\.revoke_incomplete_test_returns\(p_test_id, \([\s\S]*?\n  \)\);\n\n/, '')
    expect(without244).toBe(body(grading, 'save_test_response_grades_atomic'))
  })

  it('retains088 single/bulk delete attempt locks before dependent deletes, plus the bulk empty no-op and exact counts', () => {
    for (const name of ['delete_student_test_attempt_atomic', 'delete_student_test_attempts_atomic']) {
      const current = body(migration, name)
      const previous = body(submissions, name)
      const parent = current.indexOf('private.lock_test_lifecycle(p_test_id)')
      const attempt = current.indexOf('from public.test_attempts', parent)
      const mutation = current.indexOf('with deleted_ai_items as (')
      expect(attempt).toBeGreaterThan(parent)
      expect(mutation).toBeGreaterThan(attempt)
      expect(current.slice(attempt, mutation)).toContain('for update')
      expect(current.slice(mutation)).toBe(previous.slice(previous.indexOf('with deleted_ai_items as (')))
      if (name.endsWith('attempts_atomic')) {
        expect(current.indexOf("'requested_count', 0")).toBeLessThan(parent)
        expect(current.slice(attempt, mutation)).toMatch(/order by student_id\s+for update/)
      }
    }
  })

  it('keeps the legacy Return empty/count contract while delegating all nonempty disclosure to checked eligibility', () => {
    const legacy = body(migration, 'return_test_attempts_atomic')
    const checked = body(migration, 'return_test_attempts_checked_atomic')
    expect(legacy).toContain("'updated_count', 0")
    expect(legacy).toContain("'inserted_count', 0")
    expect(legacy.indexOf("'returned_count', 0")).toBeLessThan(legacy.indexOf('public.return_test_attempts_checked_atomic'))
    expect(legacy).toContain("'updated_count', (v_result->>'returned_count')::integer")
    expect(legacy).not.toMatch(/insert into|p_submitted_at_by_student/)
    expect(checked).toContain('response.score is null')
    expect(checked).toContain('returned_at is null')
    expect(checked).toContain('teacher_id = p_returned_by and archived_at is null')
  })

  it('preserves104 review finalization through returned_at trigger and metadata-only revision exclusion', () => {
    const checked = body(migration, 'return_test_attempts_checked_atomic')
    expect(checked).toContain('update public.test_attempts set returned_at = clock_timestamp(), returned_by = p_returned_by')
    expect(reviews).toMatch(/create trigger mark_test_grading_reviews_returned\s+after update of returned_at on public\.test_attempts/)
    const mark = body(reviews, 'mark_test_grading_reviews_returned')
    expect(mark).toContain("'{reviewStatus}', '\"reviewed\"'::jsonb")
    expect(mark).toContain('to_jsonb(new.returned_at)')
    expect(mark).toContain("response.ai_grading_review->>'reviewStatus' = 'pending'")
    expect(body(reviews, 'stamp_test_response_revision')).toContain("to_jsonb(new) - array['ai_grading_provenance', 'ai_grading_review']")
    expect(migration).not.toMatch(/(?:drop trigger|disable trigger).*mark_test_grading_reviews_returned/i)
    expect(migration).not.toMatch(/create (?:or replace )?function public\.(?:mark_test_grading_reviews_returned|stamp_test_response_revision)/i)
    expect(read('scripts/check-atomic-test-grading.sh')).toContain('Test grading review changed the response revision')
  })

  it('keeps the063 global close body and counts unchanged behind the new parent lock', () => {
    const close = body(migration, 'close_test_for_grading_atomic')
      .replace('  perform private.lock_test_lifecycle(p_test_id);\n', '')
    expect(close).toBe(body(lifecycle, 'close_test_for_grading_atomic'))
  })

  it('captures installed143/149 attempt implementations and222 restore chain instead of copying stale predecessors', () => {
    for (const name of ['save', 'submit']) {
      expect(migration).toContain(`alter function public.${name}_test_attempt_atomic(`)
      expect(migration).toContain(`rename to ${name}_test_attempt_v143`)
      expect(migration).toContain(`alter function public.${name}_test_attempt_v143(`)
      expect(migration).toContain(`revoke all on function private.${name}_test_attempt_v143(`)
      expect(body(migration, `${name}_test_attempt_revision_atomic`)).toContain(`private.${name}_test_attempt_v143(`)
    }
    expect(lintCorrections).toContain("'public.submit_test_attempt_atomic(uuid,uuid,jsonb,timestamp with time zone)'::regprocedure")
    expect(migration).toContain('alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) rename to normalize_classroom_archive_restore_row_v243')
    const restore = body(migration, 'normalize_classroom_archive_restore_row')
    expect(restore).toContain('public.normalize_classroom_archive_restore_row_v243(p_operation_id, p_table_name, p_row)')
    expect(restore).toContain("nextval('private.test_attempt_draft_revision_seq')")
    const latestRestore = body(read('supabase/migrations/222_classroom_authoring_guidance_adoption.sql'), 'normalize_classroom_archive_restore_row')
    expect(latestRestore).toContain('public.normalize_classroom_archive_restore_row_pre_v222')
    expect(latestRestore).toContain('authoring_guidance_version_id')
  })

  it('retains service-only mutation privileges and empty private helper exposure after body replacements', () => {
    for (const signature of [
      'unsubmit_test_attempts_atomic(uuid, uuid[], uuid)',
      'delete_student_test_attempt_atomic(uuid, uuid)',
      'delete_student_test_attempts_atomic(uuid, uuid[])',
      'return_test_attempts_atomic(uuid, uuid[], uuid, jsonb)',
      'return_test_attempts_checked_atomic(uuid, uuid[], uuid)',
    ]) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`)
      expect(migration).toContain(`grant execute on function public.${signature} to service_role;`)
    }
    expect(migration).toContain('revoke all on function private.lock_test_lifecycle(uuid) from public, anon, authenticated, service_role;')
    const existingRuntime = read('scripts/check-database-lint-warning-resolutions.sh')
    for (const failure of ['Non-owner Test unsubmit was accepted', 'Null Test-unsubmit actor was accepted', 'Null grade-clear clock was accepted', 'Rejected Test unsubmit changed the attempt or response']) {
      expect(existingRuntime).toContain(failure)
    }
  })
})
