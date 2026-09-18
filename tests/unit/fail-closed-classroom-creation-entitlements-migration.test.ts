import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/181_fail_closed_classroom_creation_entitlements.sql',
  ),
  'utf8',
)

describe('fail-closed classroom creation entitlement migration', () => {
  it('keeps all accounts compatible until activation then provisions future accounts as Free', () => {
    expect(migration).toContain('strict_enforcement_enabled boolean not null default false')
    expect(migration).toContain('after insert on public.users')
    expect(migration).toContain("'classrooms.create'")
    expect(migration).toContain("'plan'")
    expect(migration).toContain("'system:user-provisioning'")
    expect(migration).toContain("'default_free_account_provisioning'")
    expect(migration).toMatch(
      /provision_default_classroom_creation_entitlement_v1[\s\S]*if not v_strict_enforcement_enabled then[\s\S]*return new;[\s\S]*set_effective_feature_entitlement_v1/,
    )
    expect(migration).not.toMatch(
      /insert\s+into\s+public\.effective_feature_entitlements[\s\S]*select[\s\S]*from\s+public\.users/i,
    )
    expect(migration).not.toMatch(/where\s+(?:account\.)?email\s*=|@codepet\./i)
  })

  it('serializes signup and creation with the one-way cutover boundary', () => {
    expect(migration).toMatch(
      /provision_default_classroom_creation_entitlement_v1[\s\S]*classroom_creation_entitlement_settings[\s\S]*for share[\s\S]*set_effective_feature_entitlement_v1/,
    )
    expect(migration).toMatch(
      /assert_classroom_creation_allowed_v1[\s\S]*lock_effective_feature_entitlement_v1[\s\S]*classroom_creation_entitlement_settings[\s\S]*for share/,
    )
    expect(migration).toMatch(
      /activate_classroom_creation_entitlement_cutover_v1[\s\S]*classroom_creation_entitlement_settings[\s\S]*for update/,
    )
    expect(migration).toContain('classroom_creation_cutover_incomplete')
    expect(migration).not.toMatch(/strict_enforcement_enabled\s*=\s*false/i)
  })

  it('fails closed for missing snapshots only after controlled activation', () => {
    expect(migration).toMatch(
      /if v_entitlement\.subject_user_id is null then[\s\S]*v_strict_enforcement_enabled[\s\S]*classroom_creation_entitlement_unavailable/,
    )
    expect(migration).toContain("v_reason := 'unavailable'")
    expect(migration).toContain("v_reason := 'legacy'")
    expect(migration).toContain('Every account must have an explicit classrooms.create entitlement.')
  })

  it('keeps cutover controls and state inaccessible to browser roles', () => {
    expect(migration).toContain(
      'revoke all on table private.classroom_creation_entitlement_settings',
    )
    expect(migration).toContain(
      'grant execute on function public.activate_classroom_creation_entitlement_cutover_v1(uuid, text)',
    )
    expect(migration).toContain(
      'grant execute on function public.get_classroom_creation_entitlement_cutover_status_v1()',
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.activate_classroom_creation_entitlement_cutover_v1\([^;]+to authenticated/,
    )
  })
})
