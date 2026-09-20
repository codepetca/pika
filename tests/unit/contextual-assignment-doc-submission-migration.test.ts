import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/186_contextual_assignment_doc_submission.sql',
  'utf8',
)

function functionBody(name: string): string {
  return migration().split(`function public.${name}(`)[1]?.split('$function$;')[0] ?? ''
}

describe('contextual assignment document submission migration', () => {
  it('adds service-only submit and unsubmit boundaries without changing rows', () => {
    const sql = migration()
    for (const name of [
      'submit_assignment_doc_for_member_v1',
      'unsubmit_assignment_doc_for_member_v1',
    ]) {
      expect(sql).toContain(`function public.${name}(`)
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`,
        's',
      ))
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\([^;]+to service_role`,
        's',
      ))
    }
    expect(sql.match(/security definer/g)).toHaveLength(2)
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2)
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|from)?\s*public\.(?:users|classrooms|assignments)\b/i)
  })

  it.each([
    'submit_assignment_doc_for_member_v1',
    'unsubmit_assignment_doc_for_member_v1',
  ])('takes document fences before classroom membership authorization in %s', (name) => {
    const body = functionBody(name)
    const submissionLock = body.indexOf("'assignment_submission:'")
    const editorLock = body.indexOf("p_assignment_id::text || ':' || p_actor_id::text")
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const membershipLock = body.indexOf('private.try_lock_classroom_membership_change')
    const parentLocks = body.indexOf('for update of classroom, assignment')
    const visibility = body.indexOf('or v_assignment_is_draft', parentLocks)
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')

    expect(submissionLock).toBeGreaterThan(-1)
    expect(submissionLock).toBeLessThan(editorLock)
    expect(editorLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(membershipLock)
    expect(membershipLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(visibility)
    expect(visibility).toBeLessThan(enrollment)
    expect(body).toContain('v_assignment_classroom_id is distinct from v_initial_classroom_id')
    expect(body).toContain('v_archived_at is not null')
    expect(body).toContain('v_assignment_released_at > clock_timestamp()')
    expect(body).toContain('for share;')
  })

  it('delegates legacy submit semantics, validates Pal timing, and binds returned evidence', () => {
    const body = functionBody('submit_assignment_doc_for_member_v1')
    expect(body).toContain('public.submit_assignment_doc_with_pal_event_atomic(')
    expect(body).toContain('public.submit_assignment_doc_atomic(')
    expect(body).toContain("p_pal_event->>'event_type' <> 'learning_item.completed'")
    expect(body).toContain("p_pal_event->'metadata'->>'timing' is distinct from v_expected_timing")
    expect(body).toContain("v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text")
    expect(body).toContain("v_result->'doc'->>'student_id' is distinct from p_actor_id::text")
    expect(body).toContain("v_result->'history_entry'->>'assignment_doc_id'")
    expect(body).toContain("jsonb_build_object('classroom_id', v_assignment_classroom_id)")
  })

  it('delegates legacy unsubmit semantics and binds returned evidence', () => {
    const body = functionBody('unsubmit_assignment_doc_for_member_v1')
    expect(body).toContain('v_result := public.unsubmit_assignment_doc_atomic(')
    expect(body).toContain("v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text")
    expect(body).toContain("v_result->'doc'->>'student_id' is distinct from p_actor_id::text")
    expect(body).toContain("jsonb_build_object('classroom_id', v_assignment_classroom_id)")
  })

  it('keeps rollback-only behavior and multi-connection races in the architecture lane', () => {
    const behavior = readFileSync(
      'scripts/check-contextual-assignment-doc-submission-database.sh',
      'utf8',
    )
    const concurrency = readFileSync(
      'scripts/check-contextual-assignment-doc-save-concurrency.mjs',
      'utf8',
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(behavior).toContain('Migration 186 is required; this harness never applies it')
    expect(behavior).toContain('Teacher-valued exact member submit returned invalid evidence')
    expect(behavior).toContain('Student-valued exact member submit returned invalid evidence')
    expect(behavior).toContain('Teacher-valued exact member unsubmit returned invalid evidence')
    expect(behavior).toContain('rollback;')
    expect(behavior).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(concurrency).toContain("'removal_wins_contextual_submit'")
    expect(concurrency).toContain("console.log('Passed: contextual_submit_wins_removal')")
    expect(concurrency).toContain("console.log('Passed: contextual_submit_wins_save')")
    expect(concurrency).toContain("console.log('Passed: save_wins_contextual_submit')")
    expect(concurrency).toContain("console.log('Passed: contextual_unsubmit_wins_save')")
    expect(concurrency).toContain("console.log('Passed: save_wins_contextual_unsubmit')")
    expect(workflow).toContain('bash scripts/check-contextual-assignment-doc-submission-database.sh')
    expect(workflow).toContain('node scripts/check-contextual-assignment-doc-save-concurrency.mjs')
  })
})
