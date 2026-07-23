import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASSROOM_RELATIONAL_RESOURCES,
  getClassroomResourceOrder,
} from '@/lib/contracts/classroom-data'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/082_verified_classroom_archive_exports.sql'),
  'utf8',
)

function sqlTextArray(values: string[]) {
  return values.length === 0
    ? 'array[]::text[]'
    : `array[${values.map((value) => `'${value}'`).join(', ')}]`
}

describe('verified classroom archive migration', () => {
  it('mirrors the executable resource graph and primary keys exactly', () => {
    const order = getClassroomResourceOrder('export').filter((table) =>
      !table.startsWith('classroom_retired_assessment_'),
    )
    for (const [position, table] of order.entries()) {
      const resource = CLASSROOM_RELATIONAL_RESOURCES.find((item) => item.table === table)
      expect(resource).toBeDefined()
      if (!resource) continue
      const parent = resource.scope.kind === 'root' ? 'null' : `'${resource.scope.parent}'`
      const column = resource.scope.kind === 'root' ? 'null' : `'${resource.scope.column}'`
      expect(migration).toContain(
        `('${resource.table}', ${sqlTextArray(resource.primary_key)}, ${parent}, ${column}, ${sqlTextArray(resource.restore_after)}, ${position})`,
      )
      if (resource.actor_columns.length > 0) {
        expect(migration).toContain(
          `when '${resource.table}' then ${sqlTextArray(resource.actor_columns)}`,
        )
      }
    }
  })

  it('keeps operation and revision metadata outside the restorable ownership graph', () => {
    expect(migration).toContain('classroom_id uuid primary key,')
    expect(migration).not.toMatch(
      /create table if not exists public\.classroom_archive_revisions[\s\S]*?classroom_id uuid[^\n]*references public\.classrooms/,
    )
    expect(migration).not.toMatch(
      /create table if not exists public\.classroom_archive_operations[\s\S]*?classroom_id uuid[^\n]*references public\.classrooms/,
    )
  })

  it('does not grant archive metadata or RPC access to browser roles', () => {
    expect(migration).toContain(
      'revoke all on table public.classroom_archives from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'revoke all on function public.begin_classroom_archive_export(uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;',
    )
  })

  it('records an exact upload intent before export finalization', () => {
    expect(migration).toContain('create table if not exists public.classroom_archive_object_upload_cleanup')
    expect(migration).toContain('create or replace function public.stage_classroom_archive_object_upload')
    expect(migration).toContain("p_storage_path <> format(")
    expect(migration).toContain("'%s/%s/%s/classroom-v1.tar.gz'")
    expect(migration).toContain('Classroom archive upload intent is missing during finalization')
    expect(migration).toContain("set status = 'pending'")
  })

  it('serializes simultaneous first use of one export idempotency key', () => {
    expect(migration).toContain(
      'perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));',
    )
  })

  it('preserves terminal expiry and failure state during finalize and cleanup races', () => {
    expect(migration).toContain(
      "'retryable', coalesce(v_operation.retryable, false)",
    )
    expect(migration).toContain(
      "and (status <> 'failed' or retryable is true);",
    )
    expect(migration).toContain(
      "or (status = 'failed' and retryable is true)",
    )
  })
})
