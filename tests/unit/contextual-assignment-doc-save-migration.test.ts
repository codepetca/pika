import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/184_contextual_assignment_doc_save.sql',
  'utf8',
)
const lockOrderMigration = () => readFileSync(
  'supabase/migrations/185_contextual_assignment_doc_save_lock_order.sql',
  'utf8',
)

describe('contextual assignment document save migration', () => {
  it('is an additive service-only security-definer boundary', () => {
    const sql = migration()
    expect(sql).toContain('function public.save_assignment_doc_for_member_v1(')
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(
      /revoke all on function public\.save_assignment_doc_for_member_v1\([^;]+from public, anon, authenticated/s,
    )
    expect(sql).toMatch(
      /grant execute on function public\.save_assignment_doc_for_member_v1\([^;]+to service_role/s,
    )
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|from)?\s*public\.(?:users|classrooms|assignments)\b/i)
  })

  it('rechecks visibility and exact membership after taking removal fences', () => {
    const body = lockOrderMigration().split('function public.save_assignment_doc_for_member_v1(')[1]
      .split('$function$;')[0]
    const submissionLock = body.indexOf("'assignment_submission:'")
    const editorLock = body.indexOf("p_assignment_id::text || ':' || p_actor_id::text")
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const membershipLock = body.indexOf('private.try_lock_classroom_membership_change')
    const parentLocks = body.indexOf('for update of classroom, assignment')
    const visibility = body.indexOf('or v_assignment_is_draft', parentLocks)
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
    const save = body.indexOf('public.save_assignment_doc_atomic(')

    expect(submissionLock).toBeGreaterThan(-1)
    expect(submissionLock).toBeLessThan(editorLock)
    expect(editorLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeGreaterThan(-1)
    expect(classroomLock).toBeLessThan(membershipLock)
    expect(membershipLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(visibility)
    expect(visibility).toBeLessThan(enrollment)
    expect(enrollment).toBeLessThan(save)
    expect(body).toContain('v_assignment_classroom_id is distinct from v_initial_classroom_id')
    expect(body).toContain('v_archived_at is not null')
    expect(body).toContain('v_assignment_released_at > clock_timestamp()')
    expect(body).toContain('for share;')
  })

  it('delegates established revision/history/metric semantics and binds returned evidence', () => {
    const body = lockOrderMigration().split('function public.save_assignment_doc_for_member_v1(')[1]
      .split('$function$;')[0]
    expect(body).toContain('v_result := public.save_assignment_doc_atomic(')
    expect(body).toContain("v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text")
    expect(body).toContain("v_result->'doc'->>'student_id' is distinct from p_actor_id::text")
    expect(body).toContain("v_result->'history_entry'->>'assignment_doc_id'")
    expect(body).toContain("jsonb_typeof(v_result) is distinct from 'object'")
    expect(body).toContain("jsonb_typeof(v_result->'ok') is distinct from 'boolean'")
  })

  it('keeps rollback-only database behavior in the architecture lane', () => {
    const behavior = readFileSync(
      'scripts/check-contextual-assignment-doc-save-database.sh',
      'utf8',
    )
    const concurrency = readFileSync(
      'scripts/check-contextual-assignment-doc-save-concurrency.mjs',
      'utf8',
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(behavior).toContain('Migration 185 is required; this harness never applies it')
    expect(behavior).toContain('Teacher-valued exact member save returned invalid evidence')
    expect(behavior).toContain('Student-valued exact member save returned invalid evidence')
    expect(behavior).toContain('Structured revision conflict was not preserved')
    expect(behavior).toContain('rollback;')
    expect(behavior).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(concurrency).toContain("'removal_wins'")
    expect(concurrency).toContain("'archive_wins'")
    expect(concurrency).toContain("'draft_wins'")
    expect(concurrency).toContain("console.log('Passed: save_wins')")
    expect(concurrency).toContain("console.log('Passed: duplicate_save')")
    expect(concurrency).toContain("console.log('Passed: submit_wins')")
    expect(concurrency).toContain("console.log('Passed: save_wins_submit')")
    expect(concurrency).toContain("console.log('Passed: legacy_save_wins')")
    expect(concurrency).toContain("console.log('Passed: contextual_save_wins')")
    expect(concurrency).toContain("console.log('Passed: unsubmit_wins')")
    expect(concurrency).toContain("console.log('Passed: save_wins_draft')")
    expect(concurrency).toContain("console.log('Passed: save_wins_archive')")
    expect(concurrency).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(workflow).toContain('bash scripts/check-contextual-assignment-doc-save-database.sh')
    expect(workflow).toContain('node scripts/check-contextual-assignment-doc-save-concurrency.mjs')
  })
})
