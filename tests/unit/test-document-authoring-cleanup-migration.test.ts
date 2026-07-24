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
const concurrencyCheck = readFileSync(
  join(process.cwd(), 'scripts/check-test-document-snapshot-concurrency.sh'),
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

  it('queues active-classroom removals but preserves archived compaction objects', () => {
    expect(migration).toMatch(
      /after update of documents or delete on public\.tests/i,
    )
    expect(migration).toMatch(/enqueue_obsolete_test_document_snapshots/i)
    expect(migration).toMatch(/v_archived_at is not null[\s\S]*return old/i)
    expect(migration).toMatch(/not exists[\s\S]*new_document/i)
    expect(migration).toMatch(/null::uuid/i)
    expect(migration).toMatch(/null::timestamptz/i)
  })

  it('provides leased cleanup that accounts for every durable owner', () => {
    expect(migration).toMatch(/for update skip locked/i)
    expect(migration).toMatch(/lease_expires_at/i)
    expect(migration).toMatch(/test_document_snapshot_path_is_referenced/i)
    expect(migration).toMatch(/course_blueprint_assessments/i)
    expect(migration).toMatch(/classroom_archive_source_object_cleanup/i)
    expect(migration).toMatch(/fail_test_document_snapshot_storage_cleanup/i)
  })

  it('adopts only pending provisional evidence before attaching a snapshot', () => {
    expect(migration).toMatch(
      /from public\.test_document_snapshot_storage_cleanup cleanup[\s\S]*for update/i,
    )
    expect(migration).toMatch(/snapshot_cleanup_evidence_missing/i)
    expect(migration).toMatch(/snapshot_cleanup_in_progress/i)
    expect(migration).toMatch(
      /delete from public\.test_document_snapshot_storage_cleanup[\s\S]*status = 'pending'/i,
    )
  })

  it('removes snapshot ownership metadata from existing blueprints', () => {
    expect(migration).toMatch(
      /update public\.course_blueprint_assessments assessment/i,
    )
    expect(migration).toMatch(
      /document\.value - 'snapshot_path' - 'snapshot_content_type' - 'synced_at'/i,
    )
  })

  it('limits table and RPC access to the service role', () => {
    expect(migration).toMatch(
      /revoke all on table public\.test_document_snapshot_storage_cleanup[\s\S]*from public, anon, authenticated/i,
    )
    expect(migration).toMatch(
      /grant execute on function public\.update_test_documents_atomic[\s\S]*to service_role/i,
    )
  })

  it('uses an explicit lock-acquired barrier in the database race check', () => {
    expect(concurrencyCheck).toContain(
      '\\! touch /tmp/pika-test-document-sync-ready',
    )
    expect(concurrencyCheck).toContain(
      'docker exec "$DB_CONTAINER" test -f "$SYNC_READY_PATH"',
    )
    expect(concurrencyCheck).not.toContain('sleep 0.2')
  })
})
