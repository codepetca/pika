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
  it('gives every object exactly one stable classroom scope or Blueprint owner', () => {
    expect(migration).toContain('create table public.managed_storage_objects')
    expect(migration).toContain(
      'check (num_nonnulls(classroom_id, course_blueprint_id) = 1)',
    )
    expect(migration).not.toContain('cold_classroom_id')
    expect(migration).not.toContain('cold_archive_id')
    expect(migration).not.toContain('managed_storage_objects_classroom_id_fkey')
    expect(migration).toContain('classroom UUID that survives hot/cold transitions')
    expect(migration).toContain('create or replace function public.guard_managed_storage_scope_owner()')
    expect(migration).toContain("raise exception 'managed_storage_classroom_scope_invalid'")
    expect(migration).toContain(
      'create or replace function public.guard_managed_storage_identity_immutable()',
    )
    expect(migration).toContain("raise exception 'managed_storage_identity_immutable'")
    expect(migration).toContain("raise exception 'managed_storage_owner_immutable'")
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

  it('reserves mismatch cleanup before removal and retries only after authoritative absence', () => {
    const failureStart = migration.indexOf(
      'create or replace function public.fail_course_blueprint_storage_copy(',
    )
    const failureEnd = migration.indexOf('$$;', failureStart)
    const failure = migration.slice(failureStart, failureEnd)

    const cleanupReservation = failure.indexOf(
      "p_error_code = 'blueprint_storage_copy_cleanup_started'",
    )
    const cleanupCompletion = failure.indexOf(
      "p_error_code = 'blueprint_storage_copy_target_removed'",
    )
    expect(cleanupReservation).toBeGreaterThanOrEqual(0)
    expect(cleanupCompletion).toBeGreaterThan(cleanupReservation)
    expect(failure).toContain('item.lease_expires_at > clock_timestamp()')
    expect(failure).toContain("last_error_code = 'blueprint_storage_copy_cleanup_processing'")
    expect(failure).toContain('public.managed_storage_exact_lock(')
    expect(failure).toContain('select 1 from storage.objects object')
    expect(failure).toContain("raise exception 'blueprint_storage_copy_target_still_present'")
    expect(failure).toContain("last_error_code = 'blueprint_storage_copy_cleanup_failed'")

    const adoptionStart = migration.indexOf(
      'create or replace function public.adopt_course_blueprint_storage_copies(',
    )
    const adoptionEnd = migration.indexOf('$$;', adoptionStart)
    const adoption = migration.slice(adoptionStart, adoptionEnd)
    expect(adoption).toContain('public.managed_storage_exact_lock(')
    expect(adoption).toContain('from storage.objects object')
    expect(adoption).toContain("raise exception 'blueprint_storage_copy_target_missing'")

    const storageGuardStart = migration.indexOf(
      'create or replace function public.enforce_managed_storage_object_ownership()',
    )
    const storageGuardEnd = migration.indexOf('$$;', storageGuardStart)
    const storageGuard = migration.slice(storageGuardStart, storageGuardEnd)
    expect(storageGuard).toContain(
      "copy.last_error_code like 'blueprint_storage_copy_cleanup_%'",
    )
    expect(storageGuard).toContain(
      "reconciliation.last_error_code like 'legacy_blueprint_reconciliation_cleanup_%'",
    )
    expect(storageGuard).toContain("raise exception 'managed_storage_write_not_allowed'")
  })

  it('moves a verified legacy Classroom source to Blueprint ownership without mutating Versions', () => {
    const reconciliationStart = migration.indexOf(
      'create or replace function public.adopt_legacy_blueprint_classroom_storage_reconciliation(',
    )
    const reconciliationEnd = migration.indexOf('$$;', reconciliationStart)
    const reconciliation = migration.slice(reconciliationStart, reconciliationEnd)

    expect(migration).toContain('create table public.legacy_blueprint_classroom_storage_reconciliations')
    expect(reconciliation).toContain("status <> 'copied'")
    expect(reconciliation).toContain(
      'public.managed_storage_exact_lock(v_row.target_storage_bucket, v_row.target_storage_path)',
    )
    expect(reconciliation).toContain("classroom_id = null, course_blueprint_id = v_row.blueprint_id")
    expect(reconciliation).toContain(
      "set_config('pika.managed_storage_owner_reconciliation', 'on', true)",
    )
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

    const failureStart = migration.indexOf(
      'create or replace function public.fail_legacy_blueprint_classroom_storage_reconciliation(',
    )
    const failureEnd = migration.indexOf('$$;', failureStart)
    const failure = migration.slice(failureStart, failureEnd)
    expect(failure).toContain("p_error_code = 'legacy_blueprint_reconciliation_cleanup_started'")
    expect(failure).toContain(
      "last_error_code = 'legacy_blueprint_reconciliation_cleanup_processing'",
    )
    expect(failure).toContain("p_error_code = 'legacy_blueprint_reconciliation_target_removed'")
    expect(failure).toContain("raise exception 'legacy_blueprint_reconciliation_target_still_present'")
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

  it('restores exact ownership under the same stable classroom scope', () => {
    expect(migration).toContain('create table public.classroom_archive_restore_managed_objects')
    expect(migration).toContain('create or replace function public.begin_classroom_archive_restore_managed_v2')
    expect(migration).toContain('Managed restore reservation conflicts')
    expect(migration).toContain('operation.snapshot_expires_at')
    expect(migration).toContain('stage_classroom_archive_object_upload_legacy_117')
    expect(migration).toContain('Managed restore upload cleanup missing')
    expect(migration).toContain('complete_classroom_archive_restore_legacy_117')
    expect(migration).toContain('create or replace function public.complete_classroom_archive_source_object_cleanup')
    expect(migration).toContain('Classroom archive source object is still present')
    expect(migration).toContain('create or replace function public.guard_cold_classroom_scope_delete')
    expect(migration).toContain('cold_classroom_deletion_not_implemented')
    expect(migration).not.toContain('release_cold_managed_storage_on_restore')
    expect(migration).toContain("'pika.classroom_archive_restore_operation_id'")
    expect(migration).toContain('where classroom.id = old.classroom_id')
    const cleanupStart = migration.indexOf(
      'create or replace function public.complete_classroom_archive_source_object_cleanup',
    )
    const cleanupEnd = migration.indexOf('$$;', cleanupStart)
    const cleanup = migration.slice(cleanupStart, cleanupEnd)
    expect(cleanup).toContain("p_storage_path like '/%'")
    expect(cleanup).toContain("'..' = any(string_to_array(p_storage_path, '/'))")
    const adoptionStart = migration.indexOf(
      'create or replace function public.adopt_managed_storage_upload(',
    )
    const adoptionEnd = migration.indexOf('$$;', adoptionStart)
    const adoption = migration.slice(adoptionStart, adoptionEnd)
    expect(adoption).toContain('from public.classroom_cold_tombstones tombstone')
    expect(adoption).toContain("operation.operation_type = 'restore'")
    expect(adoption).toContain("operation.status = 'snapshot_ready'")
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

  it('preserves the immutable classroom scope when compaction deletes the hot root', () => {
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

    expect(compactionWrapper).toBeGreaterThanOrEqual(0)
    expect(compactionContext).toBeGreaterThan(compactionWrapper)
    expect(legacyCompaction).toBeGreaterThan(compactionContext)
    expect(migration).not.toContain('transfer_classroom_managed_storage_to_cold')
    expect(migration).not.toContain('classroom_cold_managed_storage_coverage')
    expect(migration).toContain('files retain this stable classroom scope')
    expect(migration).toContain('cold_classroom_deletion_not_implemented')
    expect(migration).toContain("'pika.classroom_archive_compaction_operation_id'")
  })

  it('uses positive transaction-local archive maintenance markers', () => {
    expect(migration).toContain(
      "current_setting('pika.classroom_archive_compaction', true) = 'on'",
    )
    expect(migration).toContain(
      "current_setting('pika.classroom_archive_restore', true) = 'on'",
    )
    expect(migration).not.toContain(
      "current_setting('pika.classroom_archive_compaction', true) <> 'on'",
    )
    expect(migration).not.toContain(
      "current_setting('pika.classroom_archive_restore', true) <> 'on'",
    )
  })

  it('permits verified compaction to retain the stable scope while ordinary deletes stay guarded', () => {
    const wrapper = migration.indexOf(
      'create or replace function public.complete_classroom_archive_compaction(',
    )
    const dryRunMarker = migration.indexOf(
      "set_config('pika.classroom_archive_compaction_dry_run', 'on', true)",
      wrapper,
    )
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

    expect(migration).toContain('references public.classrooms (id) on delete cascade')
    expect(dryRunMarker).toBeGreaterThan(wrapper)
    expect(migration.slice(dryRunMarker, deleteGuard)).not.toContain('set constraints')
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

  it('uses a non-blocking trigger fence to break lifecycle/row lock inversions', () => {
    expect(migration).toContain('create or replace function public.classroom_purge_try_lock')
    expect(migration).toContain('pg_try_advisory_xact_lock(')
    expect(migration).toContain('create or replace function public.guard_classroom_purge_lifecycle')
    expect(migration).toContain("raise exception 'classroom_operation_busy' using errcode = '40001'")
    const resourceGuardStart = migration.indexOf(
      'create or replace function public.reject_classroom_resource_change_during_purge()',
    )
    const resourceGuardEnd = migration.indexOf('$$;', resourceGuardStart)
    expect(migration.slice(resourceGuardStart, resourceGuardEnd)).toContain(
      'perform public.guard_classroom_purge_lifecycle(',
    )
    const managedGuardStart = migration.indexOf(
      'create or replace function public.reject_managed_storage_change_during_purge()',
    )
    const managedGuardEnd = migration.indexOf('$$;', managedGuardStart)
    expect(migration.slice(managedGuardStart, managedGuardEnd)).toContain(
      'perform public.guard_classroom_purge_lifecycle(',
    )
    for (const ledger of [
      'classroom_archive_object_upload_cleanup',
      'classroom_gradex_extract_cleanup',
      'classroom_archive_source_object_cleanup',
    ]) {
      expect(migration).toContain(`'${ledger}'`)
    }
    expect(migration).toContain(
      "for each row execute function public.reject_classroom_operation_during_purge()",
    )
  })

  it('loads snapshot-sync rows without an invalid record/scalar INTO list', () => {
    expect(migration).toContain('select test.*\n  into v_test')
    expect(migration).toContain('select test.classroom_id into v_classroom_id')
    expect(migration).toContain('perform public.classroom_purge_lock(v_classroom_id)')
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
    expect(cleanup).toContain('where id = p_resource_id and classroom_id = p_classroom_id')
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

  it('does not introduce a second purge engine for Course Blueprint deletion', () => {
    expect(migration).not.toContain(
      'create or replace function public.begin_course_blueprint_managed_deletion',
    )
    expect(migration).not.toContain(
      'create or replace function public.claim_course_blueprint_managed_cleanup',
    )
    expect(migration).not.toContain(
      'create or replace function public.finalize_course_blueprint_managed_deletion',
    )
    expect(migration).toContain(
      'course_blueprint_id uuid references public.course_blueprints (id) on delete restrict',
    )
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
    const triggerStart = migration.indexOf(
      'create or replace function public.enforce_managed_storage_object_ownership()',
    )
    const triggerEnd = migration.indexOf('$$;', triggerStart)
    const trigger = migration.slice(triggerStart, triggerEnd)
    const permanentReservation = trigger.indexOf(
      "and v_bucket in (\n      'assignment-artifacts',",
    )
    const managedSourceEarlyReturn = trigger.indexOf(
      "if v_bucket not in (\n    'assignment-artifacts',",
    )
    expect(permanentReservation).toBeGreaterThanOrEqual(0)
    expect(trigger).toContain("'classroom-archives'")
    expect(trigger).toContain("'gradex-analytics-extracts'")
    expect(permanentReservation).toBeLessThan(managedSourceEarlyReturn)
  })

  it('stops active purge claims and finalization when either rollout gate is disabled', () => {
    const claimStart = migration.indexOf(
      'create or replace function public.claim_classroom_purge_object(',
    )
    const claimEnd = migration.indexOf('$$;', claimStart)
    const claim = migration.slice(claimStart, claimEnd)
    const finalizerStart = migration.indexOf(
      'create or replace function public.finalize_hot_archived_classroom_purge(',
    )
    const finalizerEnd = migration.indexOf('$$;', finalizerStart)
    const finalizer = migration.slice(finalizerStart, finalizerEnd)
    const beginStart = migration.indexOf(
      'create or replace function public.begin_hot_archived_classroom_purge(',
    )
    const beginEnd = migration.indexOf('$$;', beginStart)
    const begin = migration.slice(beginStart, beginEnd)

    expect(claim).toContain('from public.managed_storage_settings')
    expect(claim).toContain('for share')
    expect(begin).toContain('for share')
    expect(finalizer).toContain('for share')
    expect(begin.indexOf('from public.managed_storage_settings')).toBeLessThan(
      begin.indexOf('perform public.classroom_purge_lock'),
    )
    expect(begin.indexOf('from public.managed_storage_settings')).toBeLessThan(
      begin.indexOf('from public.classroom_purge_operations'),
    )
    expect(claim.indexOf('from public.managed_storage_settings')).toBeLessThan(
      claim.indexOf('from public.classroom_purge_operations'),
    )
    expect(claim.indexOf('from public.managed_storage_settings')).toBeLessThan(
      claim.indexOf('from public.classroom_purge_objects'),
    )
    expect(finalizer.indexOf('from public.managed_storage_settings')).toBeLessThan(
      finalizer.indexOf('from public.classroom_purge_operations'),
    )
    expect(finalizer).toContain("'error_code', 'classroom_purge_disabled'")
    expect(finalizer).toContain("'error_code', 'managed_storage_enforcement_required'")
    expect(finalizer).toContain(
      'public.managed_storage_identity_sha256(\n       storage_object.bucket_id,',
    )
  })

  it('replaces the manual child-table finalizer with a root delete and exact postconditions', () => {
    const finalizerStart = migration.indexOf(
      'create or replace function public.finalize_hot_archived_classroom_purge(',
    )
    const finalizerEnd = migration.indexOf('$$;', finalizerStart)
    const finalizer = migration.slice(finalizerStart, finalizerEnd)

    expect(finalizer).toContain('delete from public.classrooms classroom')
    expect(finalizer).toContain('join public.classroom_purge_resources snapshot')
    expect(finalizer).toContain("raise exception 'classroom_purge_postcondition_%'")
    expect(finalizer).not.toContain(
      'public.finalize_hot_archived_classroom_purge_legacy_117(',
    )
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

  it('reconciles operational ledgers before managed ownership and the classroom root', () => {
    const finalizerStart = migration.indexOf(
      'create or replace function public.finalize_hot_archived_classroom_purge(',
    )
    const finalizerEnd = migration.indexOf('$$;', finalizerStart)
    const finalizer = migration.slice(finalizerStart, finalizerEnd)
    const operationalDelete = finalizer.indexOf(
      'delete from public.classroom_gradex_extract_cleanup cleanup',
    )
    const managedDelete = finalizer.indexOf(
      'delete from public.managed_storage_objects object',
    )
    const rootDelete = finalizer.indexOf('delete from public.classrooms classroom')
    const postcondition = finalizer.indexOf("raise exception 'classroom_purge_postcondition_%'")

    expect(operationalDelete).toBeGreaterThanOrEqual(0)
    expect(managedDelete).toBeGreaterThan(operationalDelete)
    expect(rootDelete).toBeGreaterThan(managedDelete)
    expect(postcondition).toBeGreaterThan(rootDelete)
    expect(finalizer).toContain('classroom_purge_storage_owner_drift')
    expect(migration).toContain('reject_classroom_delete_with_managed_storage')
  })

  it('structurally owns purge-only assignment save operations without changing archive v2', () => {
    const guardStart = migration.indexOf(
      'create or replace function public.guard_assignment_doc_save_operation_lifecycle()',
    )
    const guardEnd = migration.indexOf('$$;', guardStart)
    const guard = migration.slice(guardStart, guardEnd)
    const missingParent = guard.indexOf('if not found then')
    const cascadeDelete = guard.indexOf("if tg_op = 'DELETE' then", missingParent)
    const cascadeReturn = guard.indexOf('return old;', cascadeDelete)
    const rejectMissingParent = guard.indexOf(
      "raise exception 'assignment_doc_not_found'",
      missingParent,
    )

    expect(migration).toContain(
      'assignment_doc_save_operations_assignment_doc_id_fkey',
    )
    expect(migration).toContain(
      'references public.assignment_docs (id)\n  on delete cascade',
    )
    expect(migration).toContain(
      'idx_assignment_doc_save_operations_assignment_doc',
    )
    expect(migration).toContain(
      "select p_operation_id, 'assignment_doc_save_operations', operation.id",
    )
    expect(migration).toContain('assignment_doc_save_operation_lifecycle_guard')
    expect(missingParent).toBeGreaterThanOrEqual(0)
    expect(cascadeDelete).toBeGreaterThan(missingParent)
    expect(cascadeReturn).toBeGreaterThan(cascadeDelete)
    expect(rejectMissingParent).toBeGreaterThan(cascadeReturn)
  })

  it('makes managed ownership authoritative for all five buckets and operational ledgers', () => {
    for (const bucket of [
      'assignment-artifacts',
      'submission-images',
      'test-documents',
      'classroom-archives',
      'gradex-analytics-extracts',
    ]) {
      expect(migration).toContain(`'${bucket}'`)
    }
    for (const table of [
      'classroom_archives',
      'classroom_archive_operations',
      'classroom_archive_object_upload_cleanup',
      'classroom_archive_source_object_cleanup',
      'classroom_gradex_extracts',
      'classroom_gradex_extract_cleanup',
      'assignment_artifact_storage_cleanup',
      'test_document_snapshot_storage_cleanup',
    ]) {
      expect(migration).toContain(
        `alter table public.${table}\n  add column managed_object_id uuid`,
      )
    }

    const beginStart = migration.indexOf(
      'create or replace function public.begin_hot_archived_classroom_purge(',
    )
    const beginEnd = migration.indexOf('$$;', beginStart)
    const begin = migration.slice(beginStart, beginEnd)
    expect(begin).toContain('from public.managed_storage_objects object')
    expect(begin).not.toContain('from public.classroom_archives archive')
    expect(begin).not.toContain('from public.classroom_gradex_extracts extract')
    expect(begin).not.toContain('from public.classroom_archive_source_object_cleanup cleanup')
  })

  it('creates immutable archive and Gradex rows with their managed owner already attached', () => {
    const attachmentStart = migration.indexOf(
      'create or replace function public.prepare_immutable_operational_managed_owner()',
    )
    const attachmentEnd = migration.indexOf('$$;', attachmentStart)
    const attachment = migration.slice(attachmentStart, attachmentEnd)
    const archiveCompletionStart = migration.indexOf(
      'create or replace function public.complete_classroom_archive_export_v2(',
    )
    const archiveCompletionEnd = migration.indexOf('$$;', archiveCompletionStart)
    const archiveCompletion = migration.slice(archiveCompletionStart, archiveCompletionEnd)
    const gradexCompletionStart = migration.indexOf(
      'create or replace function public.complete_classroom_gradex_extract(',
    )
    const gradexCompletionEnd = migration.indexOf('$$;', gradexCompletionStart)
    const gradexCompletion = migration.slice(gradexCompletionStart, gradexCompletionEnd)

    expect(attachment).toContain("when 'classroom_archives' then 'classroom_archive'")
    expect(attachment).toContain("when 'classroom_gradex_extracts' then 'gradex_extract'")
    expect(attachment).toContain("object.resource_type = 'classroom_archive_operation'")
    expect(attachment).toContain("object.status = 'ready'")
    expect(attachment).toContain('new.managed_object_id := v_managed_object_id')
    expect(migration).toContain('classroom_archives_prepare_managed_owner')
    expect(migration).toContain('classroom_gradex_extracts_prepare_managed_owner')
    expect(migration).toContain(
      'revoke all on function public.prepare_immutable_operational_managed_owner()',
    )
    expect(archiveCompletion).toContain('archive.managed_object_id = v_object.id')
    expect(archiveCompletion).not.toContain('update public.classroom_archives')
    expect(gradexCompletion).toContain('extract.managed_object_id = v_object.id')
    expect(gradexCompletion).not.toContain('update public.classroom_gradex_extracts')
  })

  it('keeps operational upload CASE expressions inside the PL/pgSQL IF expression', () => {
    const uploadStart = migration.indexOf(
      'create or replace function public.begin_managed_storage_upload(',
    )
    const uploadEnd = migration.indexOf('$$;', uploadStart)
    const upload = migration.slice(uploadStart, uploadEnd)

    expect(upload).toContain('p_storage_bucket <> (case p_purpose')
    expect(upload).toContain('v_operation.operation_type <> (case p_purpose')
    expect(upload).not.toContain('<> case p_purpose')
  })

  it('loads purge object composites through a single record target', () => {
    for (const functionName of [
      'complete_classroom_purge_object',
      'fail_classroom_purge_object',
    ]) {
      const functionStart = migration.indexOf(
        `create or replace function public.${functionName}(`,
      )
      const functionEnd = migration.indexOf('$$;', functionStart)
      const functionSql = migration.slice(functionStart, functionEnd)

      expect(functionSql).toContain('v_candidate record;')
      expect(functionSql).toContain(
        'select object as purge_object, operation.classroom_id as classroom_id into v_candidate',
      )
      expect(functionSql).toContain('v_object := v_candidate.purge_object;')
      expect(functionSql).toContain('v_classroom_id := v_candidate.classroom_id;')
    }
    expect(migration).not.toContain(
      'select object, operation.classroom_id into v_object, v_classroom_id',
    )
  })

  it('turns legacy file cleanup ledgers into fenced delegates of managed ownership', () => {
    const bridgeStart = migration.indexOf(
      'create or replace function public.prepare_legacy_managed_cleanup_ledger_change()',
    )
    const bridgeEnd = migration.indexOf('$$;', bridgeStart)
    const bridge = migration.slice(bridgeStart, bridgeEnd)
    const conflictStart = migration.indexOf(
      'create or replace function public.classroom_purge_conflict(',
    )
    const conflictEnd = migration.indexOf('$$;', conflictStart)
    const conflict = migration.slice(conflictStart, conflictEnd)
    const finalizerStart = migration.indexOf(
      'create or replace function public.finalize_hot_archived_classroom_purge(',
    )
    const finalizerEnd = migration.indexOf('$$;', finalizerStart)
    const finalizer = migration.slice(finalizerStart, finalizerEnd)

    expect(bridge).toContain("when 'assignment_artifact_storage_cleanup' then 'assignment-artifacts'")
    expect(bridge).toContain("when 'test_document_snapshot_storage_cleanup' then 'test-documents'")
    expect(bridge).toContain('new.managed_object_id := v_exact_object_id')
    expect(bridge).toContain('perform public.guard_classroom_purge_lifecycle(v_classroom_id)')
    expect(conflict).toContain('from public.assignment_artifact_storage_cleanup cleanup')
    expect(conflict).toContain('from public.test_document_snapshot_storage_cleanup cleanup')
    expect(finalizer).toContain(
      'purge_object.managed_storage_object_id = cleanup.managed_object_id',
    )
    expect(migration).toContain(
      'revoke all on function public.prepare_legacy_managed_cleanup_ledger_change()',
    )
    const completionStart = migration.indexOf(
      'create or replace function public.complete_managed_storage_cleanup(',
    )
    const completionEnd = migration.indexOf('$$;', completionStart)
    const completion = migration.slice(completionStart, completionEnd)
    expect(completion).toContain(
      'delete from public.assignment_artifact_storage_cleanup',
    )
    expect(completion).toContain(
      'delete from public.test_document_snapshot_storage_cleanup',
    )
    expect(completion).toContain(
      "cleanup.last_error_code = 'archive_source_managed_cleanup_pending'",
    )
    expect(completion).toContain('set next_attempt_at = clock_timestamp()')
    expect(migration).toContain(
      'return not exists (\n    select 1 from public.assignment_artifact_storage_cleanup',
    )
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
