import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/157_atomic_contextual_classroom_enrollment.sql'
)

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8').toLowerCase()
}

function readPublicJoinFunction(): string {
  const sql = readMigration()
  const start = sql.indexOf('create function public.join_classroom_by_code_atomic_v1(')
  const end = sql.indexOf('\n$$;', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + 4)
}

describe('atomic contextual classroom enrollment migration', () => {
  it('keeps invitation-guess state private and schema-backed', () => {
    const sql = readMigration()

    expect(sql).toContain('create table public.classroom_join_rate_limits')
    expect(sql).toContain('alter table public.classroom_join_rate_limits enable row level security')
    expect(sql).toContain(
      'revoke all on table public.classroom_join_rate_limits from public, anon, authenticated, service_role'
    )
    expect(sql).toContain('create function private.consume_classroom_join_rate_limits_v1')
    expect(sql).toContain("p_actor_key_hash !~ '^[0-9a-f]{64}$'")
    expect(sql).toContain("p_invitation_key_hash !~ '^[0-9a-f]{64}$'")
    expect(sql).toContain("v_actor_max_attempts constant integer := 12")
    expect(sql).toContain("v_invitation_max_attempts constant integer := 3")
    expect(sql).toContain('create index classroom_join_rate_limits_updated_at_idx')
    expect(sql).toContain('create function public.cleanup_classroom_join_rate_limits_v1')
    expect(sql).toContain('for update skip locked')
    expect(sql).not.toContain('jsonb_object_length')
    expect(sql.indexOf("values ('actor', p_actor_key_hash, v_now)")).toBeLessThan(
      sql.indexOf("values ('invitation', p_invitation_key_hash, v_now)")
    )
  })

  it('exposes only a fixed-search-path service-role transaction', () => {
    const sql = readMigration()
    const publicFunction = readPublicJoinFunction()
    const signature =
      'public.join_classroom_by_code_atomic_v1(uuid, uuid, text, text, text, text, text, text, jsonb)'

    expect(sql).toContain('create function public.join_classroom_by_code_atomic_v1')
    expect(publicFunction).toContain('security definer')
    expect(publicFunction).toContain("set search_path = ''")
    expect(sql.replace(/\s+/g, ' ')).toContain(
      `revoke all on function ${signature} from public, anon, authenticated, service_role`
    )
    expect(sql.replace(/\s+/g, ' ')).toContain(`grant execute on function ${signature} to service_role`)
  })

  it('limits guesses before resolving the actor or classroom', () => {
    const sql = readPublicJoinFunction()
    const limiter = sql.indexOf('v_rate_limit := private.consume_classroom_join_rate_limits_v1(')
    const actorLookup = sql.indexOf('from public.users actor')
    const classroomLookup = sql.indexOf('from public.classrooms classroom')

    expect(limiter).toBeGreaterThan(-1)
    expect(actorLookup).toBeGreaterThan(limiter)
    expect(classroomLookup).toBeGreaterThan(actorLookup)
    expect(sql).toContain('classroom.id = p_expected_classroom_id')
    expect(sql).toContain('upper(btrim(classroom.class_code)) = v_normalized_code')
    expect(sql).toContain('for update')
  })

  it('revalidates contextual authorization and writes every join effect atomically', () => {
    const sql = readMigration()

    expect(sql).toContain('classroom.teacher_id = p_actor_id')
    expect(sql).toContain('classroom.archived_at is not null')
    expect(sql).toContain('not v_classroom.allow_enrollment')
    expect(sql).toContain("classroom.join_policy = 'roster'")
    expect(sql).toContain('insert into public.classroom_roster (')
    expect(sql).toContain('insert into public.classroom_enrollments (classroom_id, student_id)')
    expect(sql).toContain('insert into public.classroom_roster_student_bindings (')
    expect(sql).toContain('insert into public.student_profiles (')
    expect(sql).toContain('private.enqueue_pal_event(')
    expect(sql).toContain("v_outbox.source_kind is distinct from 'classroom_enrollment'")
    expect(sql).toContain("v_outbox.payload->>'idempotency_key' is distinct from p_pal_event->>'idempotency_key'")
    expect(sql).toContain("v_outbox.payload->>'learner_id' is distinct from p_pal_event->>'learner_id'")
    expect(sql).toContain('exception when others')
    expect(sql).toContain("'error_code', 'join_failed'")
    expect(sql).toContain('on conflict (user_id) do nothing')
  })

  it('returns a least-data projection without invitation or owner details', () => {
    const sql = readMigration()

    expect(sql).toContain("'classroom', jsonb_build_object(")
    expect(sql).toContain("'id', v_classroom.id")
    expect(sql).toContain("'title', v_classroom.title")
    expect(sql).toContain("'term_label', v_classroom.term_label")
    expect(sql).not.toContain("'class_code',")
    expect(sql).not.toContain("'teacher_id',")
  })
})
