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
    expect(migration).toContain("'compaction_already_in_progress'")
    expect(migration).toContain("'classroom_archive_not_verified'")
    expect(migration).toContain(
      'grant execute on function public.complete_classroom_archive_compaction(uuid, uuid, jsonb) to service_role;',
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
    expect(migration).toContain('Compaction source-object cleanup count differs')
    expect(migration).toContain('Compaction source-object cleanup bytes differ')
    expect(migration).toContain("set status = 'pending'")
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
    expect(completeFunction).toContain('insert into public.classroom_cold_tombstones')
    expect(completeFunction).toContain("status = 'completed'")

    const preflightCount = completeFunction?.indexOf(
      'Classroom compaction source count differs for %',
    ) ?? Number.MAX_SAFE_INTEGER
    const tombstone = completeFunction?.indexOf(
      'insert into public.classroom_cold_tombstones',
    ) ?? -1
    const reverseDelete = completeFunction?.indexOf('order by export_position desc') ?? -1
    const completed = completeFunction?.lastIndexOf("status = 'completed'") ?? -1
    expect(tombstone).toBeGreaterThan(preflightCount)
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
