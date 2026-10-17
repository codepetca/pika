import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/268_contextual_classroom_hot_lifecycle.sql', 'utf8')

describe('hot classroom lifecycle SQL contracts (offline)', () => {
  it('exposes one service-only, empty-search-path owner function without role gating', () => {
    expect(migration).toContain('create function public.set_classroom_hot_archive_for_owner_v1(')
    expect(migration).toContain('p_archived boolean')
    expect(migration).toMatch(/returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/)
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration).not.toMatch(/users\.role|auth\.uid|disable trigger|session_replication_role|create or replace function/)
  })

  it('locks entitlement subject, purge operation, classroom and archive revision in that order', () => {
    const subject = migration.indexOf('perform public.lock_effective_feature_entitlement_v1(')
    const operation = migration.indexOf('public.classroom_purge_try_lock(p_classroom_id)')
    const row = migration.indexOf('select classroom.* into v_before')
    const revision = migration.indexOf('select revision.* into v_archive_before')
    expect(subject).toBeGreaterThan(-1)
    expect(subject).toBeLessThan(operation)
    expect(operation).toBeLessThan(row)
    expect(row).toBeLessThan(revision)
    expect(migration.match(/for update nowait/g)).toHaveLength(2)
    expect(migration).toContain('public.guard_classroom_purge_lifecycle(p_classroom_id)')
    expect(migration).toContain("public.is_classroom_archive_maintenance_mode('restore')")
    expect(migration).toContain("public.is_classroom_archive_maintenance_mode('compaction')")
  })

  it('keeps archive independent of grants and asserts live admission only when restoring to the top', () => {
    const archive = migration.slice(migration.indexOf('if p_archived then'), migration.indexOf('update public.classrooms classroom set'))
    expect(archive).toContain('v_expected.archived_at := clock_timestamp()')
    expect(archive).toContain('else')
    expect(archive.indexOf('else')).toBeLessThan(archive.indexOf('public.assert_classroom_creation_allowed_v1('))
    expect(archive).toContain('p_actor_id, p_classroom_id, clock_timestamp()')
    expect(archive).toContain('coalesce(min(classroom.position), 1) - 1')
    expect(archive).toContain('classroom.archived_at is null')
    expect(migration).toContain('classroom_hot_lifecycle_already_archived')
    expect(migration).toContain('classroom_hot_lifecycle_not_archived')
  })

  it('rereads immediate trigger effects, checks exactly one row and exact revision advance, and returns the explicit owner projection', () => {
    expect(migration).toContain('get diagnostics v_count = row_count')
    expect(migration).toContain('if v_count <> 1 then')
    expect(migration.indexOf('select classroom.* into v_after')).toBeGreaterThan(migration.indexOf('get diagnostics v_count'))
    expect(migration).toContain('to_jsonb(v_after) is distinct from to_jsonb(v_expected)')
    expect(migration).toContain("'revision', v_archive_before.revision + 1, 'updated_at', transaction_timestamp()")
    expect(migration).toContain('v_archive_before.revision is null or v_archive_before.revision < 1')
    expect(migration).toContain('v_result is distinct from to_jsonb(v_after)')
    const projection = migration.slice(migration.indexOf('v_result := jsonb_build_object('), migration.indexOf('if v_result is distinct'))
    expect([...projection.matchAll(/'\w+',v_after\.\w+/g)]).toHaveLength(30)
    expect(migration).toContain("when lock_not_available or deadlock_detected or serialization_failure then")
    expect(migration).toContain("when sqlstate '55000' then")
  })

  it('keeps native checks rollback-only behind the established exact local container guard', () => {
    const sql = readFileSync('scripts/check-contextual-classroom-hot-lifecycle-database.sql', 'utf8')
    const shell = readFileSync('scripts/check-contextual-classroom-hot-lifecycle-database.sh', 'utf8')
    for (const token of ['supabase_db_pika', 'com.supabase.cli.project', '54322', 'ON_ERROR_STOP=1']) expect(shell).toContain(token)
    expect(spawnSync('bash', ['-n'], { input: shell, encoding: 'utf8' }).status).toBe(0)
    expect(sql).toContain('begin;')
    expect(sql.trimEnd()).toMatch(/rollback;$/)
    expect(sql).toContain('set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean)')
    expect(sql).not.toMatch(/disable trigger|session_replication_role|create table public\./i)
    for (const token of [
      'owner_teacher', 'owner_student', 'member', 'outsider', 'acl.grantee=0',
      'classroom_hot_lifecycle_already_archived', 'classroom_hot_lifecycle_not_archived',
      'classroom_creation_entitlement_disabled', 'classroom_creation_entitlement_not_started',
      'classroom_creation_entitlement_expired', 'classroom_creation_active_limit_reached',
      'classroom_creation_entitlement_unavailable', 'Preserved announcement', 'pg_temp.hot_content_state()',
      'before_archive', 'before_position', 'late_owner', 'late_title', 'late_provenance',
      'late_blueprint_revision', 'late_archive_revision', 'pg_trigger_depth()',
      'v_before is distinct from pg_temp.hot_state()', 'enforce_classroom_creation_entitlement',
      'attendance_decommission_operations',
    ]) expect(sql).toContain(token)
  })
})
