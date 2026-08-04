-- Scope existing classroom-content integrity triggers so the purge finalizer
-- can delete its exact, fenced membership without weakening normal writes.
-- The finalizer sets pika.classroom_purge_finalize transaction-locally.

drop trigger if exists aaa_guard_assignment_doc_history_after_submit
  on public.assignment_doc_history;
create trigger aaa_guard_assignment_doc_history_after_submit
before insert or update or delete on public.assignment_doc_history
for each row
when (
  current_setting('pika.classroom_purge_finalize', true) is distinct from 'on'
)
execute function public.guard_assignment_doc_history_after_submit();

drop trigger if exists aaa_guard_assignment_submission_artifact_mutation
  on public.assignment_submission_artifacts;
create trigger aaa_guard_assignment_submission_artifact_mutation
before insert or update or delete on public.assignment_submission_artifacts
for each row
when (
  current_setting('pika.classroom_purge_finalize', true) is distinct from 'on'
)
execute function public.guard_assignment_submission_artifact_mutation();

drop trigger if exists enqueue_deleted_assignment_artifact_storage_cleanup
  on public.assignment_submission_artifacts;
create trigger enqueue_deleted_assignment_artifact_storage_cleanup
after delete or update of storage_path on public.assignment_submission_artifacts
for each row
when (
  current_setting('pika.classroom_purge_finalize', true) is distinct from 'on'
)
execute function public.enqueue_deleted_assignment_artifact_storage_cleanup();

drop trigger if exists aaa_guard_assignment_submission_requirement_mutation
  on public.assignment_submission_requirements;
create trigger aaa_guard_assignment_submission_requirement_mutation
before insert or update or delete on public.assignment_submission_requirements
for each row
when (
  current_setting('pika.classroom_purge_finalize', true) is distinct from 'on'
)
execute function public.guard_assignment_submission_requirement_mutation();

drop trigger if exists enqueue_obsolete_test_document_snapshots
  on public.tests;
create trigger enqueue_obsolete_test_document_snapshots
after update of documents or delete on public.tests
for each row
when (
  current_setting('pika.classroom_purge_finalize', true) is distinct from 'on'
)
execute function public.enqueue_obsolete_test_document_snapshots();

comment on trigger aaa_guard_assignment_doc_history_after_submit
  on public.assignment_doc_history is
  'Preserves submit-history integrity during normal writes; exact fenced classroom purge bypasses it.';
comment on trigger aaa_guard_assignment_submission_artifact_mutation
  on public.assignment_submission_artifacts is
  'Preserves submitted-artifact integrity during normal writes; exact fenced classroom purge bypasses it.';
comment on trigger enqueue_deleted_assignment_artifact_storage_cleanup
  on public.assignment_submission_artifacts is
  'Queues normal artifact cleanup; purge owns its sealed object ledger and bypasses duplicate cleanup.';
comment on trigger aaa_guard_assignment_submission_requirement_mutation
  on public.assignment_submission_requirements is
  'Preserves submitted-requirement integrity during normal writes; exact fenced classroom purge bypasses it.';
comment on trigger enqueue_obsolete_test_document_snapshots
  on public.tests is
  'Queues normal test snapshot cleanup; purge owns its sealed object ledger and bypasses duplicate cleanup.';
