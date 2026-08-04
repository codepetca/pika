import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/118_hot_archived_classroom_purge_managed_ownership.sql',
), 'utf8')

describe('managed-ownership classroom purge migration', () => {
  it('ships disabled and requires exact migration-117 ownership identities', () => {
    expect(sql).toContain("rollout_mode text not null default 'disabled'")
    expect(sql).toContain('managed_storage_object_id uuid')
    expect(sql).toContain('purge_object.managed_storage_object_id = v_object.id')
    expect(sql).not.toContain('classroom_purge_url_candidates')
    expect(sql).not.toContain('classroom_purge_storage_path_is_shared(')
    expect(sql).not.toContain('preserve_shared')
    expect(sql).toContain('unfinished_legacy_classroom_purge_operations')
    expect(sql).toMatch(
      /classroom_purge_operations where status <> 'completed'/,
    )
  })

  it('keeps deletion ledgers read-only to service_role', () => {
    for (const table of [
      'classroom_purge_operations',
      'classroom_purge_resources',
      'classroom_purge_objects',
      'classroom_purge_fences',
    ]) {
      expect(sql).toContain(`revoke all on table public.${table}\n  from service_role`)
      expect(sql).toContain(`grant select on table public.${table} to service_role`)
    }
  })

  it('fences direct and provisional classroom-owned writers before snapshotting', () => {
    expect(sql).toMatch(
      /function public\.classroom_purge_conflict\(p_classroom_id uuid\)[\s\S]*?language plpgsql\s+volatile/,
    )
    expect(sql).toContain('pg_try_advisory_xact_lock')
    expect(sql).toContain("errcode = '40001', message = 'classroom_operation_busy'")
    expect(sql).toContain('revoke all on function public.classroom_purge_try_lock(uuid)')
    expect(sql).toContain('managed_storage_classroom_purge_fence')
    expect(sql).toContain('managed_storage_provisional_owner_purge_fence')
    expect(sql).toContain('assignment_artifact_cleanup_purge_fence')
    expect(sql).toContain('test_document_cleanup_purge_fence')
    expect(sql).toContain("object.status in ('reserved', 'verified')")
    expect(sql).toContain("set_config('pika.classroom_purge_begin', 'on', true)")
    expect(sql).toContain('for update of object')
  })

  it('uses leased deletion authority and verifies storage absence', () => {
    expect(sql).toContain("purge_object.status = 'processing'")
    expect(sql).toContain('purge_object.lease_expires_at > clock_timestamp()')
    expect(sql).toContain('classroom_purge_storage_object_still_present')
    expect(sql).toContain('classroom_purge_storage_reappeared')
    expect(sql).toContain("purge_object.status = 'deleted'")
    expect(sql).toContain('classroom_purge_path_reserved')
  })

  it('preserves users and Course Blueprints while explicitly reconciling owned data', () => {
    expect(sql).toContain('update public.course_blueprint_change_proposals')
    expect(sql).toContain('update public.course_blueprint_operations')
    expect(sql).toContain('delete from public.classroom_gradex_extracts')
    expect(sql).toContain('delete from public.classroom_archive_operations')
    expect(sql).toContain("'operational_counts', v_operational_counts")
    expect(sql).toContain("'operational_inventory_sha256', v_operational_digest")
    expect(sql).toContain("'classroom_archive_snapshot_resources'")
    expect(sql).toContain("'classroom_gradex_extract_cleanup'")
    expect(sql).toContain('delete from public.managed_storage_objects object')
    expect(sql).not.toMatch(/delete from public\.users/i)
    expect(sql).not.toMatch(/delete from public\.course_blueprints/i)
  })

  it('provides durable retry and fail-safe finalization boundaries', () => {
    expect(sql).toContain("status = 'failed'")
    expect(sql).toContain('retryable = true')
    expect(sql).toContain('for update of purge_object skip locked')
    expect(sql).toContain('exception when others then')
    expect(sql).toContain('classroom_purge_fence_missing')
    expect(sql).toContain("error_code = 'classroom_purge_storage_reappeared'")
    expect(sql).toContain("retryable = false")
    expect(sql).toContain("'waiting_for_storage', true")
  })
})
