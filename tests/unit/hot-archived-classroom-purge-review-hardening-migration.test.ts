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
    expect(migration).toContain(
      'from public.save_course_blueprint_version_atomic_legacy_117(',
    )
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

  it('moves a verified legacy Classroom source to Blueprint ownership without mutating Versions', () => {
    const reconciliationStart = migration.indexOf(
      'create or replace function public.adopt_legacy_blueprint_classroom_storage_reconciliation(',
    )
    const reconciliationEnd = migration.indexOf('$$;', reconciliationStart)
    const reconciliation = migration.slice(reconciliationStart, reconciliationEnd)

    expect(migration).toContain('create table public.legacy_blueprint_classroom_storage_reconciliations')
    expect(reconciliation).toContain("status <> 'copied'")
    expect(reconciliation).toContain("classroom_id = null, course_blueprint_id = v_row.blueprint_id")
    expect(reconciliation).toContain('public.managed_storage_objects.id = v_row.source_object_id')
    expect(reconciliation).toContain('public.managed_storage_objects.classroom_id = v_row.classroom_id')
    expect(reconciliation).toContain('legacy_blueprint_reconciliation_source_owner_conflict')
    expect(reconciliation).toContain("'url', v_row.target_public_url")
    expect(reconciliation).not.toMatch(/update public\.course_blueprint_versions\s+set/)
    expect(reconciliation).not.toMatch(/insert into public\.course_blueprint_versions/)
    expect(migration).toContain(
      'blueprint_id uuid not null references public.course_blueprints (id) on delete restrict',
    )
    expect(migration).toContain(
      'classroom_id uuid not null references public.classrooms (id) on delete restrict',
    )
    expect(reconciliation).toContain(
      'delete from public.legacy_blueprint_classroom_storage_reconciliations',
    )
    expect(migration).toContain('where reconciliation.classroom_id = old.id')
    expect(migration).toContain('where reconciliation.blueprint_id = p_blueprint_id')
  })

  it('atomically registers an unshared Blueprint source while treating Versions as read-only evidence', () => {
    const registrationStart = migration.indexOf(
      'create or replace function public.register_legacy_blueprint_storage_object(',
    )
    const registrationEnd = migration.indexOf('$$;', registrationStart)
    const registration = migration.slice(registrationStart, registrationEnd)

    expect(registrationStart).toBeGreaterThanOrEqual(0)
    expect(registration).toContain('public.managed_storage_exact_lock')
    expect(registration).toContain('legacy_blueprint_registration_owner_conflict')
    expect(registration).toContain('legacy_blueprint_registration_mutable_changed')
    expect(registration).toContain('legacy_blueprint_registration_immutable_evidence_changed')
    expect(registration).toContain("'managed_object_id', p_object_id")
    expect(registration).not.toMatch(/update public\.course_blueprint_versions\s+set/)
    expect(registration).not.toMatch(/insert into public\.course_blueprint_versions/)
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
    const cleanupStart = migration.indexOf(
      'create or replace function public.complete_classroom_archive_source_object_cleanup',
    )
    const cleanupEnd = migration.indexOf('$$;', cleanupStart)
    const cleanup = migration.slice(cleanupStart, cleanupEnd)
    expect(cleanup).toContain("p_storage_path like '/%'")
    expect(cleanup).toContain("'..' = any(string_to_array(p_storage_path, '/'))")
  })

  it('redacts raw Storage paths when purge-object deletion is complete', () => {
    const completionStart = migration.indexOf(
      'create or replace function public.complete_classroom_purge_object(',
    )
    const completionEnd = migration.indexOf('$$;', completionStart)
    const completion = migration.slice(completionStart, completionEnd)

    expect(completion).toContain("status = 'deleted'")
    expect(completion).toContain('storage_path = null')
    expect(completion).toContain('lease_token = null')
    expect(completion).toContain('last_error_code = null')
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

  it('treats an absent archive maintenance setting as an ordinary lifecycle change', () => {
    expect(migration).toContain(
      "current_setting('pika.classroom_archive_compaction', true) is distinct from 'on'",
    )
    expect(migration).toContain(
      "current_setting('pika.classroom_archive_restore', true) is distinct from 'on'",
    )
    expect(migration).not.toContain(
      "current_setting('pika.classroom_archive_compaction', true) <> 'on'",
    )
    expect(migration).not.toContain(
      "current_setting('pika.classroom_archive_restore', true) <> 'on'",
    )
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

  it('keeps coverage initialization idempotent for compaction dry-run restore', () => {
    const initializer = migration.indexOf(
      'create or replace function public.initialize_classroom_managed_storage_coverage()',
    )
    const initializerEnd = migration.indexOf('$$;', initializer)

    expect(initializer).toBeGreaterThanOrEqual(0)
    expect(migration.slice(initializer, initializerEnd)).toContain(
      'on conflict (classroom_id) do nothing',
    )
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

  it('validates test-document ownership claims and scopes cleanup to the full tuple', () => {
    const authoringStart = migration.indexOf(
      'create or replace function public.update_test_documents_managed_atomic(',
    )
    const authoringEnd = migration.indexOf('$$;', authoringStart)
    const authoring = migration.slice(authoringStart, authoringEnd)
    const cleanupStart = migration.indexOf(
      'create or replace function public.queue_classroom_managed_storage_cleanup(',
    )
    const cleanupEnd = migration.indexOf('$$;', cleanupStart)
    const cleanup = migration.slice(cleanupStart, cleanupEnd)

    expect(authoring).toContain('managed_test_document_owner_mismatch')
    expect(authoring).toContain('object.classroom_id = v_classroom_id')
    expect(authoring).toContain('object.course_blueprint_id is null')
    expect(authoring).toContain('object.storage_path = v_path')
    expect(authoring).toContain("object.resource_type = 'test'")
    expect(authoring).toContain('object.resource_id = p_test_id')
    expect(authoring).toContain("object.status = 'ready'")
    expect(authoring).toContain('p_expected_managed_storage_claims jsonb')
    expect(authoring).toContain('v_result := public.update_test_documents_atomic(')
    expect(authoring).toContain('perform public.queue_classroom_managed_storage_cleanup(')
    expect(cleanup).toContain('classroom_id = p_classroom_id')
    expect(cleanup).toContain('course_blueprint_id is null')
    expect(cleanup).toContain('storage_path = p_storage_path')
    expect(cleanup).toContain('purpose = p_purpose')
    expect(cleanup).toContain('resource_type = p_resource_type')
    expect(cleanup).toContain('resource_id = p_resource_id')
    expect(cleanup).toContain('from public.tests where id = p_resource_id for update')
    expect(cleanup).toContain("document.value->>'managed_object_id' = p_object_id::text")
    expect(migration).toContain(
      'grant execute on function public.update_test_documents_managed_atomic(',
    )
  })

  it('revalidates assignment managed-file claims under the classroom purge lock', () => {
    const lockStart = migration.indexOf(
      'create or replace function public.lock_assignment_doc_managed_storage_claims(',
    )
    const lockEnd = migration.indexOf('$$;', lockStart)
    const lock = migration.slice(lockStart, lockEnd)

    expect(lock).toContain('perform public.classroom_purge_lock(v_classroom_id)')
    expect(lock).toContain('classroom.archived_at is null')
    expect(lock).toContain('from public.classroom_purge_fences')
    expect(lock).toContain('object.id = v_object_id')
    expect(lock).toContain('object.classroom_id = v_classroom_id')
    expect(lock).toContain("object.status = 'ready'")
    expect(lock).toContain('for update;')
    expect(migration).toContain('create or replace function public.save_assignment_doc_managed_atomic(')
    expect(migration).toContain('create or replace function public.submit_assignment_doc_managed_atomic(')
    expect(migration).toContain(
      'create or replace function public.submit_assignment_doc_with_pal_event_managed_atomic(',
    )
    expect(migration).toContain(
      'rename to save_assignment_doc_atomic_legacy_117',
    )
    expect(migration).toContain("raise exception 'managed_assignment_wrapper_required'")
    expect(migration).toContain(
      'create or replace function public.prepare_legacy_assignment_doc_write_117(',
    )
    expect(migration).toContain("error_code = 'legacy_assignment_write_after_readiness'")
    expect(migration).toContain("status = 'pending'")
    expect(migration).toContain('perform public.classroom_purge_lock(v_classroom_id)')
    expect(migration).toContain(
      'perform public.prepare_legacy_assignment_doc_write_117(p_assignment_id)',
    )
    expect(migration).toContain('return public.save_assignment_doc_atomic_legacy_117(')
    expect(migration).toContain(
      'revoke all on function public.save_assignment_doc_atomic_legacy_117(',
    )
  })

  it('retains immutable Blueprint material and blocks instantiation without ownership', () => {
    const cleanupStart = migration.indexOf(
      'create or replace function public.queue_removed_blueprint_test_document_files()',
    )
    const cleanupEnd = migration.indexOf('$$;', cleanupStart)
    const cleanup = migration.slice(cleanupStart, cleanupEnd)
    expect(cleanup).toContain('from public.course_blueprint_versions')
    expect(cleanup).toContain('where course_blueprint_id = v_blueprint_id')
    expect(migration).toContain("raise exception 'blueprint_teacher_material_ownership_required'")
  })

  it('locks exact Blueprint file ownership before saving an immutable Version', () => {
    const saveStart = migration.indexOf(
      'create or replace function public.save_course_blueprint_version_managed_atomic(',
    )
    const saveEnd = migration.indexOf('$$;', saveStart)
    const save = migration.slice(saveStart, saveEnd)
    expect(migration).toContain(
      'rename to save_course_blueprint_version_atomic_legacy_117',
    )
    expect(save).toContain('blueprint.content_revision = p_expected_draft_revision')
    expect(save).toContain("document.value->>'source' = 'upload'")
    expect(save).toContain('object.course_blueprint_id = p_blueprint_id')
    expect(save).toContain("object.storage_bucket = 'test-documents'")
    expect(save).toContain('object.storage_path = v_path')
    expect(save).toContain(
      "v_claim->>'storage_url' is distinct from v_document->>'url'",
    )
    expect(save).toContain("object.purpose = 'teacher_test_material'")
    expect(save).toContain("object.status = 'ready'")
    expect(save).toContain('for update;')
    expect(save).toContain(
      'public.save_course_blueprint_version_atomic_legacy_117(',
    )
    expect(migration).toContain(
      'revoke all on function public.save_course_blueprint_version_atomic_legacy_117(',
    )
    expect(migration).toContain(
      'grant execute on function public.save_course_blueprint_version_managed_atomic(',
    )
    const compatibilityStart = migration.indexOf(
      'create or replace function public.save_course_blueprint_version_atomic(',
    )
    const compatibilityEnd = migration.indexOf('$$;', compatibilityStart)
    expect(migration.slice(compatibilityStart, compatibilityEnd)).toContain(
      "raise exception 'managed_blueprint_version_wrapper_required'",
    )
  })

  it('indexes permanent purge reservations by exact Storage identity', () => {
    expect(migration).toContain(
      'create index classroom_purge_objects_permanent_storage_identity',
    )
    expect(migration).toContain(
      'on public.classroom_purge_objects (storage_bucket, storage_path_sha256)',
    )
  })

  it('preserves non-retryable relational finalizer failures', () => {
    const finalizerStart = migration.indexOf(
      'create or replace function public.finalize_hot_archived_classroom_purge(',
    )
    const finalizerEnd = migration.indexOf('$$;', finalizerStart)
    const finalizer = migration.slice(finalizerStart, finalizerEnd)

    expect(finalizer).toContain("v_retryable := coalesce((v_result ->> 'retryable')::boolean, true)")
    expect(finalizer).toContain('retryable = v_retryable')
    expect(finalizer).toContain("'retryable', v_retryable")
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
