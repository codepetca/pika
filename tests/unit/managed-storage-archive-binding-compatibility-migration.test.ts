import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/118_managed_storage_archive_binding_compatibility.sql',
), 'utf8')

describe('managed-storage archive binding compatibility migration', () => {
  it('allows only a one-time identity attachment without changing archive evidence', () => {
    expect(sql).toContain('old.managed_object_id is null')
    expect(sql).toContain('new.managed_object_id is not null')
    expect(sql).toContain("to_jsonb(new) - 'managed_object_id'")
    expect(sql).toContain("to_jsonb(old) - 'managed_object_id'")
    expect(sql).toContain('not v_enforced')
  })

  it('requires exact legacy ownership and verified archive metadata', () => {
    expect(sql).toContain('managed_storage_legacy_object_id')
    expect(sql).toContain("v_object.purpose = 'classroom_archive'")
    expect(sql).toContain("v_object.status = 'ready'")
    expect(sql).toContain("v_object.resource_type = 'classroom_archive_operation'")
    expect(sql).toContain('v_object.resource_id = new.operation_id')
    expect(sql).toContain("v_object.content_type = 'application/gzip'")
    expect(sql).toContain('v_object.byte_size = new.compressed_byte_size')
    expect(sql).toContain('v_object.content_sha256 = new.artifact_sha256')
  })

  it('requires the operation ledger to be bound first and preserves the rejection boundary', () => {
    expect(sql).toContain('v_operation.managed_object_id = v_object.id')
    expect(sql).toContain('v_operation.storage_bucket = new.storage_bucket')
    expect(sql).toContain('v_operation.storage_path = new.storage_path')
    expect(sql).toContain('Verified classroom archive metadata is immutable')
    expect(sql).toContain(
      'revoke all on function public.reject_classroom_archive_metadata_update()',
    )
  })
})
