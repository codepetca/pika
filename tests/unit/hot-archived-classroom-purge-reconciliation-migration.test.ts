import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/116_hot_archived_classroom_purge_trigger_reconciliation.sql',
  ),
  'utf8',
).toLowerCase()

describe('hot archived classroom purge trigger reconciliation migration', () => {
  it.each([
    ['assignment_doc_history', 'aaa_guard_assignment_doc_history_after_submit'],
    [
      'assignment_submission_artifacts',
      'aaa_guard_assignment_submission_artifact_mutation',
    ],
    [
      'assignment_submission_artifacts',
      'enqueue_deleted_assignment_artifact_storage_cleanup',
    ],
    [
      'assignment_submission_requirements',
      'aaa_guard_assignment_submission_requirement_mutation',
    ],
    ['tests', 'enqueue_obsolete_test_document_snapshots'],
  ])('scopes %s.%s to normal writes', (table, trigger) => {
    expect(migration).toMatch(
      new RegExp(
        `create trigger ${trigger}[\\s\\S]{0,240}`
        + `on public\\.${table}[\\s\\S]{0,180}`
        + "current_setting\\('pika\\.classroom_purge_finalize', true\\)"
        + "[\\s\\S]{0,80}is distinct from 'on'",
      ),
    )
  })

  it('keeps the existing integrity and cleanup functions in place', () => {
    expect(migration).toContain(
      'execute function public.guard_assignment_doc_history_after_submit()',
    )
    expect(migration).toContain(
      'execute function public.guard_assignment_submission_artifact_mutation()',
    )
    expect(migration).toContain(
      'execute function public.guard_assignment_submission_requirement_mutation()',
    )
    expect(migration).toContain(
      'execute function public.enqueue_deleted_assignment_artifact_storage_cleanup()',
    )
    expect(migration).toContain(
      'execute function public.enqueue_obsolete_test_document_snapshots()',
    )
  })

  it('does not disable or drop integrity functions', () => {
    expect(migration).not.toContain('disable trigger')
    expect(migration).not.toContain('drop function')
  })
})
