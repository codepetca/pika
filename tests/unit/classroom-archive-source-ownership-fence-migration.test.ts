import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/096_classroom_archive_source_ownership_fence.sql',
  ),
  'utf8',
)
const databaseContract = readFileSync(
  resolve(process.cwd(), 'scripts/check-classroom-archive-compaction-database.sh'),
  'utf8',
)

describe('classroom archive source ownership fence migration', () => {
  it('ties ownership evidence to a permanent exact-path reservation', () => {
    expect(migration).toContain('ownership_verified_at timestamptz')
    expect(migration).toContain(
      'ownership_verified = (ownership_verified_at is not null)',
    )
    expect(migration).toContain(
      'create table if not exists public.classroom_archive_source_object_reservations',
    )
    expect(migration).toContain('primary key (storage_bucket, storage_path_sha256)')
    expect(migration).toContain(
      'public.classroom_archive_source_object_path_sha256(',
    )
    expect(migration).not.toContain('storage_path text not null,\n  operation_id uuid')
    expect(migration).toContain(
      'references public.classroom_archive_operations(id) on delete set null',
    )
    expect(migration).toContain(
      'Migration 096 requires reconciliation of previously deleted source objects',
    )
    expect(migration).toContain("last_error_code = 'ownership_fence_migration_required'")
  })

  it('limits initial verification and claims to relational assignment artifacts', () => {
    expect(migration).toContain("storage_bucket = 'assignment-artifacts'")
    expect(migration).toContain(
      'public.verify_and_reserve_classroom_archive_source_objects(',
    )
    expect(migration).toContain(
      'join public.assignment_submission_artifacts artifact',
    )
    expect(migration).toContain(
      'public.claim_due_classroom_archive_source_object_cleanup_v2(',
    )
    expect(migration).toContain('cleanup.ownership_verified_at is not null')
    expect(migration).toContain(
      'join public.classroom_archive_source_object_reservations reservation',
    )
    expect(migration).toContain(
      'create or replace function public.get_classroom_archive_source_object_presence(',
    )
  })

  it('serializes and rejects future relational and storage writes to reserved paths', () => {
    expect(migration).toContain('pg_advisory_xact_lock(')
    expect(migration).toContain(
      'public.reject_reserved_assignment_artifact_path()',
    )
    expect(migration).toContain(
      'public.reject_reserved_classroom_archive_storage_path()',
    )
    expect(migration).toContain(
      'public.guard_classroom_archive_source_cleanup_path()',
    )
    expect(migration).toContain('on storage.objects')
    expect(migration).toContain(
      'Storage deletion requires a classroom archive source reservation',
    )
    expect(migration).toContain("using errcode = '55000'")
  })

  it('removes the unfenced claim capability and keeps new contracts service-only', () => {
    expect(migration).toMatch(
      /revoke all on table public\.classroom_archive_source_object_cleanup from service_role;/,
    )
    expect(migration).toMatch(
      /revoke all on table public\.classroom_archive_source_object_reservations[\s\S]*?service_role;/,
    )
    expect(migration).toMatch(
      /revoke execute on function public\.claim_due_classroom_archive_source_object_cleanup\([\s\S]*?from service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.verify_and_reserve_classroom_archive_source_objects\(uuid, integer\)[\s\S]*?to service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.claim_due_classroom_archive_source_object_cleanup_v2\([\s\S]*?to service_role;/,
    )
    expect(migration).toMatch(
      /revoke all on table public\.classroom_archive_source_object_reservations[\s\S]*?from public, anon, authenticated;/,
    )
  })

  it('exercises evidence, reservation replay, v2 claims, and bypass revocation in PostgreSQL', () => {
    expect(databaseContract).toContain(
      'Boolean-only source ownership evidence was accepted',
    )
    expect(databaseContract).toContain(
      'verify_and_reserve_classroom_archive_source_objects',
    )
    expect(databaseContract).toContain(
      'claim_due_classroom_archive_source_object_cleanup_v2',
    )
    expect(databaseContract).toContain(
      'Service role can bypass the source-object ownership fence',
    )
    expect(databaseContract).toContain('Concurrent hot reference write was not serialized')
    expect(databaseContract).toContain(
      'Pre-fence source cleanup lease completed without a reservation',
    )
    expect(databaseContract).toContain(
      'Pre-fence source cleanup worker deleted without a reservation',
    )
    expect(databaseContract).toContain(
      'Concurrent cleanup staging was not serialized',
    )
    expect(databaseContract).toContain(
      'Exact source-object presence lookup missed an existing object',
    )
  })
})
