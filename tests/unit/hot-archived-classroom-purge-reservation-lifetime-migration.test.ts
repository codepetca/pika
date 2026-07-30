import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/118_hot_archived_classroom_purge_reservation_lifetime.sql',
  'utf8',
)

describe('hot archived classroom purge reservation lifetime migration', () => {
  it('fails closed if an active deleted object has already lost its path', () => {
    expect(migration).toContain("object.status = 'deleted'")
    expect(migration).toContain('object.storage_path is null')
    expect(migration).toContain("operation.status <> 'completed'")
    expect(migration).toContain(
      'Cannot install purge reservation lifetime guard with unredactable active deleted objects',
    )
  })

  it('retains deleted paths until purge completion', () => {
    const complete = migration.indexOf(
      'create or replace function public.complete_classroom_purge_object',
    )
    const deleted = migration.indexOf("status = 'deleted'", complete)
    const retainedPath = migration.indexOf(
      'storage_path = object.storage_path',
      deleted,
    )
    const redaction = migration.indexOf(
      'create or replace function public.redact_classroom_purge_paths_on_completion',
    )

    expect(complete).toBeGreaterThanOrEqual(0)
    expect(deleted).toBeGreaterThan(complete)
    expect(retainedPath).toBeGreaterThan(deleted)
    expect(redaction).toBeGreaterThan(retainedPath)
    expect(migration).toContain(
      "if new.status = 'completed' and old.status is distinct from 'completed'",
    )
    expect(migration).toContain('set\n      storage_path = null')
  })

  it('rejects references to deleted paths while the purge remains active', () => {
    expect(migration).toContain(
      "object.status in ('pending', 'processing', 'failed', 'deleted')",
    )
    expect(migration).toContain("operation.status <> 'completed'")
    expect(migration).toContain(
      "raise exception 'A managed file referenced by this content is being permanently deleted'",
    )
  })

  it.each([
    'classroom_archives',
    'classroom_gradex_extracts',
    'classroom_archive_operations',
    'classroom_archive_object_upload_cleanup',
    'classroom_gradex_extract_cleanup',
  ])('adds the shared reservation trigger to %s', (table) => {
    expect(migration).toContain(`'${table}'`)
  })

  it('replaces the earlier trigger names across classroom and Blueprint writers', () => {
    expect(migration).toContain(
      "'classroom_purge_storage_reservation_' || v_table",
    )
    expect(migration).toContain(
      "'classroom_purge_00_storage_reservation_' || v_table",
    )
    expect(migration).toContain(
      'execute function public.reject_reserved_classroom_purge_storage_reference()',
    )
  })
})
