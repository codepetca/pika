import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/117_hot_archived_classroom_purge_review_hardening.sql',
  'utf8',
)

describe('hot archived classroom purge review hardening migration', () => {
  it('blocks purge start while archive or Gradex cleanup owns a live lease', () => {
    expect(migration).toContain('classroom_archive_object_upload_cleanup cleanup')
    expect(migration).toContain('classroom_gradex_extract_cleanup cleanup')
    expect(migration).toContain("cleanup.status = 'processing'")
    expect(migration).toContain("return 'classroom_storage_cleanup_active';")
  })

  it('uses an exclusive pre-seal barrier and never reverses preservation', () => {
    const reconcile = migration.indexOf(
      'create or replace function public.reconcile_classroom_purge_object_sharing',
    )
    const exclusiveLock = migration.indexOf(
      "hashtextextended('pika-classroom-purge-storage-references', 0)",
      reconcile,
    )
    const sharedCheck = migration.indexOf(
      'public.classroom_purge_storage_path_is_shared(',
      exclusiveLock,
    )
    const preserve = migration.indexOf("disposition = 'preserve_shared'", sharedCheck)

    expect(reconcile).toBeGreaterThanOrEqual(0)
    expect(exclusiveLock).toBeGreaterThan(reconcile)
    expect(sharedCheck).toBeGreaterThan(exclusiveLock)
    expect(preserve).toBeGreaterThan(sharedCheck)
    expect(migration).not.toContain("disposition = 'delete',\n        status = 'pending'")
  })

  it('rechecks shared and operational references immediately before claim', () => {
    const claim = migration.indexOf(
      'create or replace function public.claim_classroom_purge_object',
    )
    const sharedCheck = migration.indexOf(
      'public.classroom_purge_storage_path_is_shared(',
      claim,
    )
    const externalCheck = migration.indexOf(
      'public.classroom_purge_storage_path_has_external_operation_reference(',
      sharedCheck,
    )
    const processing = migration.indexOf("status = 'processing'", externalCheck)

    expect(claim).toBeGreaterThanOrEqual(0)
    expect(sharedCheck).toBeGreaterThan(claim)
    expect(externalCheck).toBeGreaterThan(sharedCheck)
    expect(processing).toBeGreaterThan(externalCheck)
  })

  it('serializes content writers and rejects reserved managed paths', () => {
    expect(migration).toContain('pg_advisory_xact_lock_shared(')
    expect(migration).toContain(
      "object.status in ('pending', 'processing', 'failed', 'deleted')",
    )
    expect(migration).toContain(
      "'classroom_purge_storage_reservation_' || v_table",
    )
    expect(migration).toContain("'course_blueprint_versions'")
    expect(migration).toContain("'course_blueprint_operations'")
  })

  it('hands interrupted cleanup ledgers exclusively to the purge finalizer', () => {
    expect(migration).toContain(
      'create or replace function public.reject_classroom_cleanup_change_during_purge',
    )
    expect(migration).toContain('classroom_purge_fence_archive_upload_cleanup')
    expect(migration).toContain('classroom_purge_fence_gradex_cleanup')
    expect(migration).toContain(
      "raise exception 'Classroom permanent deletion owns this storage cleanup'",
    )
  })

  it('redacts preserved paths and grants only the service coordinator', () => {
    expect(migration).toContain(
      "where disposition = 'preserve_shared'\n  and status = 'preserved'",
    )
    expect(migration).toContain(
      'grant execute on function public.reconcile_classroom_purge_object_sharing(uuid, uuid)\n  to service_role;',
    )
    expect(migration).toContain(
      'revoke all on function public.reject_reserved_classroom_purge_storage_reference()',
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.reconcile_classroom_purge_object_sharing\(uuid, uuid\)\s+to (?:public|anon|authenticated)/,
    )
  })
})
