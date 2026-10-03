import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('scripts/check-contextual-classroom-metadata-database.sql', 'utf8')
const shell = readFileSync('scripts/check-contextual-classroom-metadata-database.sh', 'utf8')
const sdk = readFileSync('scripts/check-contextual-classroom-metadata.ts', 'utf8')
describe('metadata proof source contracts (no database execution)', () => {
  it('binds rollback-only SQL to local guarded execution and the actual installed RPC signature', () => {
    expect(shell).toContain('supabase_db_pika')
    expect(shell).toContain('com.supabase.cli.project')
    expect(shell).toContain('54322')
    expect(shell).toContain('ON_ERROR_STOP=1')
    expect(spawnSync('bash', ['-n'], { input: shell, encoding: 'utf8' }).status).toBe(0)
    expect(sql).toContain('begin;')
    expect(sql.trimEnd()).toMatch(/rollback;$/)
    expect(sql).toContain('update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb)')
    expect(sql).not.toMatch(/disable trigger|session_replication_role|create table public\./i)
  })
  it('proves full state rollback for suppression, substitution and late owner/archive/metadata/provenance/revision faults', () => {
    for (const token of ['suppress_noop', 'before_title', 'late_owner', 'late_archive', 'late_title', 'late_provenance', 'late_blueprint_revision', 'late_archive_revision', 'to_jsonb(c)', 'to_jsonb(r)', 'v_before is distinct from v_after']) expect(sql).toContain(token)
    expect(sql).toContain("patch,'PT503')")
    expect(sql).toContain('pg_trigger_depth()')
    expect(sql).toContain('idx_classrooms_actual_site_slug_unique')
    expect(sql).toContain('actual_site_published')
    expect(sql).toContain('student_grades')
    expect(sql).toContain('lesson_plan_scope')
  })
  it('checks installed SDK body, JSON object response, hydration, wire clone rebind and uncertain commit without replay', () => {
    for (const token of ['createClient<Database>', '/rest/v1/rpc/update_classroom_metadata_for_owner_v1', 'p_actor_id', 'p_classroom_id', 'p_patch', 'normalizeContextualClassroomMetadataPatch', 'hydrateClassroomRecord', 'body = changed', 'No automatic replay', 'lost_after_commit']) expect(sdk).toContain(token)
    expect(sdk).not.toMatch(/as unknown as|@ts-ignore|disable trigger|session_replication_role/)
  })
  it('uses deterministic transaction barriers and observed blocking for slug/lifecycle/publication races', () => {
    for (const token of ['pg_blocking_pids', 'READY', 'metadata_wins_transfer', 'metadata_wins_archive', 'slug_collision', 'publish_clear_slug', 'FOR UPDATE', 'COMMIT', 'ROLLBACK']) expect(sdk).toContain(token)
    expect(sdk).not.toContain('pg_sleep')
  })
  it('preallocates transfer capacity, fences target/cleanup, and verifies whole-row baseline before commit and afterward', () => {
    for (const token of ['54321', '54322', 'fixture_ids', 'classrooms.create', 'transferTarget', 'guard_pal_membership_evidence', 'to_jsonb(r)::text', 'Unexpected private/Storage fixture dependency', 'Unexpected provider fixture state', 'system:user-provisioning', 'default_free_account_provisioning', 'metadata_fingerprint() is distinct from', 'assert.deepEqual(fingerprint(), baseline)']) expect(sdk).toContain(token)
    expect(sdk).toContain('finally')
    expect(sdk).not.toContain('delete from private.pal_membership_generations')
  })
  it('locks exact operation and row candidates before snapshots, scans, and cascade deletion', () => {
    const cleanup = sdk.slice(sdk.indexOf('const createdValues = classes.map'))
    const operation = cleanup.indexOf('public.classroom_purge_try_lock')
    const snapshot = cleanup.indexOf('create temp table metadata_class_snapshot')
    const dependencyScan = cleanup.indexOf('for dependency in select jsonb_object_keys')
    expect(operation).toBeGreaterThan(-1)
    expect(operation).toBeLessThan(snapshot)
    for (const [table, key] of [
      ['users', 'id'], ['classrooms', 'id'], ['student_profiles', 'id'], ['account_plans', 'subject_user_id'],
      ['account_plan_audit', 'id'], ['effective_feature_entitlements', 'subject_user_id,feature_key'],
      ['effective_feature_entitlement_audit', 'id'], ['classroom_archive_revisions', 'classroom_id'],
    ]) {
      const lock = new RegExp(`select 1 from public\\.${table} where[^;]+order by ${key} FOR UPDATE NOWAIT;`).exec(cleanup)
      expect(lock, `exact deterministic ${table} row lock`).not.toBeNull()
      expect(lock?.index).toBeGreaterThan(operation)
      expect(lock?.index).toBeLessThan(snapshot)
      expect(lock?.index).toBeLessThan(dependencyScan)
    }
    expect(cleanup).toContain('Metadata cleanup operation is contended')
    expect(cleanup).toContain('to_jsonb(a)=to_jsonb(s)')
    expect(cleanup).not.toMatch(/lock table|pg_advisory_xact_lock|disable trigger/i)
  })
  it('accepts only the three untouched automatic default categories per synthetic classroom', () => {
    const cleanup = sdk.slice(sdk.indexOf('const createdValues = classes.map'))
    const lock = cleanup.indexOf('select 1 from public.gradebook_categories')
    const snapshot = cleanup.indexOf('create temp table metadata_category_snapshot')
    const scan = cleanup.indexOf('for dependency in select jsonb_object_keys')
    expect(lock).toBeGreaterThan(cleanup.indexOf('public.classroom_purge_try_lock'))
    expect(lock).toBeLessThan(cleanup.indexOf('create temp table metadata_class_snapshot'))
    expect(cleanup.slice(lock, snapshot)).toContain('order by id FOR UPDATE NOWAIT;')
    expect(snapshot).toBeLessThan(scan)
    expect(cleanup).toContain('insert into fixture_ids select id::text from metadata_category_snapshot')
    expect(cleanup.indexOf('insert into fixture_ids select id::text from metadata_category_snapshot')).toBeLessThan(scan)
    for (const token of [
      "'public.gradebook_categories'", 'metadata_default_category_expected',
      "('Attendance'::text,10::numeric,10,0,false)", "('Term'::text,65::numeric,10,1,true)", "('Final'::text,25::numeric,10,2,false)",
      '3*(select count(*) from metadata_class_snapshot)',
      'g.percentage is distinct from e.percentage', 'g.default_assessment_weight is distinct from e.default_assessment_weight',
      'g.position is distinct from e.position', 'g.is_default is distinct from e.is_default',
      'g.created_at is distinct from c.created_at', 'g.updated_at is distinct from g.created_at',
      'Unexpected synthetic default gradebook categories',
      'g.id=s.id and g.classroom_id=s.classroom_id and to_jsonb(g)=to_jsonb(s)',
      'get diagnostics removed=ROW_COUNT', 'Synthetic default category deletion differs',
    ]) expect(cleanup).toContain(token)
    expect(cleanup.indexOf('delete from public.gradebook_categories')).toBeLessThan(cleanup.indexOf('delete from public.classrooms'))
    expect(cleanup).not.toMatch(/delete from public\.gradebook_categories[^;]*(?:like|name\s*=)/i)
  })
  it.each(['--verify-cleanup-after-fixture', '--verify-cleanup-after-commit-before-capture'])('has exact failure and cleanup markers for %s', flag => {
    expect(sdk).toContain(flag)
    expect(sdk).toContain(`(expected for ${flag})`)
    expect(sdk).toContain('PASS exact synthetic metadata cleanup, zero residual rows and global whole-row baseline counts')
    expect(sdk).toContain('process.exitCode = 1')
  })
})
