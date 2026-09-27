import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/213_contextual_assignment_inline_images.sql',
  'utf8',
)

function functionBody(name: string): string {
  return migration().split(`function public.${name}(`)[1]?.split('$function$;')[0] ?? ''
}

describe('contextual Assignment inline-image migration', () => {
  it('keeps the three service-only boundaries and private lock helper unreachable', () => {
    const sql = migration()
    for (const name of [
      'reserve_assignment_inline_image_for_member_v1',
      'finalize_assignment_inline_image_for_member_v1',
      'read_assignment_inline_image_for_context_v1',
    ]) {
      expect(sql).toContain(`function public.${name}(`)
    }
    expect(sql).toContain('revoke all on function private.lock_assignment_inline_image_member_context_v1')
    expect(sql).toMatch(/revoke all on function public\.reserve_assignment_inline_image_for_member_v1[\s\S]+from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.reserve_assignment_inline_image_for_member_v1[\s\S]+read_assignment_inline_image_for_context_v1[\s\S]+to service_role/)
    expect(sql.match(/security definer/g)).toHaveLength(3)
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4)
  })

  it('holds the resource authorization fences around reservation and finalization', () => {
    const sql = migration()
    const helper = sql.split('function private.lock_assignment_inline_image_member_context_v1(')[1]?.split('$function$;')[0] ?? ''
    const reserve = functionBody('reserve_assignment_inline_image_for_member_v1')
    const finalize = functionBody('finalize_assignment_inline_image_for_member_v1')

    expect(helper.indexOf("'assignment_submission:'")).toBeLessThan(helper.indexOf("'pika-classroom-operation:'"))
    expect(helper).toContain('private.try_lock_classroom_membership_change')
    expect(helper).toContain('for update of classroom, assignment')
    expect(helper).toContain('v_teacher_id = p_actor_id')
    expect(helper).toContain('v_doc.is_submitted')
    expect(reserve).toContain('private.lock_assignment_inline_image_member_context_v1')
    expect(reserve).toContain('public.begin_managed_storage_upload')
    expect(reserve.indexOf('public.lock_managed_storage_protocol()'))
      .toBeLessThan(reserve.indexOf('private.lock_assignment_inline_image_member_context_v1'))
    expect(finalize).toContain('private.lock_assignment_inline_image_member_context_v1')
    expect(finalize).toContain('public.verify_managed_storage_upload')
    expect(finalize.indexOf('public.lock_managed_storage_protocol()'))
      .toBeLessThan(finalize.indexOf('private.lock_assignment_inline_image_member_context_v1'))
    expect(finalize.indexOf('private.lock_assignment_inline_image_member_context_v1'))
      .toBeLessThan(finalize.indexOf('public.verify_managed_storage_upload'))
  })

  it('binds object, document, subject, Classroom, owner precedence, and read lifecycle', () => {
    const read = functionBody('read_assignment_inline_image_for_context_v1')
    const reserve = functionBody('reserve_assignment_inline_image_for_member_v1')
    expect(read).toContain('v_is_owner := v_teacher_id = p_actor_id')
    expect(read).toContain('v_current_assignment_id is distinct from v_initial_assignment_id')
    expect(read).toContain('v_archived_at is not null')
    expect(read).toContain('v_object.resource_id is distinct from p_assignment_doc_id')
    expect(read).toContain('v_object.created_by_user_id is distinct from v_subject_id')
    expect(read).toContain("v_object.status <> 'ready'")
    expect(read).toContain("v_object.status not in ('verified', 'ready')")
    expect(reserve).toContain("'submission-images'")
    expect(reserve).toContain("'student_inline_image'")
    expect(reserve).toContain("'assignment_doc'")
    expect(reserve).toContain('p_expected_classroom_id')
  })

  it('keeps a rollback-only database harness for mixed-role and lifecycle regressions', () => {
    const harness = readFileSync('scripts/check-contextual-assignment-inline-images-database.sh', 'utf8')
    for (const phrase of [
      'Migration 213 is required; this harness never applies it',
      'Teacher-valued member reservation returned invalid evidence',
      'Student-valued owner could not inspect ready image',
      'Owner self-enrollment bypassed write precedence',
      'Owner read image with substituted creator',
      'Teacher-valued member read cross-subject image',
      'Owner could not read ready image in archived Classroom',
      'Owner read revoked subject image',
      'Submitted member image became unreadable',
      'Submitted document accepted a reservation',
      'Revoked member reserved an inline image',
      'rollback;',
    ]) expect(harness).toContain(phrase)
    expect(harness).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
  })

  it('wires bounded multi-connection race checks through the database harness', () => {
    const harness = readFileSync('scripts/check-contextual-assignment-inline-images-database.sh', 'utf8')
    const raceHarness = readFileSync('scripts/check-contextual-assignment-inline-images-race.sh', 'utf8')

    expect(harness).toContain('check-contextual-assignment-inline-images-race.sh')
    for (const phrase of [
      'supabase_db_pika',
      'pg_blocking_pids(waiter.pid)',
      'remove_classroom_students_preserving_data',
      'submit_assignment_doc_for_member_v1',
      'reserve_assignment_inline_image_for_member_v1',
      'finalize_assignment_inline_image_for_member_v1',
      'Reservation crossed committed membership removal',
      'Membership removal crossed in-flight reservation',
      'Submission/finalization race allowed a forbidden storage transition',
      'Finalization/submission race did not serialize to its valid terminal state',
      'Race fixture cleanup changed baseline counts',
    ]) expect(raceHarness).toContain(phrase)
    expect(raceHarness).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
  })
})
