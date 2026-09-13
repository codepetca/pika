import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const migration = read('supabase/migrations/173_removed_student_academic_cleanup.sql')

function body(sql: string, name: string) {
  const start = sql.indexOf(`function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const begin = sql.indexOf('as $$', start)
  return sql.slice(begin, sql.indexOf('$$;', begin))
}

describe('removed academic source safety contract (not database execution)', () => {
  it.each([
    ['171_student_provider_cleanup_prerequisite.sql', '598ee035bea90e47aade94acb7d79ce2227e110c343e57be0661e71ce4ccd587'],
    ['172_student_provider_receipt_authorization_lint.sql', '4aac47ce59b41d8b1de87ec07710ff4d4df8bb7e2292456335c1c836a6e65424'],
  ])('retains the approved immutable %s', (file, sha) => {
    expect(createHash('sha256').update(read(`supabase/migrations/${file}`)).digest('hex')).toBe(sha)
  })

  it.each([
    ['123_hot_classroom_individual_student_purge.sql', 'public.reject_student_resource_change_during_purge'],
    ['123_hot_classroom_individual_student_purge.sql', 'public.reject_student_indirect_change_during_purge'],
    ['157_gradebook_score_overrides.sql', 'public.reject_gradebook_override_change_during_student_purge'],
    ['163_standalone_gradebook_items.sql', 'public.guard_gradebook_item_score'],
    ['118_hot_archived_classroom_purge_managed_ownership.sql', 'public.enqueue_deleted_assignment_artifact_storage_cleanup'],
    ['165_final_student_classroom_removal.sql', 'private.guard_final_student_roster_write'],
  ])('preserves ordinary behavior in %s / %s outside its exact private capability', (file, name) => {
    const original = body(read(`supabase/migrations/${file}`), name)
    const updated = body(migration, name)
      .replace(/^  if tg_op='DELETE' and private\.removed_academic_delete_allowed[^\n]+\n/gm, '')
      .replace(/^  if tg_table_name='classroom_roster' and tg_op='UPDATE'\n    and private\.removed_academic_delete_allowed[^\n]+\n/gm, '')
      .replace(/^  if tg_op='UPDATE' and private\.removed_academic_delete_allowed[^\n]+\n/gm, '')
    expect(updated).toBe(original)
  })

  it('never grants a general finalizer bypass or erases identity fences', () => {
    expect(migration).not.toMatch(/set_config\('pika\.(student|classroom)_purge_finalize'/)
    expect(migration).not.toMatch(/delete from public\.(users|student_profiles|student_purge_fences|classroom_roster|classroom_archives)\b/)
    expect(migration).not.toMatch(/set status\s*=\s*'completed'/)
    expect(migration).toContain('enabled boolean not null default false')
    expect(migration).toContain("current_setting('transaction_isolation') <> 'read committed'")
  })

  it('keeps the fixture rollback-only and separate from schema application', () => {
    const harness = read('scripts/check-removed-student-academic-database.sql')
    const runner = read('scripts/check-removed-student-academic-database.sh')
    expect(harness.trimEnd()).toMatch(/rollback;$/)
    expect(harness).not.toMatch(/^commit;/m)
    expect(runner).not.toMatch(/db (push|reset)|migration (up|repair)|create database/)
  })
})
