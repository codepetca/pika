import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/206_account_plan_foundation.sql'),
  'utf8',
)

describe('account plan foundation migration', () => {
  it('derives classroom limits from exactly four plans, with no custom quota input', () => {
    expect(migration).toMatch(/when 'free' then 0\s+when 'basic' then 2\s+when 'plus' then 5\s+when 'pro' then 10/)
    expect(migration).toMatch(/v_limit := case p_plan_key[\s\S]*when 'free' then 0[\s\S]*when 'basic' then 2[\s\S]*when 'plus' then 5[\s\S]*when 'pro' then 10/)
    expect(migration).toMatch(/'classrooms\.create',\s*'plan',\s*v_limit > 0,[\s\S]*v_limit/)
    expect(migration).not.toMatch(/p_quota_limit|p_classroom_limit|p_enabled/)
  })

  it('keeps plan writes service-only, revisioned, idempotent and audited', () => {
    expect(migration).toContain('create table public.account_plans')
    expect(migration).toContain('create table public.account_plan_audit')
    expect(migration).toContain('operation_id uuid not null unique')
    expect(migration).toContain('account_plan_operation_conflict')
    expect(migration).toContain('account_plan_revision_conflict')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('set_effective_feature_entitlement_v1')
    expect(migration).toContain('revoke all on function public.set_account_plan_v1')
    expect(migration).toContain('grant execute on function public.set_account_plan_v1')
    expect(migration).not.toMatch(/grant (?:insert|update|delete) on table public\.account_plans/i)
    const auditTable = migration.slice(
      migration.indexOf('create table public.account_plan_audit'),
      migration.indexOf('create index account_plan_audit_subject_created'),
    )
    expect(auditTable).not.toContain('references public.users')
  })

  it('changes no existing account and provisions Free only after strict activation', () => {
    expect(migration).toMatch(/if not v_strict_enforcement_enabled then\s*return new;\s*end if;\s*perform public\.set_account_plan_v1/)
    expect(migration).toContain("'default_free_account_provisioning'")
    expect(migration).not.toMatch(/insert\s+into\s+public\.account_plans[\s\S]*select[\s\S]*from\s+public\.users/i)
    expect(migration).not.toMatch(/strict_enforcement_enabled\s*=\s*true/i)
  })
})
