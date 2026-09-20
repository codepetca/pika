import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/194_contextual_assignment_manual_grading.sql',
  'utf8',
)
const behaviorScript = () => readFileSync(
  'scripts/check-contextual-assignment-grading-database.sh',
  'utf8',
)
const concurrencyScript = () => readFileSync(
  'scripts/check-contextual-assignment-grading-concurrency.mjs',
  'utf8',
)
const workflow = () => readFileSync('.github/workflows/ci.yml', 'utf8')

describe('contextual Assignment manual grading migration', () => {
  it('fences narrow grading before Classroom ownership and delegates atomically', () => {
    const sql = migration()
    const gradingLock = sql.indexOf('hashtextextended(p_assignment_id::text, 0)')
    const classroomLock = sql.indexOf("'pika-classroom-operation:'")
    const rowLock = sql.indexOf('for update of classroom, assignment')
    const delegate = sql.indexOf('return public.save_assignment_grades_atomic(')

    expect(gradingLock).toBeGreaterThan(0)
    expect(gradingLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(rowLock)
    expect(rowLock).toBeLessThan(delegate)
    expect(sql).toContain('v_owner_id is distinct from p_actor_id')
    expect(sql).toContain('v_archived_at is not null or v_blueprint_archived_at is not null')
  })

  it('keeps the public boundary fixed-search-path and service-only', () => {
    const sql = migration()
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(/revoke all on function public\.save_assignment_grades_for_owner_v1\([\s\S]+?from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.save_assignment_grades_for_owner_v1\([\s\S]+?to service_role/)
  })

  it('runs rollback-only behavior and lifecycle concurrency contracts in CI', () => {
    expect(behaviorScript()).toContain('rollback;')
    expect(behaviorScript()).not.toContain('supabase db push')
    expect(concurrencyScript()).toContain('archive_wins_contextual_assignment_grade')
    expect(concurrencyScript()).toContain('contextual_assignment_grade_wins_archive')
    expect(concurrencyScript()).not.toContain('supabase db push')
    expect(workflow()).toContain('bash scripts/check-contextual-assignment-grading-database.sh')
    expect(workflow()).toContain('node scripts/check-contextual-assignment-grading-concurrency.mjs')
  })
})
