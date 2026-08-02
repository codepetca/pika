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
    expect(foundation).toContain('managed_storage_cleanup_requires_enforcement')
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
  })

  it('fences embedded-reference removals and host deletion', () => {
    expect(foundation).toContain('embedded_reference_removed')
    expect(foundation).toContain('embedded_host_deleted')
    expect(foundation).toContain('before delete on public.assignment_docs')
    expect(foundation).toContain('before delete on public.course_blueprint_assessments')
  })
})
