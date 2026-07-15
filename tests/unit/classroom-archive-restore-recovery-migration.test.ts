import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/097_classroom_archive_restore_recovery.sql',
  ),
  'utf8',
)

describe('classroom archive restore recovery migration', () => {
  it('keeps concurrent retryable finalization replayable', () => {
    expect(migration).toContain("v_operation.status = 'failed'")
    expect(migration).toContain('v_operation.retryable is true')
    expect(migration).toContain(
      'v_operation.snapshot_expires_at > clock_timestamp()',
    )
    expect(migration).toContain("'retryable', true")
    expect(migration).toContain('private.complete_classroom_archive_restore_v095')
  })

  it('rearms only the exact expired restore request with the same operation id', () => {
    expect(migration).toContain("v_operation.error_code = 'archive_snapshot_expired'")
    expect(migration).toContain('v_operation.request_sha256 = p_request_sha256')
    expect(migration).toContain('v_operation.adapter_chain = p_adapter_chain')
    expect(migration).toContain('v_operation.resource_counts = p_resource_counts')
    expect(migration).toContain('public.classroom_archive_restore_expected_objects')
    expect(migration).toContain(
      'delete from public.classroom_archive_object_upload_cleanup',
    )
    expect(migration).toContain("status = 'processing'")
    expect(migration).toContain("'restore_cleanup_in_progress'")
    expect(migration).toContain("snapshot_expires_at = v_now + interval '24 hours'")
    expect(migration).toContain("exception when sqlstate 'PRA01'")
    expect(migration).toContain('private.begin_classroom_archive_restore_v083')
    expect(migration.indexOf('cleanup_expired_classroom_archive_snapshots')).toBeLessThan(
      migration.indexOf('select * into v_operation', migration.indexOf('security definer')),
    )
  })

  it('preserves service-role-only execution through public wrappers', () => {
    expect(migration).toContain(
      'revoke all on function public.begin_classroom_archive_restore',
    )
    expect(migration).toContain(
      'grant execute on function public.begin_classroom_archive_restore',
    )
    expect(migration).toContain(
      'revoke all on function private.complete_classroom_archive_restore',
    )
  })
})
