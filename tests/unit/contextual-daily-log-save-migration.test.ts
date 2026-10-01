import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync('supabase/migrations/223_contextual_daily_log_save.sql', 'utf8')

describe('contextual Daily Log save boundary', () => {
  it('has a unique migration number after reconciliation with main', () => {
    const migrations = readdirSync('supabase/migrations')
    expect(migrations.filter((name) => name.startsWith('223_'))).toEqual([
      '223_contextual_daily_log_save.sql',
    ])
    expect(migrations).not.toContain('218_contextual_daily_log_save.sql')
  })

  it('is additive, service-only, and has an empty search path', () => {
    const sql = migration()
    expect(sql).toContain('create function public.save_daily_log_for_member_v1(')
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(/revoke all on function public\.save_daily_log_for_member_v1\([^;]+from public, anon, authenticated/s)
    expect(sql).toMatch(/grant execute on function public\.save_daily_log_for_member_v1\([^;]+to service_role/s)
    expect(sql).not.toMatch(/alter table|create policy|update public\.users|disable trigger/i)
  })

  it('takes the existing save fence before classroom/member fences and never waits on reverse-order row locks', () => {
    const sql = migration()
    const legacy = sql.indexOf("'pal_daily_log:'")
    const classroom = sql.indexOf("'pika-classroom-operation:'")
    const membership = sql.indexOf('private.try_lock_classroom_membership_change(')
    const parent = sql.indexOf('for update nowait;')
    const save = sql.indexOf('v_result := public.upsert_student_entry_with_pal_event_atomic(')
    expect(legacy).toBeGreaterThan(-1)
    expect(classroom).toBeGreaterThan(legacy)
    expect(membership).toBeGreaterThan(classroom)
    expect(parent).toBeGreaterThan(membership)
    expect(save).toBeGreaterThan(parent)
    expect(sql.match(/for (?:update|share) nowait;/g)).toHaveLength(4)
  })

  it('rechecks exact membership, owner precedence, lifecycle, date and revision before saving', () => {
    const sql = migration()
    expect(sql).toContain('v_teacher_id = p_actor_id')
    expect(sql).toContain('enrollment.student_id = p_actor_id')
    expect(sql).toContain('v_archived_at is not null')
    expect(sql).toContain("clock_timestamp() at time zone 'America/Toronto'")
    expect(sql).toContain('class_day.is_class_day')
    expect(sql).toContain('p_expected_version is null')
    expect(sql).toContain('v_entry.id is distinct from p_expected_entry_id')
    expect(sql).toContain('public.guard_classroom_purge_lifecycle(p_classroom_id)')
    expect(sql).toContain("v_result->'entry'->>'student_id' is distinct from p_actor_id::text")
    expect(sql).toContain("v_result->'entry'->>'classroom_id' is distinct from p_classroom_id::text")
    expect(sql).toContain("p_pal_event->'metadata'->>'activity_day' is distinct from p_date::text")
  })

  it('has a rollback-only behavior harness wired into CI', () => {
    const harness = readFileSync('scripts/check-contextual-daily-log-save-database.sh', 'utf8')
    expect(harness).toContain('Migration 223 is required; this harness never applies it')
    expect(harness).toContain('rollback;')
    expect(harness).toContain('Owner self-enrollment must not confer member access')
    expect(harness).toContain('Create-only retry overwrote an existing entry')
    expect(harness).not.toMatch(/supabase\s+(?:db push|migration up|db reset)/)
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('bash scripts/check-contextual-daily-log-save-database.sh')
    const concurrency = readFileSync('scripts/check-contextual-daily-log-save-concurrency.mjs', 'utf8')
    expect(concurrency).toContain('removal_wins')
    expect(concurrency).toContain('archive_wins')
    expect(concurrency).toContain('class_day_wins')
    expect(concurrency).toContain('simultaneous_save_preserves_revision_conflict')
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('node scripts/check-contextual-daily-log-save-concurrency.mjs')
  })
})
