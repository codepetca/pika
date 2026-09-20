import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/190_contextual_assignment_artifacts.sql',
  'utf8',
)

function functionBody(name: string): string {
  return migration().split(`function public.${name}(`)[1]?.split('$function$;')[0] ?? ''
}

describe('contextual assignment artifacts migration', () => {
  it('adds service-only prepare, upsert, and delete boundaries', () => {
    const sql = migration()
    for (const name of [
      'prepare_assignment_artifact_for_member_v1',
      'upsert_assignment_artifact_for_member_v1',
      'delete_assignment_artifact_for_member_v1',
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
    expect(sql.match(/security definer/g)).toHaveLength(3)
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4)
    expect(sql).toMatch(/revoke all on function private\.lock_assignment_artifact_member_context_v1\([^;]+service_role/s)
  })

  it('uses one locked context with document fences before membership authorization', () => {
    const sql = migration()
    const body = sql
      .split('function private.lock_assignment_artifact_member_context_v1(')[1]
      ?.split('$function$;')[0] ?? ''
    const submissionLock = body.indexOf("'assignment_submission:'")
    const editorLock = body.indexOf("p_assignment_id::text || ':' || p_actor_id::text")
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const membershipLock = body.indexOf('private.try_lock_classroom_membership_change')
    const parentLocks = body.indexOf('for update of classroom, assignment')
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
    const requirement = body.indexOf('from public.assignment_submission_requirements as requirement_row')
    const doc = body.indexOf('from public.assignment_docs as document')
    const artifact = body.indexOf('from public.assignment_submission_artifacts as artifact_row')

    expect(submissionLock).toBeGreaterThan(-1)
    expect(submissionLock).toBeLessThan(editorLock)
    expect(editorLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(membershipLock)
    expect(membershipLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(enrollment)
    expect(enrollment).toBeLessThan(requirement)
    expect(requirement).toBeLessThan(doc)
    expect(doc).toBeLessThan(artifact)
    expect(body).toContain('v_assignment_classroom_id is distinct from v_initial_classroom_id')
    expect(body).toContain('v_archived_at is not null')
    expect(body).toContain('v_assignment_released_at > clock_timestamp()')
  })

  it('binds mutations to exact member, requirement, document, and managed object evidence', () => {
    const upsert = functionBody('upsert_assignment_artifact_for_member_v1')
    const deletion = functionBody('delete_assignment_artifact_for_member_v1')
    expect(upsert).toContain('v_context.requirement_type is distinct from p_type')
    expect(upsert).toContain('p_managed_object_id is null')
    expect(upsert).toContain('assignment_doc_id,')
    expect(upsert).toContain('p_actor_id,')
    expect(upsert).toContain('previous_storage_path')
    expect(upsert).toContain('on conflict (user_id) do update')
    expect(deletion).toContain('artifact.student_id = p_actor_id')
    expect(deletion).toContain("'assignment_doc_submitted'")
  })

  it('keeps rollback-only behavior and multi-connection races in the architecture lane', () => {
    const behavior = readFileSync(
      'scripts/check-contextual-assignment-artifacts-database.sh',
      'utf8',
    )
    const concurrency = readFileSync(
      'scripts/check-contextual-assignment-doc-save-concurrency.mjs',
      'utf8',
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(behavior).toContain('Migration 190 is required; this harness never applies it')
    expect(behavior).toContain('Teacher-valued member artifact upsert returned invalid evidence')
    expect(behavior).toContain('Student-valued member artifact upsert returned invalid evidence')
    expect(behavior).toContain('Removed member deleted assignment artifact')
    expect(behavior).toContain('Managed image artifact deletion returned invalid evidence')
    expect(behavior).toContain('rollback;')
    expect(behavior).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(concurrency).toContain("'removal_wins_contextual_artifact'")
    expect(concurrency).toContain("'Migration 190 must already be applied'")
    expect(concurrency).toContain("console.log('Passed: contextual_artifact_wins_removal')")
    expect(concurrency).toContain("console.log('Passed: contextual_submit_wins_artifact')")
    expect(concurrency).toContain("console.log('Passed: contextual_artifact_wins_submit')")
    expect(workflow).toContain('bash scripts/check-contextual-assignment-artifacts-database.sh')
    expect(workflow).toContain('node scripts/check-contextual-assignment-doc-save-concurrency.mjs')
  })
})
