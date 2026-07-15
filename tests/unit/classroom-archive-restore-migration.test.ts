import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/083_resumable_classroom_archive_restore.sql'),
  'utf8',
)

describe('resumable classroom archive restore migration', () => {
  it('keeps the cold tombstone outside the restorable classroom ownership graph', () => {
    expect(migration).toContain('create table if not exists public.classroom_cold_tombstones')
    expect(migration).not.toMatch(
      /create table if not exists public\.classroom_cold_tombstones[\s\S]*?classroom_id uuid[^\n]*references public\.classrooms/,
    )
    expect(migration).toContain(
      'archive_id uuid not null unique references public.classroom_archives (id)',
    )
  })

  it('bounds resumable staging and requires exact current table columns', () => {
    expect(migration).toContain('jsonb_array_length(p_rows) > 500')
    expect(migration).toContain('pg_column_size(p_rows) > 1048576')
    expect(migration).toContain('v_actual_columns is distinct from v_expected_columns')
    expect(migration).toContain('Restore staging replay differs')
    expect(migration).toContain('Restore parent is not staged')
    expect(migration).toContain('Restore actor is unresolved')
  })

  it('gates capacity and atomically verifies every resource before removing the tombstone', () => {
    expect(migration).toContain('perform public.cleanup_expired_classroom_archive_snapshots();')
    expect(migration).toContain('pg_database_size(current_database())')
    expect(migration).toContain('v_archive.uncompressed_byte_size * 2')
    expect(migration).toContain('jsonb_populate_recordset')
    expect(migration).toContain('Restore staging count differs')
    expect(migration).toContain('Restored classroom ownership verification failed')
    expect(migration).toContain("set_config('pika.classroom_archive_restore', 'on', true)")
    expect(migration).toContain("'referential_integrity_verified', true")
    expect(migration).toContain("'restore_already_in_progress'")

    const completeFunction = migration.match(
      /create or replace function public\.complete_classroom_archive_restore[\s\S]*?\n\$\$;/,
    )?.[0]
    expect(completeFunction).toBeDefined()
    expect(completeFunction?.lastIndexOf("status = 'completed'")).toBeGreaterThan(
      completeFunction?.indexOf('jsonb_populate_recordset') ?? Number.MAX_SAFE_INTEGER,
    )
    expect(completeFunction?.indexOf('delete from public.classroom_cold_tombstones')).toBeGreaterThan(
      completeFunction?.lastIndexOf("status = 'completed'") ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('serializes simultaneous first use of one restore idempotency key', () => {
    expect(migration).toContain(
      'perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));',
    )
  })

  it('atomically expires only live or retryable staging without overwriting terminal evidence', () => {
    const cleanupFunction = migration.match(
      /create or replace function public\.cleanup_expired_classroom_archive_snapshots[\s\S]*?\n\$\$;/,
    )?.[0]
    expect(cleanupFunction).toContain('with expired as (')
    expect(cleanupFunction).toContain("status = 'snapshot_ready'")
    expect(cleanupFunction).toContain("status = 'failed' and retryable is true")
    expect(cleanupFunction).toContain('returning id')
  })

  it('makes restore expiry terminal while retaining cleanup authority for stale workers', () => {
    const stageFunction = migration.match(
      /create or replace function public\.stage_classroom_archive_restore_rows[\s\S]*?\n\$\$;/,
    )?.[0]
    const failFunction = migration.match(
      /create or replace function public\.fail_classroom_archive_restore[\s\S]*?\n\$\$;/,
    )?.[0]

    expect(stageFunction).toContain(
      "v_operation.status = 'snapshot_ready' and v_operation.snapshot_expires_at <= now()",
    )
    expect(stageFunction).toContain("error_code = 'archive_snapshot_expired'")
    expect(stageFunction).toContain("'retryable', false")
    expect(failFunction).toContain(
      "v_operation.status = 'failed' and v_operation.retryable is false",
    )
    expect(failFunction).toContain(
      "return v_operation.error_code = 'archive_snapshot_expired';",
    )
  })

  it('exposes restore state and RPCs only to the service role', () => {
    expect(migration).toContain('public.classroom_archive_object_upload_cleanup')
    expect(migration).toContain('stage_classroom_archive_object_upload(uuid, uuid, text, text, text, bigint)')
    expect(migration).toContain(
      'delete from public.classroom_archive_object_upload_cleanup',
    )
    expect(migration).toContain(
      'revoke all on table public.classroom_archive_restore_staging from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'revoke all on function public.begin_classroom_archive_restore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint) from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'grant execute on function public.complete_classroom_archive_restore(uuid, uuid, jsonb) to service_role;',
    )
  })

  it('proves the staged storage inventory and leases orphan cleanup through the database', () => {
    expect(migration).toContain('create table if not exists public.classroom_archive_restore_expected_objects')
    expect(migration).toContain('Restore object upload set differs from expected descriptors')
    expect(migration).toContain("split_part(p_storage_path, '/', 3) <> p_operation_id::text")
    expect(migration).toContain("<> v_storage_object->>'expected_sha256'")
    expect(migration).toContain('Restore object upload inventory differs from the archive')
    expect(migration).toContain('Restore object upload inventory differs for bucket %')
    expect(migration).toContain('claim_due_classroom_archive_object_upload_cleanup')
    expect(migration).toContain('lease_expires_at > clock_timestamp()')
  })
})
