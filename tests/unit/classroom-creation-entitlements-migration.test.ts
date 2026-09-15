import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/166_classroom_creation_entitlements.sql'),
  'utf8',
)

describe('classroom creation entitlement migration', () => {
  it('keeps effective grants service-only, revisioned, and operation-idempotent', () => {
    expect(migration).toContain('create table public.effective_feature_entitlements')
    expect(migration).toContain('create table public.effective_feature_entitlement_audit')
    expect(migration).toContain('operation_id uuid not null unique')
    expect(migration).toContain('feature_entitlement_operation_conflict')
    expect(migration).toContain('feature_entitlement_revision_conflict')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('grant select on table public.effective_feature_entitlements to service_role')
    expect(migration).not.toContain('grant insert on table public.effective_feature_entitlement_audit')
    const auditDefinition = migration.slice(
      migration.indexOf('create table public.effective_feature_entitlement_audit'),
      migration.indexOf('alter table public.effective_feature_entitlements enable row level security'),
    )
    expect(auditDefinition).not.toContain('references public.users')
  })

  it('preserves unmanaged accounts and enforces managed denials at the classroom table', () => {
    expect(migration).toContain('if v_entitlement.subject_user_id is null then')
    expect(migration).toContain('classroom_creation_entitlement_unavailable')
    expect(migration).toContain('classroom_creation_entitlement_disabled')
    expect(migration).toContain('classroom_creation_entitlement_not_started')
    expect(migration).toContain('classroom_creation_entitlement_expired')
    expect(migration).toContain('classroom_creation_active_limit_reached')
    expect(migration).toContain('before insert or update of teacher_id, archived_at on public.classrooms')
    expect(migration).toContain('old.archived_at is not null')
    expect(migration).toContain('new.teacher_id is distinct from old.teacher_id')
  })

  it('wraps Blueprint materialization before its internal catch boundary', () => {
    expect(migration).toContain(
      'rename to instantiate_course_blueprint_atomic_v2_pre_create_entitlement',
    )
    expect(migration).toMatch(
      /create function public\.instantiate_course_blueprint_atomic_v2\([\s\S]*?perform public\.assert_classroom_creation_allowed_v1/,
    )
    expect(migration).toMatch(
      /select \* into v_operation[\s\S]*?v_operation\.status is distinct from 'completed'[\s\S]*?assert_classroom_creation_allowed_v1/,
    )
    expect(migration).toContain(
      'revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_create_entitlement',
    )
    expect(migration).toContain(
      'grant execute on function public.instantiate_course_blueprint_atomic_v2(',
    )
  })

  it('does not encode product plan names or seed a rollout cohort', () => {
    expect(migration).not.toMatch(/plan_name|subscription|billing_customer|stripe/i)
    expect(migration.match(/insert into public\.effective_feature_entitlements\s*\(/gi)).toHaveLength(1)
  })
})
