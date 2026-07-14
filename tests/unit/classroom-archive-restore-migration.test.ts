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

  it('atomically claims expired staging without overwriting completed operations', () => {
    const cleanupFunction = migration.match(
      /create or replace function public\.cleanup_expired_classroom_archive_snapshots[\s\S]*?\n\$\$;/,
    )?.[0]
    expect(cleanupFunction).toContain('with expired as (')
    expect(cleanupFunction).toContain("where status <> 'completed'")
    expect(cleanupFunction).toContain('returning id')
  })

  it('exposes restore state and RPCs only to the service role', () => {
    expect(migration).toContain(
      'revoke all on table public.classroom_archive_restore_staging from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'revoke all on function public.begin_classroom_archive_restore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, bigint) from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'grant execute on function public.complete_classroom_archive_restore(uuid, uuid, jsonb) to service_role;',
    )
  })
})
