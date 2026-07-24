import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/110_atomic_test_document_authoring_cleanup.sql',
  ),
  'utf8',
)

describe('atomic test document authoring and cleanup migration', () => {
  it('locks test and classroom rows before ownership, archive, and CAS checks', () => {
    expect(migration).toMatch(/for update of t, c/i)
    expect(migration).toMatch(/v_owner_id is distinct from p_teacher_id/i)
    expect(migration).toMatch(/v_archived_at is not null/i)
    expect(migration).toMatch(/v_test\.status is distinct from p_expected_status/i)
    expect(migration).toMatch(/v_test\.documents[\s\S]*is distinct from/i)
  })

  it('queues obsolete snapshots transactionally on document update or deletion', () => {
    expect(migration).toMatch(
      /after update of documents or delete on public\.tests/i,
    )
    expect(migration).toMatch(/enqueue_obsolete_test_document_snapshots/i)
    expect(migration).toMatch(/not exists[\s\S]*new_document/i)
    expect(migration).toMatch(/null::uuid/i)
    expect(migration).toMatch(/null::timestamptz/i)
  })

  it('provides leased, retryable, reference-aware cleanup', () => {
    expect(migration).toMatch(/for update skip locked/i)
    expect(migration).toMatch(/lease_expires_at/i)
    expect(migration).toMatch(/test_document_snapshot_path_is_referenced/i)
    expect(migration).toMatch(/fail_test_document_snapshot_storage_cleanup/i)
  })

  it('limits table and RPC access to the service role', () => {
    expect(migration).toMatch(
      /revoke all on table public\.test_document_snapshot_storage_cleanup[\s\S]*from public, anon, authenticated/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.update_test_documents_atomic[\s\S]*to service_role/i,
    )
  })
})
