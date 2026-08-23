import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/132_attendance_teacher_entitlements.sql'),
  'utf8',
)

describe('Bara attendance teacher entitlement migration', () => {
  it('keeps entitlement and audit state service-only and operation-idempotent', () => {
    expect(migration).toContain('create table public.attendance_teacher_entitlements')
    expect(migration).toContain('create table public.attendance_teacher_entitlement_audit')
    expect(migration).toContain('operation_id uuid not null unique')
    expect(migration).toContain('attendance_entitlement_operation_conflict')
    expect(migration).toContain('attendance_entitlement_revision_conflict')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).not.toContain('grant insert on table public.attendance_teacher_entitlement_audit')
    expect(migration).not.toContain('teacher_id uuid not null references public.users (id) on delete cascade')
  })

  it('uses one database entitlement predicate across admission, staging, and claims', () => {
    for (const functionName of [
      'attendance_teacher_entitled_v1',
      'get_attendance_classroom_access_v1',
      'get_attendance_entitlement_transition_health_v1',
      'list_attendance_sync_targets_v3',
      'prepare_attendance_snapshot_v2',
      'stage_attendance_roster_snapshot_v2',
      'stage_attendance_schedule_snapshot_v2',
      'upsert_attendance_window_policy_v2',
      'attendance_outbox_claim_allowed_v1',
      'enqueue_attendance_outbound_message_v2',
      'claim_attendance_outbound_message_v2',
      'claim_attendance_outbox_batch_v3',
    ]) expect(migration).toContain(`function public.${functionName}`)
    expect(migration.match(/attendance_teacher_entitled_v1\(/g)?.length).toBeGreaterThanOrEqual(7)
  })

  it('makes revocation stateful, bounded, and cleanup-compatible', () => {
    expect(migration).toContain("integration_state in ('active', 'deactivating', 'inactive')")
    expect(migration).toContain("status in ('pending', 'processing', 'delivered', 'non_retryable', 'superseded')")
    expect(migration).toContain("set status = 'superseded'")
    expect(migration).toContain('remote_schedule_window_end')
    expect(migration).toContain('create or replace function public.complete_attendance_outbox_v1(')
    expect(migration).toContain("when integration_state = 'active'")
    expect(migration).toContain('deactivation_target_end')
    expect(migration).toContain('deactivation_window_end + 401')
    expect(migration).toContain('v_window_start <> v_roster.deactivation_window_start')
    expect(migration).toContain('p_row.entitlement_revision')
    expect(migration).toContain("if v_row.status = 'superseded' then")
    expect(migration).toContain("outbox.entitlement_revision is null")
    expect(migration).toContain('attendance_outbox_entitlement_revision_insert')
    expect(migration).toContain('hashtextextended(v_teacher_id::text, 13220260823)')
    expect(migration).toMatch(
      /function public\.get_attendance_entitlement_transition_health_v1[\s\S]*?language plpgsql\s+volatile/,
    )
    expect(migration).toContain('hashtextextended(v_actual_teacher_id::text, 13220260823)')
    expect(migration).toContain('v_stale_epoch_unresolved_count')
    expect(migration).toContain("set integration_state = 'inactive'")
    expect(migration).toContain('list_attendance_reconciliation_targets_v3')
    expect(migration).toContain('apply_attendance_event_for_entitled_mapping_v1')
    expect(migration).toContain('apply_attendance_session_snapshot_for_entitled_mapping_v1')
  })

  it('never exposes Pika authorization concepts to the cross-service payload', () => {
    expect(migration).not.toMatch(/p_message->>'(?:teacher_id|plan|billing|email|workos)/)
  })
})
