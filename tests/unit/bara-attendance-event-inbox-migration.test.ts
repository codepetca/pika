import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/126_bara_attendance_event_inbox.sql'),
  'utf8',
)

describe('Bara attendance event inbox migration', () => {
  it('creates private durable local-to-opaque mappings and a Toronto attendance policy', () => {
    expect(migration).toContain('create table public.attendance_roster_mappings')
    expect(migration).toContain('create table public.attendance_participant_mappings')
    expect(migration).toContain('create table public.attendance_principal_mappings')
    expect(migration).toContain('create table public.attendance_occurrence_mappings')
    expect(migration).toContain('last_reconciled_at timestamptz')
    expect(migration).toContain('create table public.attendance_window_policies')
    expect(migration).toContain("default ('roster_' || replace(gen_random_uuid()::text, '-', ''))")
    expect(migration).toContain("default ('participant_' || replace(gen_random_uuid()::text, '-', ''))")
    expect(migration).toContain("default ('principal_' || replace(gen_random_uuid()::text, '-', ''))")
    expect(migration).toContain("default ('occurrence_' || replace(gen_random_uuid()::text, '-', ''))")
    expect(migration).toContain("check (timezone = 'America/Toronto')")
    expect(migration).toContain('foreign key (student_id) references public.users (id) on delete cascade')
    expect(migration).not.toContain(
      'references public.classroom_enrollments (classroom_id, student_id)',
    )
    expect(migration).toContain('alter table public.attendance_roster_mappings enable row level security')
    expect(migration).toContain('alter table public.attendance_participant_mappings enable row level security')
    expect(migration).toContain('alter table public.attendance_occurrence_mappings enable row level security')
    expect(migration).toContain('alter table public.attendance_window_policies enable row level security')
    expect(migration).toContain('create function public.upsert_attendance_window_policy_v1(')
    expect(migration).toContain("message = 'attendance_policy_revision_conflict'")
    expect(migration).toContain("'timezone', v_policy.timezone")
    expect(migration).toContain("to_char(v_policy.opens_local, 'HH24:MI')")
    expect(migration).toContain('grant execute on function public.upsert_attendance_window_policy_v1(')
    expect(migration).toContain('create function public.list_attendance_sync_targets_v1(')
    expect(migration).toContain('create function public.list_attendance_reconciliation_targets_v1(')
    expect(migration).toContain('order by mapping.last_reconciled_at nulls first')
    expect(migration).toContain('order by roster.updated_at nulls first, classroom.id')
    expect(migration).toContain(
      'grant execute on function public.list_attendance_sync_targets_v1(integer)\n  to service_role',
    )
    expect(migration).toMatch(
      /grant execute on function public\.list_attendance_reconciliation_targets_v1\(\s*timestamptz, integer, integer\s*\) to service_role;/,
    )
  })

  it('creates private idempotent inbox and projection tables', () => {
    expect(migration).toContain('create table public.attendance_integration_inbox')
    expect(migration).toContain('unique (installation_ref, event_id)')
    expect(migration).toContain('unique (installation_ref, transport_nonce)')
    expect(migration).toContain('create table public.attendance_session_projection')
    expect(migration).toContain('create table public.attendance_record_projection')
    expect(migration).toContain('enable row level security')
    expect(migration).toContain(
      'revoke all on table public.attendance_integration_inbox\n  from public, anon, authenticated, service_role',
    )
  })

  it('creates a private leased Pika-to-Bara delivery outbox', () => {
    expect(migration).toContain('create table public.attendance_integration_outbox')
    expect(migration).toContain("status in ('pending', 'processing', 'delivered', 'non_retryable')")
    expect(migration).toContain("payload->>'message_type' = message_type")
    expect(migration).toContain("payload->>'idempotency_key' = idempotency_key")
    expect(migration).toContain('alter table public.attendance_integration_outbox enable row level security')
    expect(migration).toContain(
      'revoke all on table public.attendance_integration_outbox\n  from public, anon, authenticated, service_role',
    )
    expect(migration).toContain('create function public.enqueue_attendance_outbound_message_v1(')
    expect(migration).toContain("message = 'attendance_outbox_idempotency_conflict'")
    expect(migration).toContain('create function public.claim_attendance_outbound_message_v1(')
    expect(migration).toContain('create function public.claim_attendance_outbox_batch_v1(')
    expect(migration).toContain('create function public.attendance_outbox_dependencies_ready_v1(')
    expect(migration).toContain("dependency.message_type in ('roster.snapshot', 'schedule.snapshot')")
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('create function public.complete_attendance_outbox_v1(')
    expect(migration).toContain('create function public.retry_attendance_outbox_v1(')
    expect(migration).toContain('create function public.fail_attendance_outbox_v1(')
    expect(migration).toContain('create function public.attendance_outbox_health_v1()')
    expect(migration).toContain("count(*) filter (where status = 'non_retryable')")
    expect(migration).toContain("'oldest_unresolved_at'")
    expect(migration).toContain(
      'grant execute on function public.enqueue_attendance_outbound_message_v1(uuid, jsonb)\n  to service_role',
    )
    expect(migration).toContain(
      'grant execute on function public.attendance_outbox_health_v1()\n  to service_role',
    )
  })

  it('prepares opaque mappings and atomically stages source-token revisions', () => {
    expect(migration).toContain('source_token text')
    expect(migration).toContain('schedule_source_token text')
    expect(migration).toContain('create function public.attendance_roster_source_document_v1(')
    expect(migration).toContain('create function public.attendance_schedule_source_document_v1(')
    expect(migration).toContain('create function public.prepare_attendance_snapshot_v1(')
    expect(migration).toContain("message = 'attendance_roster_source_changed'")
    expect(migration).toContain("message = 'attendance_schedule_source_changed'")
    expect(migration).toContain('create function public.stage_attendance_roster_snapshot_v1(')
    expect(migration).toContain('create function public.stage_attendance_schedule_snapshot_v1(')
    expect(migration).toContain(
      'select * into v_outbox from public.enqueue_attendance_outbound_message_v1(',
    )
    expect(migration).toContain('schedule_synced_revision = greatest(')
    expect(migration).toContain(
      'grant execute on function public.prepare_attendance_snapshot_v1(uuid, uuid, date, date)\n  to service_role',
    )
  })

  it('applies inbox receipt and monotonic projection updates in one function', () => {
    expect(migration).toContain('create function public.apply_attendance_event_v1')
    expect(migration).toContain("message = 'attendance_event_mapping_mismatch'")
    expect(migration).toContain("message = 'attendance_event_participant_mismatch'")
    expect(migration).toContain('on conflict (installation_ref, occurrence_ref) do update')
    expect(migration).toContain(
      'classroom_id uuid not null references public.classrooms (id) on delete cascade',
    )
    expect(migration).toContain(
      'student_id uuid not null references public.users (id) on delete cascade',
    )
    expect(migration).toContain(
      'where excluded.session_revision > public.attendance_session_projection.session_revision',
    )
    expect(migration).toContain(
      'where excluded.record_revision > public.attendance_record_projection.record_revision',
    )
    expect(migration).toContain(
      'grant execute on function public.apply_attendance_event_v1(jsonb, text)\n  to service_role',
    )
  })

  it('blocks destructive classroom operations until attendance is decommissioned', () => {
    expect(migration).toContain('create function public.attendance_classroom_has_state_v1(')
    expect(migration).toContain('create trigger reject_attendance_classroom_delete_v1')
    expect(migration).toContain('create trigger reject_attendance_archive_compaction_v1')
    expect(migration).toContain('create trigger reject_attendance_classroom_purge_v1')
    expect(migration).toContain("message = 'attendance_classroom_decommission_required'")
    expect(migration).not.toContain(
      'grant select, insert, update, delete on table public.attendance_roster_mappings',
    )
  })

  it('defensively validates event revisions, timestamps, and optional reason codes', () => {
    expect(migration).toContain(
      "jsonb_typeof(p_event->'metadata'->'record_revision') = 'number'",
    )
    expect(migration).toContain(
      "p_event->'metadata'->>'record_revision' ~ '^[1-9][0-9]*$'",
    )
    expect(migration).toContain(
      "p_event->'metadata'->>'opened_at' ~ '^\\d{4}-\\d{2}-\\d{2}T",
    )
    expect(migration).toContain(
      "p_event->'metadata'->>'reason_code' ~ '^[A-Za-z0-9._~-]{1,128}$'",
    )
  })

  it('provides a service-role-only monotonic reconciliation snapshot path', () => {
    expect(migration).toContain('create function public.attendance_session_snapshot_v1_valid')
    expect(migration).toContain('create function public.apply_attendance_session_snapshot_v1')
    expect(migration).toContain("message = 'attendance_snapshot_mapping_mismatch'")
    expect(migration).toContain("message = 'attendance_snapshot_participant_mismatch'")
    expect(migration).toContain(
      "occurrence.opens_at = (p_snapshot->>'opens_at')::timestamptz",
    )
    expect(migration).toContain('set last_reconciled_at = clock_timestamp()')
    expect(migration).toContain(
      'where excluded.session_revision > public.attendance_session_projection.session_revision',
    )
    expect(migration).toContain(
      'where excluded.record_revision > public.attendance_record_projection.record_revision',
    )
    expect(migration).toContain(
      'grant execute on function public.apply_attendance_session_snapshot_v1(text, jsonb)\n  to service_role',
    )
    expect(migration).toContain(
      "'reconcile:' || (p_snapshot->>'occurrence_ref') || ':' ||",
    )
    expect(migration).toContain(
      "(v_record->>'participant_ref') || ':' || (v_record->>'record_revision')",
    )
  })
})
