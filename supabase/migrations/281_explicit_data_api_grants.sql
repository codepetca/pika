-- Make the existing server-only Data API contract explicit before the platform
-- stops automatically granting access to new public tables and sequences.
-- Audited against a pristine replay of migrations 001–280 on PostgreSQL 17.
-- This is an additive, exact per-object restatement: retain later migrations'
-- RPC-only writes, private owners, RLS, and all function/default-function ACLs.
-- Future public tables/sequences must declare their grants in their own migration.
begin;
set local lock_timeout = '5s';

-- The supported postgres migration creator opts out of automatic relation grants.
-- Schema-local revokes cannot undo a global default grant. Refuse such drift
-- rather than silently broadening this change to other schemas.
do $$
begin
  if exists (
    select 1 from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 0 and d.defaclobjtype in ('r', 'S')
      and d.defaclrole = 'postgres'::regrole
      and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
  ) then
    raise exception 'Global relation default grants require a separate scoped review';
  end if;
end;
$$;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;

-- Existing privileges, named individually so no later object is auto-exposed.
-- No direct service_role privileges: private.attendance_membership_generations.
-- No direct service_role privileges: private.classroom_creation_entitlement_settings.
-- No direct service_role privileges: private.classroom_test_quota_settings.
-- No direct service_role privileges: private.pal_classroom_signal_settings.
-- No direct service_role privileges: private.pal_membership_generations.
-- No direct service_role privileges: private.pal_membership_outbox.
-- No direct service_role privileges: private.pal_membership_settings.
-- No direct service_role privileges: private.pal_membership_week_configurations.
-- No direct service_role privileges: private.pal_membership_week_sync_cursor.
-- No direct service_role privileges: private.removed_academic_mutations.
-- No direct service_role privileges: private.removed_student_academic_settings.
-- No direct service_role privileges: private.removed_student_cleanup_jobs.
-- No direct service_role privileges: private.stripe_billing_settings.
-- No direct service_role privileges: private.student_provider_cleanup_bindings.
-- No direct service_role privileges: private.student_provider_cleanup_settings.
grant usage on sequence private.test_attempt_draft_revision_seq to service_role;
grant select on table public.account_plan_audit to service_role;
grant select on table public.account_plans to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.announcement_reads to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.announcements to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_drafts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_ai_grading_run_items to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_ai_grading_runs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_artifact_storage_cleanup to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_doc_history to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_doc_save_operations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_docs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_feedback_entries to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_repo_review_results to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_repo_review_runs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_repo_targets to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_submission_artifacts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_submission_requirements to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignments to service_role;
grant select on table public.attendance_check_in_facts to service_role;
grant insert, select, update on table public.attendance_classroom_qr_handles to service_role;
-- No direct service_role privileges: public.attendance_decommission_operations.
-- No direct service_role privileges: public.attendance_decommission_settings.
grant select on table public.attendance_integration_inbox to service_role;
grant insert, select, update on table public.attendance_integration_outbox to service_role;
-- No direct service_role privileges: public.attendance_integration_smoke_nonces.
-- No direct service_role privileges: public.attendance_integration_smoke_runs.
grant insert, select, update on table public.attendance_occurrence_mappings to service_role;
grant select on table public.attendance_outbox_epoch_recovery_audit to service_role;
grant insert, select on table public.attendance_override_requests to service_role;
grant insert, select, update on table public.attendance_participant_mappings to service_role;
grant insert, select on table public.attendance_principal_mappings to service_role;
grant select on table public.attendance_record_projection to service_role;
grant insert, select, update on table public.attendance_roster_mappings to service_role;
grant select on table public.attendance_session_projection to service_role;
grant insert, select on table public.attendance_status_override_events to service_role;
grant insert, select, update on table public.attendance_status_overrides to service_role;
grant select on table public.attendance_teacher_entitlement_audit to service_role;
grant select on table public.attendance_teacher_entitlements to service_role;
grant insert, select, update on table public.attendance_window_policies to service_role;
-- No direct service_role privileges: public.auth_global_rate_limits.
-- No direct service_role privileges: public.auth_rate_limits.
grant delete, select on table public.auth_sessions to service_role;
grant select on table public.billing_account_access to service_role;
grant select on table public.billing_lifecycle_audit to service_role;
grant select on table public.billing_renewal_closeouts to service_role;
grant select on table public.billing_trial_definitions to service_role;
grant select on table public.billing_trials to service_role;
grant select on table public.billing_upgrade_operations to service_role;
grant select on table public.billing_upgrade_receipts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.class_days to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_object_upload_cleanup to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_operations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_resource_contract to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_resource_contract_versions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_restore_expected_objects to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_restore_staging to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_revisions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_snapshot_actors to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archive_snapshot_resources to service_role;
grant select on table public.classroom_archive_source_object_cleanup to service_role;
grant select on table public.classroom_archive_source_object_reservations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_archives to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_cold_archive_actors to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_cold_tombstones to service_role;
grant select on table public.classroom_creation_operations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_enrollments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_gradex_extract_cleanup to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_gradex_extracts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_gradex_resource_contract to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_guided_draft_provenance to service_role;
-- No direct service_role privileges: public.classroom_join_rate_limits.
grant select on table public.classroom_purge_fences to service_role;
grant select on table public.classroom_purge_objects to service_role;
grant select on table public.classroom_purge_operations to service_role;
grant select on table public.classroom_purge_resources to service_role;
grant select on table public.classroom_purge_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_resources to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_retired_assessment_record_actors to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_retired_assessment_records to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classroom_roster to service_role;
grant select on table public.classroom_roster_student_bindings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classrooms to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.classwork_materials to service_role;
grant select on table public.cleanup_history_cron_runs to service_role;
grant select on table public.cold_classroom_purge_fences to service_role;
grant select on table public.cold_classroom_purge_resources to service_role;
grant select on table public.cold_classroom_purge_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_assessments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_assignments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_authoring_guidance_revisions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_change_proposals to service_role;
-- No direct service_role privileges: public.course_blueprint_draft_admissions.
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_editing_sessions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_lesson_templates to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_materials to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_operations to service_role;
-- No direct service_role privileges: public.course_blueprint_purge_fences.
grant select on table public.course_blueprint_purge_objects to service_role;
grant select on table public.course_blueprint_purge_operations to service_role;
grant select on table public.course_blueprint_purge_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_surveys to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprint_versions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.course_blueprints to service_role;
-- No direct service_role privileges: public.course_guide_import_rate_limits.
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.developer_feedback_candidates to service_role;
grant select on table public.effective_feature_entitlement_audit to service_role;
grant select on table public.effective_feature_entitlements to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.entries to service_role;
grant select on table public.feature_usage_reservations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gradebook_categories to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gradebook_item_scores to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gradebook_items to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gradebook_score_overrides to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gradebook_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.lesson_plan_mutation_heads to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.lesson_plans to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.log_summaries to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.managed_storage_json_references to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.managed_storage_objects to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.managed_storage_provisional_owners to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.managed_storage_readiness_findings to service_role;
grant select, update, usage on sequence public.managed_storage_readiness_findings_id_seq to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.managed_storage_readiness_runs to service_role;
grant select on table public.managed_storage_settings to service_role;
-- No direct service_role privileges: public.managed_storage_writer_revision_seq.
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pal_daily_log_week_configurations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pal_event_outbox to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.report_card_rows to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.report_cards to service_role;
grant select on table public.stripe_billing_customers to service_role;
grant select on table public.stripe_billing_event_inbox to service_role;
grant select on table public.stripe_billing_invoice_effects to service_role;
grant select on table public.stripe_billing_offering_availability to service_role;
grant select on table public.stripe_billing_offering_versions to service_role;
grant select on table public.stripe_billing_offerings to service_role;
grant select on table public.stripe_billing_subscription_audit to service_role;
grant select on table public.stripe_billing_subscription_bindings to service_role;
grant select on table public.stripe_checkout_attempts to service_role;
grant select on table public.stripe_checkout_audit to service_role;
grant select, update, usage on sequence public.stripe_checkout_audit_id_seq to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.student_profiles to service_role;
grant select on table public.student_purge_fences to service_role;
grant select on table public.student_purge_objects to service_role;
grant select on table public.student_purge_operations to service_role;
grant select on table public.student_purge_resources to service_role;
grant select on table public.student_purge_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.survey_questions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.survey_responses to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.surveys to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_ai_grading_run_items to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_ai_grading_runs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_attempt_history to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_attempts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_document_snapshot_storage_cleanup to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_focus_events to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_questions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_responses to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.test_student_availability to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tests to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_github_identities to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.users to service_role;
-- No direct service_role privileges: public.verification_codes.

commit;
