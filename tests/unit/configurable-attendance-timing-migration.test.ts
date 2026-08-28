import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/138_configurable_attendance_timing.sql'),
  'utf8',
)

describe('configurable attendance timing migration', () => {
  it('stores the four defaults and a concrete immutable occurrence snapshot', () => {
    expect(migration).toContain('entry_opens_minutes_before integer not null default 10')
    expect(migration).toContain('present_grace_minutes integer not null default 5')
    expect(migration).toContain('entry_closes_minutes_before_end integer not null default 10')
    expect(migration).toContain('absent_minutes_before_end integer not null default 0')
    for (const column of [
      'session_starts_at', 'session_ends_at', 'present_through_at',
      'absent_at', 'policy_revision', 'policy_frozen_at',
    ]) expect(migration).toContain(`add column ${column}`)
    expect(migration).toContain('present_through_at < closes_at')
    expect(migration).toContain('least(10, durations.duration_minutes - 1)')
    expect(migration).toContain("greatest(\n      opens_at,\n      least(opens_at + interval '10 minutes'")
  })

  it('replaces provider statuses with immutable check-in facts and Pika overrides', () => {
    expect(migration).toContain('create table public.attendance_check_in_facts')
    expect(migration).toContain('create table public.attendance_status_overrides')
    expect(migration).toContain('create table public.attendance_status_override_events')
    expect(migration).toContain("action text not null check (action in ('set', 'undo'))")
    expect(migration).toContain("message_type in (\n      'roster.snapshot', 'schedule.snapshot', 'session.command', 'check_in.invalidate'")
    expect(migration).not.toContain("when 'attendance.record.changed'")
    expect(migration).toContain("message = 'attendance_check_in_identity_conflict'")
    expect(migration).toContain("message = 'attendance_check_in_transition_invalid'")
    expect(migration).toContain('grant select on table public.attendance_check_in_facts to service_role')
    expect(migration).not.toContain(
      'grant select, insert, update on table public.attendance_check_in_facts to service_role',
    )
  })

  it('freezes opened occurrences and refuses schedule drift', () => {
    expect(migration).toContain('create function public.stage_attendance_timing_schedule_v1')
    expect(migration).toContain('mapping.opens_at <= p_at')
    expect(migration.indexOf('mapping.opens_at <= p_at')).toBeLessThan(
      migration.indexOf("message = 'attendance_schedule_message_mismatch'"),
    )
    expect(migration).toContain('and policy_frozen_at is null')
    expect(migration).toContain("message = 'attendance_occurrence_policy_frozen'")
    expect(migration).toContain("'attendance.check_in.accepted', 'attendance.check_in.invalidated'")
  })

  it('keeps status override idempotency and audit inside Pika', () => {
    expect(migration).toContain('create function public.apply_attendance_status_overrides_v1')
    expect(migration).toContain("mark.status not in ('automatic', 'present', 'late', 'absent')")
    expect(migration).toContain("case when v_mark.status = 'automatic' then 'undo' else 'set' end")
    expect(migration).toContain("v_mark.status = 'automatic' and v_override.id is null")
    expect(migration).toContain('unique (request_id, student_id)')
  })

  it('fails closed if the pre-release no-legacy-data assumption is false', () => {
    expect(migration).toContain("where source = 'student_qr'")
    expect(migration).toContain(
      "message = 'attendance_timing_cutover_requires_empty_legacy_qr_projection'",
    )
  })

  it('retains legacy attendance projections in classroom and student deletion guards', () => {
    expect(migration.match(/attendance_record_projection/g)).toHaveLength(3)
    expect(migration).toContain(
      'attendance_record_projection where classroom_id = p_classroom_id',
    )
    expect(migration).toContain(
      'where classroom_id = p_classroom_id and student_id = p_student_id',
    )
  })
})
