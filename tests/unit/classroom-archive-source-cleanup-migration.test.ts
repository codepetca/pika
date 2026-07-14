import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/086_classroom_archive_source_object_cleanup.sql',
  ),
  'utf8',
)
const databaseContract = readFileSync(
  resolve(process.cwd(), 'scripts/check-classroom-archive-compaction-database.sh'),
  'utf8',
)

describe('classroom archive source-object cleanup migration', () => {
  it('adds explicit processing and failed ledger states with bounded retries', () => {
    expect(migration).toContain(
      "status in ('staged', 'pending', 'processing', 'failed', 'deleted')",
    )
    expect(migration).toContain('classroom_archive_source_object_cleanup_state_check')
    expect(migration).toContain("status = 'processing'")
    expect(migration).toContain("status = 'failed'")
    expect(migration).toMatch(/least\(\s*1440/)
    expect(migration).toContain('power(2')
  })

  it('claims only completed, tombstoned compactions using skip-locked leases', () => {
    expect(migration).toContain(
      'public.claim_due_classroom_archive_source_object_cleanup(',
    )
    expect(migration).toContain("operation.operation_type = 'compact'")
    expect(migration).toContain("operation.status = 'completed'")
    expect(migration).toContain('cleanup.operation_id = p_operation_id')
    expect(migration).toContain('cleanup.ownership_verified is true')
    expect(migration).toContain('uq_classroom_archive_source_cleanup_owned_object')
    expect(migration).toContain(
      'join public.classroom_cold_tombstones tombstone',
    )
    expect(migration).toContain('for update of cleanup skip locked')
    expect(migration).toContain('p_limit > 100')
    expect(migration).toContain('p_lease_seconds < 30')
    expect(migration).toContain('p_lease_seconds > 1800')
  })

  it('requires the composite object identity and current lease to complete or fail', () => {
    expect(migration).toContain(
      'public.complete_classroom_archive_source_object_cleanup(',
    )
    expect(migration).toContain(
      'public.fail_classroom_archive_source_object_cleanup(',
    )
    expect(migration).toContain('operation_id = p_operation_id')
    expect(migration).toContain('storage_bucket = p_storage_bucket')
    expect(migration).toContain('storage_path = p_storage_path')
    expect(migration).toContain("status = 'processing'")
    expect(migration).toContain('lease_token = p_lease_token')
    expect(migration).toContain('lease_expires_at > clock_timestamp()')
    expect(migration).toContain(
      'public.renew_classroom_archive_source_object_cleanup_lease(',
    )
    expect(migration).toContain('p_storage_bucket is null')
    expect(migration).toContain("p_error_code !~ '^[a-z0-9_]{3,80}$'")
  })

  it('keeps ledger and RPC access service-role-only', () => {
    expect(migration).toMatch(
      /revoke all on table public\.classroom_archive_source_object_cleanup\s+from public, anon, authenticated;/,
    )
    expect(migration).toContain(
      'grant select on table public.classroom_archive_source_object_cleanup to service_role;',
    )
    expect(migration).toMatch(
      /grant execute on function public\.claim_due_classroom_archive_source_object_cleanup\(uuid, uuid, integer, integer\)\s+to service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.renew_classroom_archive_source_object_cleanup_lease\(uuid, text, text, uuid, integer\)\s+to service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.complete_classroom_archive_source_object_cleanup\(uuid, text, text, uuid\)\s+to service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.fail_classroom_archive_source_object_cleanup\(uuid, text, text, uuid, text\)\s+to service_role;/,
    )
  })

  it('exercises lifecycle, stale lease, retry, completion, and security in the database', () => {
    expect(databaseContract).toContain(
      'claim_due_classroom_archive_source_object_cleanup',
    )
    expect(databaseContract).toContain(
      'Staged source-object cleanup was claimable before compaction completed',
    )
    expect(databaseContract).toContain(
      'Active source-object cleanup lease was claimed twice',
    )
    expect(databaseContract).toContain(
      'Expired source-object cleanup lease was not reclaimed',
    )
    expect(databaseContract).toContain(
      'Stale source-object cleanup lease completed work',
    )
    expect(databaseContract).toContain(
      'Source-object cleanup retry backoff was bypassed',
    )
    expect(databaseContract).toContain(
      'Invalid source-object cleanup completion path was accepted',
    )
    expect(databaseContract).toContain(
      'Authenticated role can execute source-object cleanup RPCs',
    )
  })
})
