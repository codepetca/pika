import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/203_metered_assignment_ai_grading.sql'),
  'utf8',
)

describe('metered Assignment AI grading migration', () => {
  it('creates only a version-1 run and reserves one unit per queued item', () => {
    expect(migration).toContain('create_metered_assignment_ai_grading_run_v1')
    expect(migration).toContain('worker_contract_version = 1')
    expect(migration).toContain("item.status = 'queued'")
    expect(migration).toContain("'assignment_ai_grading'")
    expect(migration).toContain("'grading.ai'")
    expect(migration).toContain('p_units => 1')
    expect(migration).toContain('metered_assignment_item_counts_invalid')
    expect(migration).toContain('assignment.blueprint_archived_at')
  })

  it('binds provider admission, settlement, and terminal release to the current lease', () => {
    expect(migration).toContain('reserve_assignment_ai_grading_item_usage_with_lease_v1')
    expect(migration).toContain(
      'finalize_assignment_ai_grading_item_and_settle_usage_v1',
    )
    expect(migration).toContain(
      'fail_assignment_ai_grading_item_and_release_usage_with_lease_v1',
    )
    expect(migration).toContain(
      'finalize_skipped_assignment_ai_grading_item_and_release_v1',
    )
    expect(migration).toContain(
      'fail_assignment_ai_grading_run_and_release_usage_with_lease_v1',
    )
    expect(migration).toContain('run.lease_token is distinct from p_lease_token')
    expect(migration).toContain('run.lease_expires_at <= clock_timestamp()')
    expect(migration).toContain('settle_feature_usage_v1')
    expect(migration).toContain('release_feature_usage_v1')
    expect(migration).toContain('metered_assignment_settlement_state_invalid')
  })

  it('hardens accounting time and prevents entitlement revisions from resetting usage', () => {
    expect(migration).toContain('v_now := clock_timestamp()')
    expect(migration).toContain("reservation.status in ('reserved', 'settled')")
    expect(migration).not.toContain(
      'reservation.entitlement_revision = v_entitlement.revision\n    and reservation.status',
    )
  })

  it('keeps every public contract service-only with fixed search paths', () => {
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain('to service_role')
    expect(migration).toContain('private.lock_metered_assignment_ai_grading_item_v1')
  })
})
