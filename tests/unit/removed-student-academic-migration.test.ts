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
    ['173_removed_student_academic_cleanup.sql', 'df86be920c80d21b0530a7d9d3812c6d81608374679bf7b10e99958e6e39dbdd'],
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
    ['171_student_provider_cleanup_prerequisite.sql', 'private.guard_attendance_closed_subject'],
  ])('preserves ordinary behavior in %s / %s outside its exact private capability', (file, name) => {
    const original = body(read(`supabase/migrations/${file}`), name)
    const updated = body(migration, name)
      .replace(/^  if tg_op='DELETE' and private\.removed_academic_delete_allowed[^\n]+\n/gm, '')
      .replace(/^  if tg_table_name='classroom_roster' and tg_op='UPDATE'\n    and private\.removed_academic_delete_allowed[^\n]+\n/gm, '')
      .replace(/^  if tg_op='UPDATE' and private\.removed_academic_delete_allowed[^\n]+\n/gm, '')
    expect(updated).toBe(original)
  })

  it('extends the latest indirect guard to late repo-review writes without changing existing behavior', () => {
    const correction = read('supabase/migrations/174_repo_review_student_purge_fence.sql')
    const updated = body(correction, 'public.reject_student_indirect_change_during_purge')
      .replace("elsif tg_table_name in ('assignment_ai_grading_runs', 'assignment_repo_review_runs') then",
        "elsif tg_table_name = 'assignment_ai_grading_runs' then")
    expect(updated).toBe(body(migration, 'public.reject_student_indirect_change_during_purge'))
    expect(correction).toContain('before insert or update or delete on public.assignment_repo_review_runs')
    const harness = read('scripts/check-removed-student-academic-database.sql')
    expect(harness).toContain('Late repo grading run accepted after inventory')
    expect(harness).toContain('Late repo grading run accepted after local completion')
  })

  it('never grants a general finalizer bypass or erases identity fences', () => {
    expect(migration).not.toMatch(/set_config\('pika\.(student|classroom)_purge_finalize'/)
    expect(migration).not.toMatch(/delete from public\.(users|student_profiles|student_purge_fences|classroom_roster|classroom_archives)\b/)
    expect(migration).not.toMatch(/set status\s*=\s*'completed'/)
    expect(migration).toContain('enabled boolean not null default false')
    expect(migration).toContain("current_setting('transaction_isolation') <> 'read committed'")
  })

  it('requires a fixture classification for every allowlisted resource', () => {
    const harness = read('scripts/check-removed-student-academic-database.sql')
    const allowlist = body(migration, 'private.removed_academic_row_hash')
      .split('elsif p_table=any(array[')[1].split(']) then')[0]
    const tables = [...allowlist.matchAll(/'([a-z_]+)'/g)].map(match => match[1])
    expect(tables).toHaveLength(29)
    for (const table of tables) {
      expect(harness, `missing fixture for ${table}`).toContain(`insert into public.${table}`)
      expect(harness, `missing explicit expected inventory for ${table}`).toContain(`'${table}'`)
    }
    expect(harness).toContain('Exact target row remains')
    expect(harness).toContain('Classmate/other-class row changed')
    expect(harness).toContain('Blocked inventory altered a row')
  })

  it('keeps all archive and pending reference families fail-closed', () => {
    const blockers = body(migration, 'private.removed_academic_blockers')
    for (const table of ['classroom_archives', 'classroom_gradex_extracts', 'classroom_archive_operations',
      'classroom_cold_tombstones', 'managed_storage_provisional_owners', 'assignment_artifact_storage_cleanup',
      'test_document_snapshot_storage_cleanup', 'classroom_archive_object_upload_cleanup',
      'classroom_archive_restore_expected_objects', 'classroom_archive_source_object_cleanup',
      'classroom_gradex_extract_cleanup', 'classroom_retired_assessment_record_actors']) {
      expect(blockers).toContain(`from public.${table}`)
      expect(migration).not.toContain(`delete from public.${table} `)
    }
  })

  it('keeps the fixture rollback-only and separate from schema application', () => {
    const harness = read('scripts/check-removed-student-academic-database.sql')
    const runner = read('scripts/check-removed-student-academic-database.sh')
    expect(harness.trimEnd()).toMatch(/rollback;$/)
    expect(harness).not.toMatch(/^commit;/m)
    expect(runner).not.toMatch(/db (push|reset)|migration (up|repair)|create database/)
  })
})
