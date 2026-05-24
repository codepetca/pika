import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readBulkDeleteMigration() {
  const migrationsDir = resolve(process.cwd(), 'supabase/migrations')
  const migration = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .find((file) => {
      const contents = readFileSync(resolve(migrationsDir, file), 'utf8')
      return contents.includes('delete_student_test_attempts_atomic')
    })

  expect(migration).toBeTruthy()
  return readFileSync(resolve(migrationsDir, migration as string), 'utf8')
}

describe('atomic test work bulk delete migration', () => {
  it('keeps the bulk delete RPC behind the service-role API boundary', () => {
    const migration = readBulkDeleteMigration()

    expect(migration).toContain('create or replace function public.delete_student_test_attempts_atomic')
    expect(migration).toContain(
      'revoke all on function public.delete_student_test_attempts_atomic(uuid, uuid[]) from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'grant execute on function public.delete_student_test_attempts_atomic(uuid, uuid[]) to service_role;',
    )
  })

  it('deletes all selected test-work tables in one RPC and reports distinct affected students', () => {
    const migration = readBulkDeleteMigration()

    expect(migration).toContain('unnest(coalesce(p_student_ids, array[]::uuid[]))')
    expect(migration).toContain('delete from public.test_ai_grading_run_items')
    expect(migration).toContain('delete from public.test_responses')
    expect(migration).toContain('delete from public.test_focus_events')
    expect(migration).toContain('delete from public.test_attempts')
    expect(migration).toContain("'deleted_student_count', v_deleted_student_count")
  })
})
