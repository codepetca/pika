import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/085_atomic_classroom_archive_compaction.sql'),
  'utf8',
)
const restoreContract = readFileSync(
  resolve(process.cwd(), 'scripts/check-classroom-archive-restore-database.sh'),
  'utf8',
)
const compactionContract = readFileSync(
  resolve(process.cwd(), 'scripts/check-classroom-archive-compaction-database.sh'),
  'utf8',
)
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')

describe('atomic classroom archive compaction migration', () => {
  it('adds a private durable source-object cleanup ledger', () => {
    expect(migration).toContain(
      'create table if not exists public.classroom_archive_source_object_cleanup',
    )
    expect(migration).toContain("storage_bucket text not null check (storage_bucket in (")
    expect(migration).toContain("status text not null default 'staged'")
    expect(migration).toContain('primary key (operation_id, storage_bucket, storage_path)')
    expect(migration).toContain(
      'revoke all on table public.classroom_archive_source_object_cleanup from public, anon, authenticated;',
    )
  })

  it('defines idempotent service-role-only compaction RPCs', () => {
    expect(migration).toContain('public.begin_classroom_archive_compaction(')
    expect(migration).toContain('public.stage_classroom_archive_compaction_objects(')
    expect(migration).toContain('public.complete_classroom_archive_compaction(')
    expect(migration).toContain('public.fail_classroom_archive_compaction(')
    expect(migration).toContain("operation_type <> 'compact'")
    expect(migration).toContain("'idempotency_conflict'")
    expect(migration).toContain(
      'pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0))',
    )
    expect(migration).toContain("'compaction_already_in_progress'")
    expect(migration).toContain("'classroom_archive_not_verified'")
    expect(migration).toContain("'classroom_archive_retention_not_compactable'")
    expect(migration).toContain('Compaction retention is not teacher-managed')
    expect(migration).toContain("'classroom_archive_resource_contract_invalid'")
    expect(migration).toContain(
      'grant execute on function public.complete_classroom_archive_compaction(uuid, uuid, jsonb, jsonb) to service_role;',
    )
  })

  it('requires fresh read-back evidence and a fully staged cleanup plan', () => {
    expect(migration).toContain("p_verification->>'operation_id'")
    expect(migration).toContain("p_verification->>'archive_id'")
    expect(migration).toContain("p_verification->>'artifact_sha256'")
    expect(migration).toContain("p_verification->>'content_sha256'")
    expect(migration).toContain("p_verification->>'verified_at'")
    expect(migration).toContain("p_verification->>'read_back_verified'")
    expect(migration).toContain("p_verification->>'artifact_checksum_verified'")
    expect(migration).toContain("p_verification->>'source_object_cleanup_staged'")
    expect(migration).toContain("p_verification->>'schema_adapter_verified'")
    expect(migration).toContain("p_verification->>'actor_references_resolved'")
    expect(migration).toContain('Compaction source-object cleanup count differs')
    expect(migration).toContain('Compaction source-object cleanup bytes differ')
    expect(migration).toContain("set status = 'pending'")
    expect(migration).toContain('actor_role text not null')
    expect(migration).toContain('Compaction actor roles changed after restore preflight')
    expect(migration).toContain('for update of users')
    expect(migration).toContain(
      'Compaction actor descriptors do not exactly match staged references',
    )
  })

  it('returns a complete snapshot contract on retry and rejects missing resource keys', () => {
    expect(migration).toContain("'storage_bucket', v_operation.storage_bucket")
    expect(migration).toContain("'storage_path', v_operation.storage_path")
    expect(migration).toContain("'artifact_sha256', v_operation.artifact_sha256")
    expect(migration).toContain("'content_sha256', v_operation.content_sha256")
    expect(migration).toContain('jsonb_object_keys(v_archive.resource_counts)')
    expect(migration).toContain(
      'if not (v_operation.resource_counts ? v_resource.table_name) then',
    )
  })

  it('checks every owned row before deleting child-first in one transaction', () => {
    const completeFunction = migration.match(
      /create or replace function public\.complete_classroom_archive_compaction[\s\S]*?\n\$\$;/,
    )?.[0]
    expect(completeFunction).toBeDefined()
    expect(completeFunction).toContain('order by export_position')
    expect(completeFunction).toContain('order by export_position desc')
    expect(completeFunction).toContain('Classroom compaction source count differs for %')
    expect(completeFunction).toContain("set_config('pika.classroom_archive_compaction', 'on', true)")
    expect(completeFunction).toContain("set_config('pika.classroom_archive_restore', 'on', true)")
    expect(completeFunction).toContain(
      'Compaction database foreign keys or triggers reject staged rows',
    )
    expect(completeFunction).toContain('insert into public.classroom_cold_tombstones')
    expect(completeFunction).toContain("status = 'completed'")

    const preflightCount = completeFunction?.indexOf(
      'Classroom compaction source count differs for %',
    ) ?? Number.MAX_SAFE_INTEGER
    const tombstone = completeFunction?.indexOf(
      'insert into public.classroom_cold_tombstones',
    ) ?? -1
    const dryRun = completeFunction?.indexOf(
      'Compaction database foreign keys or triggers reject staged rows',
    ) ?? -1
    const reverseDelete = completeFunction?.lastIndexOf('order by export_position desc') ?? -1
    const completed = completeFunction?.lastIndexOf("status = 'completed'") ?? -1
    expect(tombstone).toBeGreaterThan(preflightCount)
    expect(tombstone).toBeGreaterThan(dryRun)
    expect(reverseDelete).toBeGreaterThan(tombstone)
    expect(completed).toBeGreaterThan(reverseDelete)
  })

  it('keeps terminal failure cleanup explicit and retry-safe', () => {
    expect(migration).toContain("status = 'failed'")
    expect(migration).toContain('and operation_type = \'compact\'')
    expect(migration).toContain('if v_updated and not p_retryable then')
    expect(migration).toContain(
      'delete from public.classroom_archive_source_object_cleanup where operation_id = p_operation_id;',
    )
  })

  it('atomically expires only live or retryable operations', () => {
    const cleanupFunction = migration.match(
      /create or replace function public\.cleanup_expired_classroom_archive_snapshots[\s\S]*?\n\$\$;/,
    )?.[0]
    expect(cleanupFunction).toContain('with expired as (')
    expect(cleanupFunction).toContain("status = 'snapshot_ready'")
    expect(cleanupFunction).toContain("status = 'failed' and retryable is true")
    expect(cleanupFunction).toContain('returning id')
  })

  it('runs rollback coverage and restores from the real compaction transition in CI', () => {
    expect(workflow).toContain('bash scripts/check-classroom-archive-compaction-database.sh')
    expect(compactionContract).toContain('forced compaction rollback')
    expect(compactionContract).toContain('Compaction transaction did not roll back completely')
    expect(compactionContract).toContain('Completed compaction did not replay idempotently')
    expect(compactionContract).toContain('Authenticated role can execute classroom compaction RPCs')
    expect(restoreContract).toContain('public.begin_classroom_archive_compaction(')
    expect(restoreContract).toContain('public.complete_classroom_archive_compaction(')
    expect(restoreContract).not.toContain('insert into public.classroom_cold_tombstones')
    expect(restoreContract).not.toContain('delete from public.classrooms where id = v_classroom_id')
  })
})
