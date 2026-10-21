import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/285_attendance_membership_adoption.sql'), 'utf8')
const body = (name: string) => {
  const start = sql.indexOf(`function ${name}(`)
  return start < 0 ? '' : sql.slice(start, sql.indexOf('\n$$;', start))
}

describe('attendance membership adoption security contract', () => {
  it('keeps allocation private and exact transaction capability inaccessible', () => {
    expect(sql).toContain('alter table private.attendance_pointer_mutations enable row level security')
    expect(sql).toContain('revoke all on private.attendance_pointer_mutations from public,anon,authenticated,service_role')
    expect(sql).not.toMatch(/set_config|disable trigger|drop trigger|create table public\./i)
    const allocate = body('private.allocate_attendance_membership_participant')
    expect(allocate).toContain('enrollment.id=p_generation_id')
    expect(allocate).toContain('private.capture_attendance_participant_association')
    expect(allocate).toContain('insert into private.attendance_membership_generations')
    expect(allocate).not.toMatch(/eligible_after|student_provider_cleanup_settings|created_at\s*[<>]/)
  })

  it('preserves explicit scope routing and legacy RPC signatures', () => {
    const scope = body('private.authorize_attendance_membership_owner')
    expect(scope).toContain("p_scope_mode not in ('exact_canary','teacher_entitlements')")
    expect(scope).toContain('p_canary_actor_id is distinct from p_teacher_id')
    expect(scope).toContain('p_canary_classroom_id is distinct from p_classroom_id')
    expect(scope).not.toMatch(/role\s*=\s*'teacher'/)
    expect(body('public.prepare_attendance_membership_snapshot_v1')).toContain('public.prepare_attendance_snapshot_v2')
    expect(body('public.prepare_attendance_membership_snapshot_v1')).toContain('public.prepare_attendance_snapshot_v1')
    expect(body('public.stage_attendance_membership_roster_snapshot_v1')).toContain('public.stage_attendance_roster_snapshot_v2')
    expect(sql).not.toMatch(/alter function public\.(?:prepare_attendance_snapshot|stage_attendance_roster_snapshot)_v[12]/)
  })

  it('uses independent exact evidence without upgrading unknown associations', () => {
    const resolve = body('private.attendance_membership_pointer_valid')
    expect(resolve).toContain('attendance.generation_id=enrollment.id')
    expect(resolve).toContain('attendance.participant_ref=mapping.participant_ref')
    expect(resolve).toContain('association.generation_id is null')
    expect(sql).not.toMatch(/update private\.attendance_participant_associations\s+set[^;]*generation_id/i)
  })

  it('checks retained closed refs before event replay and keeps deletion capabilities', () => {
    const closed = body('private.attendance_participant_generation_closed')
    expect(closed).toContain('private.attendance_participant_associations')
    expect(closed).toContain('association.closed')
    expect(body('private.attendance_payload_generation_closed')).not.toContain('coalesce(mapping.classroom_id,operation.classroom_id)')
    const event = body('public.apply_attendance_event_v1')
    expect(event.indexOf('private.attendance_payload_generation_closed')).toBeLessThan(event.indexOf('insert into public.attendance_integration_inbox'))
    expect(event).toContain('private.resolve_attendance_delivery_subject')
    expect(body('public.apply_attendance_session_snapshot_v1')).toContain('private.resolve_attendance_delivery_subject')
    const guard = body('private.guard_attendance_closed_subject')
    expect(guard).toContain('private.attendance_decommission_delete_allowed')
    expect(guard).toContain('private.removed_academic_delete_allowed')
    expect(guard).toContain('private.attendance_pointer_mutation_allowed')
    expect(sql).not.toMatch(/(?:create or replace|alter) function (?:private\.(?:complete_live_student_cleanup|reserve_live_student_cleanup)|public\.get_student_provider_cleanup)/i)
  })
})
