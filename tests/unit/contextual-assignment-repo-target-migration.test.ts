import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/200_contextual_assignment_repo_target.sql',
  'utf8',
)
const behaviorScript = () => readFileSync(
  'scripts/check-contextual-assignment-repo-target-database.sh',
  'utf8',
)
const concurrencyScript = () => readFileSync(
  'scripts/check-contextual-assignment-repo-target-concurrency.mjs',
  'utf8',
)
const workflow = () => readFileSync('.github/workflows/ci.yml', 'utf8')

describe('contextual Assignment repo target migration', () => {
  it('takes Assignment, Classroom, and learner-purge fences before row locks', () => {
    const sql = migration()
    const assignmentFence = sql.indexOf("'assignment_submission:'")
    const classroomFence = sql.indexOf("'pika-classroom-operation:'")
    const purgeFence = sql.indexOf('private.try_lock_classroom_membership_change(')
    const rowLock = sql.indexOf('for update of classroom, assignment')

    expect(assignmentFence).toBeGreaterThan(0)
    expect(assignmentFence).toBeLessThan(classroomFence)
    expect(classroomFence).toBeLessThan(purgeFence)
    expect(purgeFence).toBeLessThan(rowLock)
    expect(sql).toContain('v_owner_id is distinct from p_actor_id')
    expect(sql).toContain('v_archived_at is not null or v_blueprint_archived_at is not null')
    expect(sql).toContain('Student is not enrolled in this classroom')
  })

  it('keeps the boundary fixed-search-path and service-only', () => {
    const sql = migration()
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(/revoke all on function public\.save_assignment_repo_target_for_owner_v1\([\s\S]+?from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.save_assignment_repo_target_for_owner_v1\([\s\S]+?to service_role/)
  })

  it('runs rollback-only behavior and concurrency contracts in CI', () => {
    expect(behaviorScript()).toContain('rollback;')
    expect(behaviorScript()).not.toContain('supabase db push')
    expect(concurrencyScript()).toContain('archive_wins_contextual_assignment_repo_target')
    expect(concurrencyScript()).toContain('contextual_assignment_repo_target_wins_archive')
    expect(concurrencyScript()).toContain('student_purge_subject_wins_contextual_assignment_repo_target')
    expect(concurrencyScript()).not.toContain('supabase db push')
    expect(workflow()).toContain('bash scripts/check-contextual-assignment-repo-target-database.sh')
    expect(workflow()).toContain('node scripts/check-contextual-assignment-repo-target-concurrency.mjs')
  })
})
