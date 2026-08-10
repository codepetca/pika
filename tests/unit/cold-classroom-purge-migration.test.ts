import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/122_cold_archived_classroom_purge.sql',
), 'utf8')

describe('cold archived Classroom purge migration', () => {
  it('creates an independent disabled rollout and cold tombstone fence', () => {
    expect(migration).toContain('create table public.cold_classroom_purge_settings')
    expect(migration).toContain("rollout_mode text not null default 'disabled'")
    expect(migration).toContain('create table public.cold_classroom_purge_fences')
    expect(migration).toContain(
      'references public.classroom_cold_tombstones (classroom_id) on delete restrict',
    )
    expect(migration).not.toMatch(/vercel\.json|cron\.schedule|pg_cron/i)
  })

  it('snapshots privacy-safe exact operational identities', () => {
    expect(migration).toContain('create table public.cold_classroom_purge_resources')
    expect(migration).toContain('identity_sha256 text not null')
    expect(migration).toContain('cold_classroom_purge_resource_inventory')
    expect(migration).toContain('cold_classroom_purge_resource_inventory_drift')
    expect(migration).toContain('except')
  })

  it('reuses exact managed-object leases and deletes the recovery archive last', () => {
    expect(migration).toContain('managed_storage_object_id')
    expect(migration).toContain('claim_cold_classroom_purge_object')
    expect(migration).toContain("when object.id = v_archive.managed_object_id then 100")
    expect(migration).toContain('earlier.delete_priority < purge_object.delete_priority')
    expect(migration).toContain('classroom_purge_storage_reappeared')
    expect(migration).toContain('lease_expires_at > clock_timestamp()')
    expect(migration).toContain('claim_classroom_purge_object_v118')
    expect(migration).toContain("operation.purge_scope = 'hot_classroom'")
    expect(migration).toContain('finalize_hot_archived_classroom_purge_v118')
  })

  it('explicitly reconciles every cold operational family without deleting users or Blueprints', () => {
    for (const table of [
      'classroom_archive_restore_staging',
      'classroom_archive_restore_expected_objects',
      'classroom_archive_object_upload_cleanup',
      'classroom_archive_snapshot_resources',
      'classroom_archive_snapshot_actors',
      'classroom_gradex_extract_cleanup',
      'classroom_archive_source_object_cleanup',
      'classroom_archive_source_object_reservations',
      'classroom_gradex_extracts',
      'classroom_cold_archive_actors',
      'classroom_cold_tombstones',
      'classroom_archives',
      'classroom_archive_operations',
      'managed_storage_objects',
    ]) {
      expect(migration).toContain(`delete from public.${table}`)
    }
    expect(migration).not.toContain('delete from public.users')
    expect(migration).not.toContain('delete from public.course_blueprints')
    expect(migration).not.toContain('claim_managed_storage_cleanup(')
  })

  it('keeps authorization service-only and extends aggregate fence monitoring', () => {
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain(
      'grant execute on function public.begin_cold_archived_classroom_purge',
    )
    expect(migration).toContain('get_managed_deletion_health_snapshot_v121')
    expect(migration).toContain('v_valid_cold_fences')
    expect(migration).toContain('v_orphan_cold_fences')
  })
})
