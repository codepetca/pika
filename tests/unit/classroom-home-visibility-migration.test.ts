import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = () => readFileSync('supabase/migrations/292_classroom_home_visibility.sql', 'utf8')

describe('personal home visibility SQL source contracts (not database execution)', () => {
  it('stores only hidden current enrollment IDs in private RPC-only storage', () => {
    const migration = sql()
    expect(migration).toContain('create table private.classroom_home_hidden_enrollments')
    expect(migration).toContain('enrollment_id uuid primary key references public.classroom_enrollments(id) on delete cascade')
    expect(migration).toContain('alter table private.classroom_home_hidden_enrollments enable row level security')
    expect(migration).toContain('revoke all on table private.classroom_home_hidden_enrollments from public,anon,authenticated,service_role')
    expect(migration).not.toMatch(/create\s+policy|alter\s+table\s+public\.|update\s+public\.|delete\s+from\s+public\.|insert\s+into\s+public\./i)
  })

  it('makes both RPCs bounded service-only definers with locked search paths', () => {
    const migration = sql()
    expect(migration.match(/create function public\./g)).toHaveLength(2)
    expect(migration.match(/security definer/g)).toHaveLength(2)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(2)
    for (const name of ['read_classroom_home_visibility_v1(uuid)', 'set_classroom_home_visibility_v1(uuid,uuid,uuid,boolean)']) {
      expect(migration).toContain(`alter function public.${name} owner to postgres`)
      expect(migration).toContain(`revoke all on function public.${name} from public,anon,authenticated`)
      expect(migration).toContain(`grant execute on function public.${name} to service_role`)
    }
  })

  it('reads only complete hidden IDs for active current nonowner enrollments', () => {
    const read = sql().split('create function public.read_classroom_home_visibility_v1')[1].split('create function public.set_classroom_home_visibility_v1')[0]
    for (const token of ['join public.classroom_enrollments e on e.id=h.enrollment_id', 'e.student_id=p_actor_id', 'c.teacher_id<>p_actor_id', 'c.archived_at is null', 'cardinality(v_ids)>4096', "'actor_id',p_actor_id,'hidden_enrollment_ids',to_jsonb(v_ids)"]) {
      expect(read).toContain(token)
    }
    expect(read).not.toMatch(/\blimit\s+/i)
  })

  it('checks isolation then membership locks before proof rows and rejects stale enrollment before private effects', () => {
    const write = sql().split('create function public.set_classroom_home_visibility_v1')[1]
    const isolation = write.indexOf("current_setting('transaction_isolation')<>'read committed'")
    const lock = write.indexOf('perform private.try_lock_classroom_membership_change(p_classroom_id,p_actor_id)')
    const row = write.indexOf('for share nowait')
    const expected = write.indexOf('v_enrollment_id is distinct from p_expected_enrollment_id')
    const effect = write.indexOf('insert into private.classroom_home_hidden_enrollments')
    expect(isolation).toBeGreaterThan(-1)
    expect(isolation).toBeLessThan(lock)
    expect(lock).toBeLessThan(row)
    expect(row).toBeLessThan(expected)
    expect(expected).toBeLessThan(effect)
    for (const token of ['v_owner=p_actor_id', 'v_archived_at is not null', 'guard_classroom_purge_lifecycle', 'student_purge_fences', 'pika.identity_mapping', 'pika.student_purge_finalize', 'classroom_home_visibility_membership_changed', 'classroom_home_visibility_busy', 'classroom_home_visibility_unavailable']) {
      expect(write).toContain(token)
    }
    expect(write).not.toMatch(/set_effective_feature|role\s*=\s*'teacher'|pal_event|classroom_archive_revisions/)
  })

  it('provides a rollback database proof for isolation, ACLs, personal effects, stale requests and rejoin', () => {
    const proof = readFileSync('scripts/check-classroom-home-visibility-database.sql', 'utf8')
    for (const token of ['set local role service_role', 'has_table_privilege', 'has_function_privilege', 'classroom_home_visibility_forbidden', 'classroom_home_visibility_membership_changed', 'classroom_home_visibility_invalid_request', 'Visibility changed public graph', 'rejoin starts visible', 'repeatable read', 'classroom_home_visibility_unavailable']) {
      expect(proof).toContain(token)
    }
    expect(proof).toMatch(/rollback;\s*$/)
  })
})
