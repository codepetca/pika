import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(),
  'supabase/migrations/282_attendance_current_membership_foundation.sql'), 'utf8')
const body = (name: string) => {
  const start = sql.indexOf(`function ${name}(`)
  return start < 0 ? '' : sql.slice(start, sql.indexOf('\n$$;', start))
}

describe('dormant attendance membership foundation', () => {
  it('keeps identity associations private and override attribution attached to existing events', () => {
    expect(sql).toContain('create table private.attendance_participant_associations')
    expect(sql).toContain('create table private.attendance_override_event_generations')
    expect(sql).toContain('references public.attendance_status_override_events(id) on delete cascade')
    expect(sql).toContain('scope_digest is null and generation_id is null and closed')
    expect(sql).not.toMatch(/create table public\.|alter table public\.attendance_participant_mappings|grant\s/i)
    for (const table of ['attendance_participant_associations', 'attendance_override_event_generations']) {
      expect(sql).toContain(`alter table private.${table} enable row level security`)
      expect(sql).toContain(`revoke all on private.${table} from public,anon,authenticated,service_role`)
    }
  })

  it('captures only exact existing mappings and independently proven generation evidence', () => {
    const capture = body('private.capture_attendance_participant_association')
    expect(capture).toContain('private.try_lock_classroom_membership_change')
    expect(capture).toContain('public.attendance_participant_mappings')
    expect(capture).toContain('private.attendance_membership_generations')
    expect(capture).toContain('mapping.participant_ref=p_participant_ref')
    expect(capture).not.toMatch(/classroom_enrollments|created_at|updated_at/)
    expect(sql).not.toMatch(/create.*mint_attendance|deferrable initially deferred/i)
    expect(sql).not.toMatch(/^insert into private\.attendance_participant_associations/m)
  })

  it('resolves only bounded surviving public subjects and fails closed', () => {
    const resolve = body('private.resolve_attendance_participant_subject')
    expect(resolve).toContain('public.classroom_enrollments')
    expect(resolve).toContain('public.classroom_roster')
    expect(resolve).toContain('public.attendance_participant_mappings')
    expect(resolve).toContain('cardinality(v_subjects)<>1')
    expect(resolve).toContain('association.closed')
    expect(resolve).not.toContain('public.users')
  })

  it('checks exact uncovered references on pending reservation, retry and completion reads', () => {
    const coverage = body('private.assert_attendance_cleanup_reference_coverage')
    expect(coverage).toContain('private.attendance_participant_associations')
    expect(coverage).toContain('private.attendance_membership_generations')
    expect(coverage).toContain("operation.status='completed'")
    expect(coverage).toContain("binding.bara_receipt->>'participant_ref'=reference.participant_ref")
    expect(coverage).toContain("message='attendance_cleanup_reference_uncovered'")
    const read = body('public.get_student_provider_cleanup')
    expect(read).toContain("if v_op.status<>'completed' then")
    expect(read).toContain('private.assert_attendance_cleanup_reference_coverage')
  })

  it('preserves the effective cleanup read except for its pending coverage assertion', () => {
    const previous = readFileSync(join(process.cwd(),
      'supabase/migrations/175_explicit_live_student_cleanup.sql'), 'utf8')
    const start = previous.indexOf('function public.get_student_provider_cleanup(')
    const original = previous.slice(start, previous.indexOf('\n$$;', start))
    const current = body('public.get_student_provider_cleanup').replace(
      /  if v_op\.status<>'completed' then\n    perform private\.assert_attendance_cleanup_reference_coverage\(p_classroom_id,p_student_id,v_binding\.participant_ref\);\n  end if;\n/,
      '',
    )
    expect(current.replace(/\s+/g, ' ')).toBe(original.replace(/\s+/g, ' '))
  })

  it('scrubs only after actual authorized deletion and retains opaque closed tombstones', () => {
    const scrub = body('private.scrub_deleted_attendance_participant_associations')
    expect(sql).toContain('after delete on public.attendance_participant_mappings')
    expect(scrub).toContain("private.attendance_decommission_delete_allowed('attendance_participant_mappings',to_jsonb(old))")
    expect(scrub).toContain("private.removed_academic_delete_allowed('attendance_participant_mappings',to_jsonb(old))")
    expect(scrub).toContain('private.assert_attendance_cleanup_reference_coverage')
    expect(scrub).toContain('set scope_digest=null,generation_id=null,closed=true')
    expect(scrub).toContain("binding.bara_receipt->>'participant_ref'=old.participant_ref")
    expect(scrub).not.toMatch(/set_config|current_setting\('pika|pg_trigger_depth/)
    expect(sql).not.toMatch(/(?:update|delete from) private\.(?:pal_membership_generations|attendance_membership_generations)/i)
  })

  it('rejects retroactive override attribution and association reassignment', () => {
    expect(body('private.guard_attendance_override_event_generation')).toContain(
      "message='attendance_override_generation_writer_required'")
    expect(sql).toContain('before insert or update on private.attendance_override_event_generations')
    expect(body('private.guard_attendance_participant_association')).toContain(
      "message='attendance_participant_association_immutable'")
    expect(sql).toContain('before truncate on private.attendance_participant_associations')
    expect(sql).not.toMatch(/\bas\s+\$(?:\r?\n|\s*$)/im)
  })
})
