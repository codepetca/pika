import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const path = resolve(process.cwd(), 'supabase/migrations/254_contextual_test_owner_reorder.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
const code = source.replace(/--[^\n]*/g, '')

// Inert source contracts only. Native replay, trigger closure, concurrent locks,
// byte-limit execution and whole-project preservation require separate DB proof.
describe('contextual current-owner Test reorder SQL source contract', () => {
  it('adds exactly one PostgreSQL-owned service-only four-argument RPC', () => {
    expect(code.trim()).toMatch(/^begin;/)
    expect(code.trim()).toMatch(/commit;$/)
    expect(code.match(/create function /g)).toHaveLength(1)
    expect(code).toMatch(/create function public\.reorder_tests_for_owner_v1\(\s*p_actor_id uuid, p_classroom_id uuid, p_test_ids uuid\[\], p_deadline timestamptz\s*\)/)
    expect(code).toMatch(/security definer\s+set search_path = ''\s+set lock_timeout = '1s'/)
    expect(code).toContain('alter function public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz) owner to postgres')
    expect(code).toMatch(/revoke all on function public\.reorder_tests_for_owner_v1\(uuid,uuid,uuid\[\],timestamptz\)\s+from public, anon, authenticated/)
    expect(code).toMatch(/grant execute on function public\.reorder_tests_for_owner_v1\(uuid,uuid,uuid\[\],timestamptz\)\s+to service_role/)
    expect(code).not.toMatch(/grant .* to (?:anon|authenticated|public)\b/)
  })

  it('rejects malformed arrays and nonfinite or remote deadlines before locking', () => {
    expect(code).toContain('p_test_ids is null')
    expect(code).toContain('pg_catalog.cardinality(p_test_ids) > 1000')
    expect(code).toContain('pg_catalog.array_ndims(p_test_ids) is distinct from 1')
    expect(code).toContain('pg_catalog.array_lower(p_test_ids, 1) is distinct from 1')
    expect(code).toContain('requested.id is null')
    expect(code).toContain('count(distinct requested.id)')
    expect(code).toContain('not pg_catalog.isfinite(p_deadline)')
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '20 seconds'")
    expect(code).toContain("least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds')")
    expect(code).toContain("pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed'")
    expect(code.match(/pg_catalog\.clock_timestamp\(\) >= v_phase_deadline/g)?.length).toBeGreaterThanOrEqual(5)
    expect(code.indexOf('test_reorder_invalid_input')).toBeLessThan(code.indexOf('for share nowait'))
  })

  it('takes finite locks in the fixed settings/Class/membership/archive/actor/Test order', () => {
    const markers = [
      'from public.managed_storage_settings settings',
      'public.classroom_purge_try_lock(p_classroom_id)',
      'private.try_lock_classroom_membership_change(p_classroom_id)',
      'from public.classrooms classroom',
      'from public.classroom_archive_revisions revision',
      'from public.users actor',
      'order by test.id for update nowait',
    ].map(marker => code.indexOf(marker))
    markers.forEach((value, index) => {
      expect(value).toBeGreaterThan(-1)
      if (index > 0) expect(value).toBeGreaterThan(markers[index - 1])
    })
    expect(code).toContain('where settings.singleton for share nowait')
    expect(code).toContain('where actor.id = p_actor_id for key share nowait')
    expect(code).not.toMatch(/\b(?:nextval|setval|managed_storage_begin_write)\s*\(/)
  })

  it('authorizes the current active owner and fences publication252 lifecycle contexts', () => {
    expect(code).toContain('v_classroom_before.teacher_id is distinct from p_actor_id')
    expect(code).toContain('v_classroom_before.archived_at is not null')
    expect(code).toContain("message = 'test_reorder_classroom_not_found'")
    expect(code).not.toMatch(/actor\.role|teacher_entitlements|billing_|subscription/)
    for (const mode of ['restore', 'compaction']) {
      expect(code).toContain(`public.is_classroom_archive_maintenance_mode('${mode}')`)
    }
    for (const setting of ['pika.identity_mapping', 'pika.classroom_purge_finalize', 'pika.course_blueprint_purge_finalize', 'pika.student_purge_finalize']) {
      expect(code).toContain(`'${setting}'`)
    }
    expect(code.match(/perform public\.guard_classroom_purge_lifecycle\(p_classroom_id\)/g)).toHaveLength(2)
    expect(code.match(/private\.student_provider_cleanup_bindings/g)).toHaveLength(2)
  })

  it('requires complete membership including retired and started Tests before DML', () => {
    expect(code).toContain('limit 1001')
    expect(code).toContain('v_count > 1000')
    expect(code).toContain('v_current_ids is distinct from v_requested_ids')
    expect(code.indexOf('v_current_ids is distinct from v_requested_ids')).toBeLessThan(code.indexOf('update public.tests test'))
    expect(code).not.toMatch(/where[^;]*blueprint_archived_at\s+is\s+null/)
    expect(code).not.toMatch(/v_test\w*\.(?:status|questions_locked_at|blueprint_archived_at)/)
    expect(code).not.toMatch(/from public\.(?:test_attempts|test_responses|assessment_drafts|test_questions)/)
  })

  it('bounds complete rows, cumulative pre/post state and revisions before mutation', () => {
    expect(code).toContain("'public.tests'::pg_catalog.regclass")
    expect(code).toContain("'gradebook_maximum_override'")
    expect(code).toContain('v_row_bytes > 2097152')
    expect(code).toContain('v_state_bytes > 67108864')
    expect(code).toContain('v_state_bytes + v_post_state_bytes > 67108864')
    expect(code).toContain('9223372036854775807 - v_changed_count')
    expect(code).toContain('9223372036854775807 - 2 * v_changed_count')
    expect(code.indexOf('test_reorder_revision_limit')).toBeLessThan(code.indexOf('update public.tests test'))
    expect(code.indexOf('v_tests_expected :=')).toBeLessThan(code.indexOf('update public.tests test'))
  })

  it('measures only scalar full-row byte counts once for each SUM/MAX pair', () => {
    const measurements = [...code.matchAll(/with measured as materialized \(([\s\S]*?)\)\s*select coalesce\(sum\(measured\.row_bytes\),0\),\s*coalesce\(max\(measured\.row_bytes\),0\)/g)]
    expect(measurements).toHaveLength(3)
    for (const [, measurement] of measurements) {
      expect(measurement.trim()).toMatch(/^select pg_catalog\.octet_length\(/)
      expect(measurement).toContain('as row_bytes')
      expect(measurement).toContain('where test.classroom_id = p_classroom_id')
      expect(measurement).not.toMatch(/jsonb_agg|select test\.\*|as row\b/)
    }
    expect(code).not.toMatch(/(?:sum|max)\(pg_catalog\.octet_length/)
    expect(code.match(/into v_test_bytes,v_row_bytes from measured/g)).toHaveLength(2)
    expect(code).toContain('into v_expected_bytes,v_row_bytes from measured')
  })

  it('keeps byte guards ahead of complete aggregates and preserves expected-row semantics', () => {
    const expected = code.slice(code.indexOf('with measured as materialized', code.indexOf('v_classroom_expected :=')), code.indexOf('v_tests_expected :='))
    expect(expected).toContain('case when test.position is distinct from desired.position then')
    expect(expected).toContain("'position',desired.position,'updated_at',pg_catalog.transaction_timestamp()")
    expect(expected).toContain('else pg_catalog.to_jsonb(test) end')
    expect(expected).toContain('v_row_bytes > 2097152')
    expect(expected).toContain('v_state_bytes + v_post_state_bytes > 67108864')
    const afterUpdate = code.slice(code.indexOf('get diagnostics v_affected_count'))
    expect(afterUpdate.indexOf('with measured as materialized')).toBeGreaterThan(afterUpdate.indexOf('v_current_ids is distinct from v_requested_ids'))
    expect(afterUpdate.indexOf('v_row_bytes > 2097152')).toBeLessThan(afterUpdate.indexOf('jsonb_agg(pg_catalog.to_jsonb(test)'))
    expect(code).not.toMatch(/plan_cache_mode|set_config|create temp|analyze public/)
  })

  it('performs only one changed-position Test UPDATE with both identity and Class predicates', () => {
    expect(code.match(/update public\.tests test/g)).toHaveLength(1)
    expect(code).toContain('set position = desired.position')
    expect(code).toContain('where test.id = desired.id and test.classroom_id = p_classroom_id')
    expect(code).toContain('and test.position is distinct from desired.position')
    expect(code).toContain('get diagnostics v_affected_count = row_count')
    expect(code).toContain('v_affected_count is distinct from v_changed_count')
    expect(code).not.toMatch(/\b(?:insert into|delete from) public\./)
    expect(code).not.toMatch(/update public\.(?!tests\b)/)
    expect(code).not.toMatch(/\b(?:set_config|execute)\s*\(/)
  })

  it('proves complete postimages after immediate triggers and exact C/2C revision deltas', () => {
    expect(code).toContain('v_tests_after is distinct from v_tests_expected')
    expect(code).toContain('v_current_ids is distinct from v_requested_ids')
    expect(code).toContain('v_classroom_before.blueprint_source_revision + v_changed_count')
    expect(code).toContain('v_archive_before.revision + 2 * v_changed_count')
    expect(code).toContain('if v_changed_count > 0 then')
    expect(code).toContain('v_classroom_expected.updated_at := pg_catalog.transaction_timestamp()')
    expect(code).toContain('v_archive_expected.updated_at := pg_catalog.transaction_timestamp()')
    for (const row of ['classroom', 'archive']) {
      expect(code).toContain(`pg_catalog.to_jsonb(v_${row}_after) is distinct from pg_catalog.to_jsonb(v_${row}_expected)`)
    }
    expect(code).toContain('pg_catalog.to_jsonb(v_settings_after) is distinct from pg_catalog.to_jsonb(v_settings_before)')
    expect(source).toContain('14 Test triggers')
    expect(source).toContain('whole-project')
  })

  it('returns only seven bounded witness keys with N-1 through zero positions', () => {
    expect(code).toContain('(v_count - requested.ordinality)::integer')
    expect(code).toContain("pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,")
    expect(code).toContain("'test_ids',pg_catalog.to_jsonb(p_test_ids),'positions',v_positions,'count',v_count,'changed_count',v_changed_count)")
    const witness = code.slice(code.indexOf("v_result := pg_catalog.jsonb_build_object('version',1"))
      .split(';')[0]
    expect([...witness.matchAll(/'([a-z_]+)',/g)].map(match => match[1])).toEqual([
      'version', 'actor_id', 'classroom_id', 'test_ids', 'positions', 'count', 'changed_count',
    ])
    expect(code).toContain('pg_catalog.octet_length(v_result::text) > 524288')
    expect(code.indexOf('v_tests_after is distinct from v_tests_expected')).toBeLessThan(code.indexOf("v_result := pg_catalog.jsonb_build_object('version',1"))
    expect(code).toContain('when lock_not_available or deadlock_detected or serialization_failure then')
    expect(code).toContain("when sqlstate '55000' then")
    expect(code).not.toMatch(/when others|when insufficient_privilege/)
    for (const state of ['PT400', 'PT403', 'PT404', 'PT409', 'PT503']) expect(code).toContain(`errcode = '${state}'`)
  })
})
