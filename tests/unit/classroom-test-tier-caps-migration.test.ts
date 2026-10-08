import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source contracts complement, but do not execute, the rollback database fixture.
const migration = () => readFileSync(resolve(process.cwd(), 'supabase/migrations/253_classroom_test_tier_caps.sql'), 'utf8')

describe('dormant classroom Test quota database contract', () => {
  it('keeps activation and the privileged guard private and inaccessible', () => {
    const sql = migration()
    expect(sql).toContain('create table private.classroom_test_quota_settings')
    expect(sql).toContain('enabled boolean not null default false')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('from public, anon, authenticated, service_role')
    expect(sql).toMatch(/security definer\s+set search_path = ''/)
    expect(sql).not.toMatch(/grant |create (?:or replace )?function public\./i)
  })

  it('enforces additions and moves while preserving edits and retained restore graphs', () => {
    const sql = migration()
    expect(sql).toContain('before insert or update of classroom_id on public.tests')
    expect(sql).toMatch(/old\.classroom_id is not distinct from new\.classroom_id[\s\S]*?return new/)
    expect(sql).toContain("public.is_classroom_archive_maintenance_mode('restore')")
    expect(sql).not.toContain("current_setting('pika.identity_mapping'")
    expect(sql).toContain('existing.id = new.id and existing.classroom_id = new.classroom_id')
  })

  it('uses the owner plan and preserves immutable purchased version benefits', () => {
    const sql = migration()
    expect(sql).toContain("when 'basic' then 20 when 'plus' then 50 when 'pro' then 100")
    expect(sql).toContain("when 'free' then 0")
    expect(sql).toContain('public.account_plans')
    expect(sql).toContain('public.stripe_billing_offering_versions')
    expect(sql).toContain("v_features ? 'tests_per_classroom'")
    expect(sql).toContain("pg_catalog.jsonb_typeof(v_features->'tests_per_classroom')")
    expect(sql).not.toMatch(/update public\.(?:account_plans|stripe_billing_offering_versions)|insert into public\./i)
  })

  it('serializes without waiting, checks ownership again and refuses stale isolation', () => {
    const sql = migration()
    expect(sql).toContain("current_setting('transaction_isolation') <> 'read committed'")
    expect(sql).toContain('pg_try_advisory_xact_lock')
    expect(sql).toContain("'account-plan-subject:' || v_owner_id::text, 20620260924")
    expect(sql).toContain('for update nowait')
    expect(sql).toContain('for share nowait')
    expect(sql).toContain('v_locked_owner_id is distinct from v_owner_id')
    expect(sql).not.toMatch(/pg_advisory_xact_lock\(/)
  })

  it('counts every Test row with closed quota errors', () => {
    const sql = migration()
    expect(sql).toMatch(/select count\(\*\) into v_count\s+from public\.tests test where test\.classroom_id = new\.classroom_id/)
    expect(sql).not.toMatch(/test\.status|test\.blueprint_archived_at/)
    for (const code of ['PTC01', 'PTC02', 'PTC03']) expect(sql).toContain(`errcode = '${code}'`)
    expect(sql).toContain('classroom_test_quota_exhausted')
    expect(sql).toContain('classroom_test_quota_unavailable')
    expect(sql).toContain('classroom_test_quota_busy')
  })

  it('includes rollback-only behavioral coverage for a migrated disposable database', () => {
    const sql = readFileSync(resolve(process.cwd(), 'scripts/check-classroom-test-tier-caps-database.sql'), 'utf8')
    expect(sql.trim()).toMatch(/^--[\s\S]*begin;/)
    expect(sql.trim()).toMatch(/rollback;$/)
    for (const label of ['tier boundaries', 'grandfathered edits', 'bulk rollback', 'target transfer', 'unknown plan', 'billing terms', 'privileges', 'identity mapping']) expect(sql).toContain(label)
  })

  it('binds every actual Test fixture insert to a valid actor and clears transferred categories', () => {
    const sql = readFileSync(resolve(process.cwd(), 'scripts/check-classroom-test-tier-caps-database.sql'), 'utf8')
    const columns = [...sql.matchAll(/insert into public\.tests\(([^)]+)\)/g)].map(match => match[1].split(','))
    expect(columns.length).toBeGreaterThanOrEqual(9)
    expect(columns.every(names => names.includes('created_by'))).toBe(true)
    expect((sql.match(/set classroom_id=v_target,gradebook_category_id=null/g) ?? []).length).toBe(2)
  })

  it('resolves current trial facts and both unapplied and applied expiry without rewriting paid terms', () => {
    const sql = migration()
    for (const token of ["v_plan.management_source = 'trial'", 'public.billing_account_access', 'public.billing_trials',
      'public.billing_trial_definitions', 'public.effective_feature_entitlements',
      'v_access.account_plan_revision is distinct from v_plan.revision',
      'v_access.entitlement_revision is distinct from v_entitlement.revision',
      'v_trial.converted_to_paid_at is not null', 'v_trial.ends_at',
      "v_plan.plan_key = 'plus'", "v_plan.plan_key = 'free'", 'v_access.expiry_applied_at',
      'v_limit := 50', 'pg_catalog.clock_timestamp() >= v_trial.ends_at']) expect(sql.includes(token)).toBe(true)
  })

  it('prepares real trial-writer fixtures with active, stale-expired, applied-Free and malformed cases', () => {
    const sql = readFileSync(resolve(process.cwd(), 'scripts/check-classroom-test-tier-caps-database.sql'), 'utf8')
    for (const token of ['private.billing_write_access_v1', 'active trial 1-50', 'unapplied trial expiry',
      'applied trial Free', 'malformed trial facts', 'missing trial facts', 'stale trial revision',
      'generate_series(1,50)', 'converted_to_paid_at', 'billing_account_access']) expect(sql.includes(token)).toBe(true)
  })
})
