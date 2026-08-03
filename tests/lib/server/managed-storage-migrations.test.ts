import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function migration(name: string) {
  return readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8')
}

describe('managed storage migration contract', () => {
  const foundation = migration('117_managed_storage_ownership_foundation.sql')

  it('keeps migration application passive and purge entry points unavailable', () => {
    expect(foundation).toContain("default 'compatibility'")
    expect(foundation).toContain('revoke all on function public.begin_hot_archived_classroom_purge')
    expect(foundation).not.toMatch(/cron\.schedule|pg_cron|permanent.*delete/i)
  })

  it('serializes readiness with writers and binds activation to exact evidence', () => {
    expect(foundation).toContain('for share;')
    expect(foundation).toContain('managed_storage_writer_revision_seq')
    expect(foundation).toContain('readiness_writer_revision is distinct from v_writer_revision')
    expect(foundation).toContain('where singleton for update;')
    expect(foundation).toContain(
      'revoke all on function public.lock_managed_storage_protocol()',
    )
    expect(foundation).toContain('from public, anon, authenticated, service_role;')
  })

  it('rejects conflicting deterministic legacy registration replays', () => {
    for (const field of [
      'created_by_user_id', 'data_subject_user_id', 'resource_type',
      'resource_id', 'content_type', 'byte_size', 'content_sha256',
    ]) {
      expect(foundation).toContain(
        `managed_storage_objects.${field}\n      is not distinct from excluded.${field}`,
      )
    }
  })

  it('covers all five buckets without recording raw paths in findings', () => {
    for (const bucket of [
      'assignment-artifacts', 'submission-images', 'test-documents',
      'classroom-archives', 'gradex-analytics-extracts',
    ]) {
      expect(foundation).toContain(`'${bucket}'`)
    }
    expect(foundation).toContain('identity_sha256')
    const findingsTable = foundation.match(
      /create table public\.managed_storage_readiness_findings \([\s\S]*?\n\);/,
    )?.[0]
    expect(findingsTable).toBeDefined()
    expect(findingsTable).not.toMatch(/storage_path\s+text/i)
    expect(foundation).toContain('managed_storage_payload_raw_references')
    expect(foundation).toContain('managed_storage_payload_has_exact_reference')
    expect(foundation).toContain('embedded_reference_resource_mismatch')
    expect(foundation).toContain('operational_cleanup_inflight')
  })

  it('keeps cleanup generic and independently disabled at the application boundary', () => {
    expect(foundation).toContain('claim_managed_storage_cleanup')
    expect(foundation).toContain('managed_storage_cleanup_authority_required')
    expect(foundation).toContain('managed_storage_cleanup_in_progress')
    expect(foundation).toContain('managed_storage_cleanup_referenced_missing')
    expect(foundation).toContain('managed_storage_cleanup_requires_enforcement')
    expect(foundation).toContain("set status = 'ready', verified_at = coalesce")
    expect(foundation).toContain(
      "nullif(v_old->>'lease_token', '')::uuid is distinct from",
    )
    expect(foundation).toContain('before insert or update on storage.objects')
    expect(foundation).toContain('if not v_enforced then return new; end if;')
    expect(foundation).toContain('if not v_enforced then return old; end if;')
    expect(foundation).toContain("where status = 'processing'")
    expect(foundation).toContain("set status = 'deleted', deleted_at = clock_timestamp()")
    for (const trigger of [
      'assignment_artifact_managed_cleanup_lease',
      'test_document_managed_cleanup_lease',
      'archive_upload_managed_cleanup_lease',
      'archive_source_managed_cleanup_lease',
      'gradex_managed_cleanup_lease',
    ]) {
      expect(foundation).toContain(trigger)
    }
    expect(foundation).not.toContain("set mode = 'enforced' where")
    expect(foundation.match(/v_new jsonb := to_jsonb\(new\);/g)).toHaveLength(3)
    expect(foundation).not.toContain('else new.storage_bucket')
  })

  it('fences embedded-reference removals and host deletion', () => {
    expect(foundation).toContain('embedded_reference_removed')
    expect(foundation).toContain('embedded_host_deleted')
    expect(foundation).toContain('before delete on public.assignment_docs')
    expect(foundation).toContain('before delete on public.course_blueprint_assessments')
  })
})
