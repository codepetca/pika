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
    const order = getClassroomResourceOrder('export')
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
})
