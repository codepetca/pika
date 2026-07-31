import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/117_hot_archived_classroom_purge_review_hardening.sql',
  'utf8',
)
const scopedArchiveMaintenanceMigration = readFileSync(
  'supabase/migrations/095_scope_classroom_archive_restore_context.sql',
  'utf8',
)

describe('explicit managed-file ownership migration', () => {
  it('gives every source object exactly one hot, cold, or Blueprint lifecycle owner', () => {
    expect(migration).toContain('create table public.managed_storage_objects')
    expect(migration).toContain('cold_classroom_id uuid references public.classroom_cold_tombstones')
    expect(migration).toContain('cold_archive_id uuid references public.classroom_archives')
    expect(migration).toContain(
      'check (num_nonnulls(classroom_id, cold_classroom_id, course_blueprint_id) = 1)',
    )
    expect(migration).toContain('managed_storage_objects_cold_owner_coverage_fk')
    expect(migration).toContain('unique (storage_bucket, storage_path)')
    expect(migration).toContain('created_by_user_id uuid references public.users (id) on delete set null')
    expect(migration).toContain('data_subject_user_id uuid references public.users (id) on delete set null')
  })

  it('keeps rollout and purge disabled when the migration is merely installed', () => {
    expect(migration).toContain('enforce_ownership boolean not null default false')
    expect(migration).toContain('hot_classroom_purge_enabled boolean not null default false')
    expect(migration).toContain("coverage.status = 'verified'")
    expect(migration).toContain("'error_code', 'classroom_purge_disabled'")
    expect(migration).toContain("'error_code', 'managed_storage_enforcement_required'")
  })

  it('uses exact bucket and path ownership instead of URL or JSON sharing scans', () => {
    expect(migration).toContain('public.managed_storage_identity_sha256(')
    expect(migration).toContain('object.storage_bucket = v_bucket')
    expect(migration).toContain('object.storage_path = v_path')
    expect(migration).toContain('drop function if exists public.classroom_purge_url_candidates')
    expect(migration).toContain('drop function if exists public.classroom_purge_jsonb_references_storage_path')
    expect(migration).not.toContain('create or replace function public.classroom_purge_url_candidates')
  })

  it('plans, verifies, and atomically adopts durable Blueprint file copies', () => {
    expect(migration).toContain('create table public.course_blueprint_storage_copy_items')
    expect(migration).toContain('create or replace function public.claim_course_blueprint_storage_copy')
    expect(migration).toContain('create or replace function public.complete_course_blueprint_storage_copy')
    expect(migration).toContain('create or replace function public.adopt_course_blueprint_storage_copies')
    expect(migration).toContain('public.rewrite_managed_storage_document_owner(')
    expect(migration).toContain('source.course_blueprint_id = v_operation.source_blueprint_id')
    expect(migration).toContain('from public.save_course_blueprint_version_atomic(')
    expect(migration).toContain("'storage_copy_adopted_from_version_id', v_version_id")
    expect(migration).toContain('public.remove_blueprint_managed_storage_documents(')
    expect(migration).toContain(
      'archived_classroom_blueprint_snapshot_from_plan_legacy_117(',
    )
    expect(migration).toContain(
      "'documents', coalesce(live_assessment.documents, '[]'::jsonb)",
    )
    expect(migration).not.toContain("current_setting('pika.blueprint_storage_adoption', true) = 'on'")
    expect(migration).not.toMatch(/update public\.course_blueprint_versions\s+set/)
    expect(migration).toMatch(
      /status = 'running',\s+storage_copy_status = 'copying',\s+completed_at = null/,
    )
  })

  it('scrubs only assessment document ownership from the provisional Version', () => {
    const helperStart = migration.indexOf(
      'create or replace function public.remove_blueprint_managed_storage_documents(',
    )
    const helperEnd = migration.indexOf('$$;', helperStart)
    const helper = migration.slice(helperStart, helperEnd)

    expect(helper).toContain("p_value->'assessments'")
    expect(helper).toContain("assessment.value->'documents'")
    expect(helper).toContain("document.value ? 'managed_object_id'")
    expect(helper).not.toContain('jsonb_each(p_value)')
    expect(helper).not.toContain("p_value->'assignments'")
  })

  it('restores exact ownership and preserves it through hot-to-cold source cleanup', () => {
    expect(migration).toContain('create table public.classroom_archive_restore_managed_objects')
    expect(migration).toContain('create or replace function public.begin_classroom_archive_restore_managed_v2')
    expect(migration).toContain('complete_classroom_archive_restore_legacy_117')
    expect(migration).toContain('create or replace function public.complete_classroom_archive_source_object_cleanup')
    expect(migration).toContain('Classroom archive source object is still present')
    expect(migration).toContain('cold_managed_storage_restore_replacement_missing')
    expect(migration).toContain("released.purpose, 'cleanup_pending'")
    expect(migration).toContain("'pika.classroom_archive_restore_operation_id'")
    expect(migration).toContain('operation.id = v_restore_operation_id')
  })

  it('attaches legacy test ownership without recording a semantic classroom edit', () => {
    const functionStart = migration.indexOf(
      'create or replace function public.attach_legacy_test_document_managed_object(',
    )
    const functionEnd = migration.indexOf('$$;', functionStart)
    const attachFunction = migration.slice(functionStart, functionEnd)
    const maintenanceOn = attachFunction.indexOf(
      "set_config('pika.classroom_archive_compaction', 'on', true)",
    )
    const metadataUpdate = attachFunction.indexOf(
      'update public.tests set documents = v_documents where id = p_test_id;',
    )
    const maintenanceRestore = attachFunction.indexOf(
      "coalesce(v_prior_archive_compaction, 'off')",
      metadataUpdate,
    )

    expect(maintenanceOn).toBeGreaterThanOrEqual(0)
    expect(metadataUpdate).toBeGreaterThan(maintenanceOn)
    expect(maintenanceRestore).toBeGreaterThan(metadataUpdate)
    expect(attachFunction).toContain('exception when others then')
    expect(attachFunction).toContain("coalesce(v_prior_identity_mapping, 'off')")

    // The shared trigger still treats ordinary test/resource writes as semantic;
    // only trusted restore/compaction maintenance contexts bypass the increment.
    expect(scopedArchiveMaintenanceMigration).toContain(
      "if public.is_classroom_archive_maintenance_mode('restore')",
    )
    expect(scopedArchiveMaintenanceMigration).toContain(
      "or public.is_classroom_archive_maintenance_mode('compaction')",
    )
    expect(scopedArchiveMaintenanceMigration).toContain('set revision = revision + 1')
    expect(scopedArchiveMaintenanceMigration).not.toContain(
      "is_classroom_archive_maintenance_mode('identity_mapping')",
    )
  })

  it('transfers managed ownership and verified coverage before cold compaction deletes the hot root', () => {
    const compactionWrapper = migration.indexOf(
      'create or replace function public.complete_classroom_archive_compaction(',
    )
    const compactionContext = migration.indexOf(
      "set_config('pika.classroom_archive_compaction', 'on', true)",
      compactionWrapper,
    )
    const legacyCompaction = migration.indexOf(
      'public.complete_classroom_archive_compaction_legacy_117(',
      compactionWrapper,
    )
    const transfer = migration.indexOf(
      'create or replace function public.transfer_classroom_managed_storage_to_cold()',
    )
    const ownershipMove = migration.indexOf('cold_classroom_id = new.classroom_id', transfer)
    const coverageDelete = migration.indexOf(
      'delete from public.classroom_managed_storage_coverage',
      ownershipMove,
    )

    expect(migration).toContain('create table public.classroom_cold_managed_storage_coverage')
    expect(migration).toContain('remaining_object_count integer not null')
    expect(compactionWrapper).toBeGreaterThanOrEqual(0)
    expect(compactionContext).toBeGreaterThan(compactionWrapper)
    expect(legacyCompaction).toBeGreaterThan(compactionContext)
    expect(ownershipMove).toBeGreaterThan(transfer)
    expect(coverageDelete).toBeGreaterThan(ownershipMove)
    expect(migration).toContain('cold_classroom_deletion_not_implemented')
    expect(migration).toContain("'pika.classroom_archive_compaction_operation_id'")
  })

  it('permits the legacy compaction dry-run only with its local proof, while ordinary deletes stay guarded', () => {
    const wrapper = migration.indexOf(
      'create or replace function public.complete_classroom_archive_compaction(',
    )
    const dryRunMarker = migration.indexOf(
      "set_config('pika.classroom_archive_compaction_dry_run', 'on', true)",
      wrapper,
    )
    const deferredFks = migration.indexOf('set constraints', dryRunMarker)
    const deleteGuard = migration.indexOf(
      'create or replace function public.reject_classroom_delete_with_managed_storage()',
    )
    const guardMarker = migration.indexOf(
      "current_setting('pika.classroom_archive_compaction_dry_run', true) = 'on'",
      deleteGuard,
    )
    const ordinaryDeleteFailure = migration.indexOf(
      "raise exception 'classroom_has_managed_storage_objects'",
      guardMarker,
    )

    expect(migration).toContain('on delete no action deferrable initially immediate')
    expect(dryRunMarker).toBeGreaterThan(wrapper)
    expect(deferredFks).toBeGreaterThan(dryRunMarker)
    expect(migration.slice(deferredFks, deleteGuard)).toContain(
      'public.managed_storage_objects_classroom_id_fkey',
    )
    expect(migration.slice(deferredFks, deleteGuard)).toContain(
      'public.classroom_managed_storage_coverage_classroom_id_fkey',
    )
    expect(guardMarker).toBeGreaterThan(deleteGuard)
    expect(migration.slice(guardMarker, ordinaryDeleteFailure)).toContain("operation.status = 'snapshot_ready'")
    expect(ordinaryDeleteFailure).toBeGreaterThan(guardMarker)
  })

  it('keeps the application v2 compaction contract bound to the ownership wrapper', () => {
    const v2Wrapper = migration.indexOf(
      'create or replace function public.complete_classroom_archive_compaction_v2(',
    )
    const compactionCall = migration.indexOf(
      'v_result := public.complete_classroom_archive_compaction(',
      v2Wrapper,
    )
    expect(migration).toContain('complete_classroom_archive_compaction_v2_legacy_117')
    expect(compactionCall).toBeGreaterThan(v2Wrapper)
  })

  it('blocks conflicts and retries object deletion with durable leases', () => {
    expect(migration).toContain("return 'classroom_storage_cleanup_active';")
    expect(migration).toContain("return 'classroom_grading_operation_active';")
    expect(migration).toContain("return 'classroom_blueprint_operation_active';")
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('attempt_count = object.attempt_count + 1')
    expect(migration).toContain('classroom_purge_storage_object_still_present')
  })

  it('loads snapshot-sync rows without an invalid record/scalar INTO list', () => {
    expect(migration).toContain('select test.*\n  into v_test')
    expect(migration).toContain('v_classroom_id := v_test.classroom_id;')
    expect(migration).not.toContain('into v_test, v_classroom_id')
  })

  it('increments the purge operation attempt count when a failed operation is retried', () => {
    const begin = migration.indexOf(
      'create or replace function public.begin_hot_archived_classroom_purge(',
    )
    const retryIncrement = migration.indexOf('attempt_count = attempt_count + 1', begin)
    const retryPredicate = migration.indexOf("and status = 'failed'", retryIncrement)
    expect(retryIncrement).toBeGreaterThan(begin)
    expect(retryPredicate).toBeGreaterThan(retryIncrement)
  })

  it('explicitly reconciles managed rows before the child-first relational finalizer', () => {
    const managedDelete = migration.indexOf('delete from public.managed_storage_objects object')
    const legacyFinalize = migration.indexOf(
      'public.finalize_hot_archived_classroom_purge_legacy_117(',
      managedDelete,
    )
    expect(managedDelete).toBeGreaterThanOrEqual(0)
    expect(legacyFinalize).toBeGreaterThan(managedDelete)
    expect(migration).toContain('classroom_purge_storage_owner_drift')
    expect(migration).toContain('reject_classroom_delete_with_managed_storage')
  })

  it('keeps ownership and destructive RPCs service-role only', () => {
    expect(migration).toContain(
      'revoke all on table public.managed_storage_objects from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'grant execute on function public.begin_managed_storage_upload(',
    )
    expect(migration).toContain(
      'grant execute on function public.finalize_hot_archived_classroom_purge(uuid, uuid)',
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.finalize_hot_archived_classroom_purge\(uuid, uuid\)\s+to (?:public|anon|authenticated)/,
    )
  })
})
