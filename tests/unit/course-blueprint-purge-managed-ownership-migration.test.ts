import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/120_course_blueprint_purge_managed_ownership.sql',
), 'utf8')

describe('managed-ownership Course Blueprint purge migration', () => {
  it('ships independently disabled and only targets exact Blueprint-owned files', () => {
    expect(sql).toContain("rollout_mode text not null default 'disabled'")
    expect(sql).toContain("storage_bucket text not null check (storage_bucket = 'test-documents')")
    expect(sql).toContain('object.course_blueprint_id = p_course_blueprint_id')
    expect(sql).toContain('managed_storage_object_id uuid not null')
    expect(sql).not.toContain('course_blueprint_purge_url_candidates')
  })

  it('fences edits, lineage writes, source copies, and storage identity reuse', () => {
    expect(sql).toContain('pg_try_advisory_xact_lock')
    expect(sql).toContain('course_blueprint_purge_in_progress')
    expect(sql).toContain('course_blueprint_purge_required')
    expect(sql).toContain('classrooms_blueprint_purge_lineage_fence')
    expect(sql).toContain('managed_storage_provisional_blueprint_purge_fence')
    expect(sql).toContain('begin_managed_storage_blueprint_copy_owner')
    expect(sql).toContain('heartbeat_managed_storage_blueprint_copy_owner')
    expect(sql).toContain('settle_managed_storage_blueprint_copy_owner')
    expect(sql).toContain('recover_managed_storage_blueprint_copy_owner')
    expect(sql).toContain('copy_closed_at')
    expect(sql).toContain('source_course_blueprint_id')
    expect(sql).toMatch(
      /update public\.managed_storage_provisional_owners owner\s+set source_course_blueprint_id = operation\.source_blueprint_id[\s\S]*operation\.status = 'completed'/,
    )
    expect(sql).toContain('course_blueprint_purge_path_reserved')
    expect(sql).toContain("nullif(v_old->>'teacher_id', '')::uuid")
    expect(sql).not.toContain('old.teacher_id')
    expect(sql).not.toContain('pika.course_blueprint_purge_begin')
    expect(sql).toMatch(
      /provisional\.copy_closed_at is null\s*\) then return 'course_blueprint_copy_active'/,
    )
    expect(sql).not.toMatch(
      /provisional\.copy_closed_at is null\s+and \(\s*provisional\.expires_at/,
    )
  })

  it('binds confirmation to linked Classroom lineage under row locks', () => {
    expect(sql).toContain("coalesce(classroom.source_blueprint_version_id::text, 'none')")
    expect(sql).toContain('classroom.blueprint_source_revision::text')
    expect(sql).toContain('coalesce(classroom.source_blueprint_origin')
    expect(sql).toMatch(
      /where classroom\.source_blueprint_id = p_course_blueprint_id\s+order by classroom\.id for update/,
    )
    expect(sql).toContain('course_blueprint_purge_membership_sha256')
    expect(sql).toContain('v_operation.finalization_sha256')
    expect(sql).not.toMatch(
      /v_current_digest := public\.get_course_blueprint_purge_inventory/,
    )
  })

  it('uses durable leases, retry state, absence checks, and permanent path reservations', () => {
    expect(sql).toContain('for update of purge_object skip locked')
    expect(sql).toContain("purge_object.status = 'processing'")
    expect(sql).toContain('purge_object.lease_expires_at > clock_timestamp()')
    expect(sql).toContain('course_blueprint_purge_storage_object_still_present')
    expect(sql).toContain('course_blueprint_purge_storage_reappeared')
    expect(sql).toContain("set status = 'deleted', storage_path = null")
    expect(sql).toContain("set status = 'failed'")
    expect(sql).toContain('retryable = true')
  })

  it('preserves users and Classrooms while explicitly removing Blueprint lineage', () => {
    expect(sql).toContain('update public.classrooms')
    expect(sql).toContain('set source_blueprint_id = null')
    expect(sql).toContain('update public.assignments set source_blueprint_version_id = null')
    expect(sql).toContain('delete from public.course_blueprint_assignments')
    expect(sql).toContain('delete from public.course_blueprint_assessments')
    expect(sql).toContain('delete from public.course_blueprint_versions')
    expect(sql).toContain('delete from public.managed_storage_objects object')
    expect(sql).toContain('delete from public.course_blueprints')
    expect(sql).not.toMatch(/delete from public\.users/i)
    expect(sql).not.toMatch(/delete from public\.classrooms/i)
  })

  it('keeps mutation RPCs private and the operation ledger durable', () => {
    expect(sql).toContain('alter table public.course_blueprint_purge_operations enable row level security')
    expect(sql).toContain('grant select on table public.course_blueprint_purge_operations')
    expect(sql).toContain('revoke all on function public.begin_course_blueprint_purge')
    expect(sql).toContain('grant execute on function public.begin_course_blueprint_purge')
    expect(sql).toContain(
      'grant execute on function public.recover_managed_storage_blueprint_copy_owner',
    )
    expect(sql).toContain('delete from public.course_blueprint_purge_fences')
    expect(sql).not.toMatch(/delete from public\.course_blueprint_purge_operations/i)
  })
})
