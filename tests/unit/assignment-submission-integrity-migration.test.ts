import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/099_assignment_submission_integrity_guards.sql'),
  'utf8',
).toLowerCase()
const atomicHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-atomic-assignment-submissions.sh'),
  'utf8',
).toLowerCase()
const concurrencyHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-assignment-submission-concurrency.sh'),
  'utf8',
).toLowerCase()
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8').toLowerCase()
const rolloutGuide = readFileSync(
  resolve(process.cwd(), 'docs/guidance/atomic-assignment-submission-rollout.md'),
  'utf8',
).toLowerCase()
const restoreSource = readFileSync(
  resolve(process.cwd(), 'src/lib/server/classroom-archive-restore.ts'),
  'utf8',
).toLowerCase()
const recoveryDrill = readFileSync(
  resolve(process.cwd(), 'scripts/run-classroom-archive-recovery-drill.ts'),
  'utf8',
).toLowerCase()
const vercelConfig = readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8').toLowerCase()

describe('assignment submission integrity migration', () => {
  it('locks the owning document before accepting artifact mutations', () => {
    expect(migration).toContain('guard_assignment_submission_artifact_mutation')
    expect(migration).toContain('from public.assignment_docs d')
    expect(migration).toContain('for update;')
    expect(migration).toContain('assignment_artifact_submitted_document_immutable')
    expect(migration).toContain(
      'before insert or update or delete on public.assignment_submission_artifacts',
    )
    expect(migration).toContain('create trigger aaa_guard_assignment_submission_artifact_mutation')
  })

  it('revalidates required and blocking artifacts during submission', () => {
    expect(migration).toContain('validate_assignment_submission_transition')
    expect(migration).toContain('assignment_submission_requirements_incomplete')
    expect(migration).toContain("a.validation_status in ('invalid', 'inaccessible')")
    expect(migration).toContain('when (new.is_submitted and not old.is_submitted)')
  })

  it('serializes history writes and preserves submit entries', () => {
    expect(migration).toContain('guard_assignment_doc_history_after_submit')
    expect(migration).toContain("old.trigger = 'submit' or new.trigger = 'submit'")
    expect(migration).toContain('assignment_history_after_submit_forbidden')
    expect(migration).toContain('before insert or update or delete on public.assignment_doc_history')
    expect(migration).toContain('submit_assignment_doc_atomic')
    expect(migration).toContain("'history_entry', to_jsonb(v_history)")
    expect(migration).toContain('assignment_submit_history_snapshot_invalid')
    expect(migration).toContain('and h.snapshot = v_doc.content')
    expect(migration).toContain("check (trigger in ('autosave', 'blur', 'submit', 'baseline', 'restore'))")
    expect(migration).toContain('create constraint trigger ensure_current_assignment_submit_history')
    expect(migration).toContain('deferrable initially deferred')
  })

  it('keeps archive maintenance and destructive parent cascades valid', () => {
    expect(migration).toContain("is_classroom_archive_maintenance_mode('restore')")
    expect(migration).toContain("is_classroom_archive_maintenance_mode('compaction')")
    expect(migration).toContain("if tg_op = 'delete' then\n      return old;")
    expect(migration).toContain("if p_table_name = 'assignment_docs' then")
    expect(migration).toContain("jsonb_build_object('save_session_id', null)")
    expect(migration).toContain("jsonb_build_object('save_sequence', null)")
  })

  it('attaches recovery-drill artifacts before submitting the fixture document', () => {
    const createFixture = recoveryDrill.slice(
      recoveryDrill.indexOf('async function createfixture'),
      recoveryDrill.indexOf('async function removefixture'),
    )
    const artifactInsert = createFixture.indexOf(
      "await insertfixturerow(args.supabase, 'assignment_submission_artifacts'",
    )
    const documentSubmit = createFixture.indexOf('const submitresponse = await args.supabase')
    const submitMutation = createFixture.slice(documentSubmit)
    const snapshotLoader = recoveryDrill.slice(
      recoveryDrill.indexOf('async function loadfixturesnapshot'),
      recoveryDrill.indexOf('async function readstoragebytes'),
    )
    const restoreEquality = recoveryDrill.slice(
      recoveryDrill.indexOf('const expectedrestoredrows'),
      recoveryDrill.indexOf('const restoredobjectbytes'),
    )
    const removeFixture = recoveryDrill.slice(
      recoveryDrill.indexOf('async function removefixture'),
      recoveryDrill.indexOf('async function runrecoverydrill'),
    )
    const classroomDelete = removeFixture.indexOf("await deleterows('classrooms'")
    const cleanupDelete = removeFixture.indexOf(
      "await deleterows('assignment_artifact_storage_cleanup'",
    )
    const cleanupAbsenceCheck = removeFixture.indexOf('for (const cleanuppath of cleanuppaths)')

    expect(createFixture).toContain('is_submitted: false')
    expect(artifactInsert).toBeGreaterThan(-1)
    expect(documentSubmit).toBeGreaterThan(artifactInsert)
    expect(submitMutation).toContain('is_submitted: true')
    expect(submitMutation).toContain(".eq('id', args.ids.assignment_docs)")
    expect(submitMutation).toContain(".select('id')\n    .single()")
    expect(snapshotLoader).toContain(".from('assignment_doc_history')")
    expect(snapshotLoader).toContain(".eq('assignment_doc_id', ids.assignment_docs)")
    expect(snapshotLoader).toContain('assignment_doc_history: z.record')
    expect(restoreEquality).toContain('const actualrestoredrows = await loadfixturesnapshot')
    expect(restoreEquality).toContain('canonicaljsonstringify(actualrestoredrows)')
    expect(classroomDelete).toBeGreaterThan(-1)
    expect(cleanupDelete).toBeGreaterThan(classroomDelete)
    expect(cleanupAbsenceCheck).toBeGreaterThan(cleanupDelete)
    expect(removeFixture.slice(cleanupAbsenceCheck)).toContain(
      "'assignment_artifact_storage_cleanup',\n        'storage_path',\n        cleanuppath",
    )
  })

  it('saves draft content and history in one database transaction', () => {
    expect(migration).toContain('save_assignment_doc_atomic')
    expect(migration).toContain('assignment_doc_revision_required')
    expect(migration).toContain('p_save_session_id')
    expect(migration).toContain('p_metric_session_id')
    expect(migration).toContain(
      'jsonb, jsonb, integer, integer, uuid, bigint, bigint, integer, integer',
    )
    expect(migration).toContain('insert into public.assignment_doc_history')
    expect(migration).toContain("elsif p_trigger <> 'restore'")
    expect(migration).toContain('or v_effective_keystroke_count > 0')
    expect(migration).toContain('create table if not exists public.assignment_doc_save_operations')
    expect(migration).toContain('content_sha256 text not null')
    expect(migration).toContain('document_updated_at timestamptz not null')
    expect(migration).toContain('metric_session_id uuid not null')
    expect(migration).toContain('cleanup_assignment_doc_save_operations')
    expect(migration).toContain('max(operation.keystroke_count)')
    expect(migration).toContain("'error_code', 'assignment_doc_save_replayed'")
  })

  it('locks requirement artifacts before archive revision triggers and unsubmits atomically', () => {
    expect(migration).toContain('where artifact.requirement_id = old.id')
    expect(migration).toContain('order by artifact.id')
    expect(migration).toContain('unsubmit_assignment_doc_atomic')
    expect(migration).toContain('assignment_doc_returned')
    expect(migration).toContain('assignment_submitted_document_identity_immutable')
    expect(migration).toContain('assignment_submitted_at_immutable')
  })

  it('deletes artifact rows before durable, leased Storage cleanup', () => {
    expect(migration).toContain('create table if not exists public.assignment_artifact_storage_cleanup')
    expect(migration).toContain('after delete or update of storage_path on public.assignment_submission_artifacts')
    expect(migration).toContain('delete_assignment_submission_artifact_atomic')
    expect(migration).toContain('claim_assignment_artifact_storage_cleanup')
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('fail_assignment_artifact_storage_cleanup')
    expect(migration).toContain('p_delay_seconds integer default 0')
    expect(migration).toContain('artifact.storage_path = cleanup.storage_path')
    expect(migration).toContain(
      'grant select, insert, delete on table public.assignment_artifact_storage_cleanup to service_role',
    )
    expect(migration).toContain('least(cleanup.attempt_count, 6)')
    expect(vercelConfig).toContain('/api/cron/assignment-artifact-storage-cleanup')
  })

  it('uses artifact-before-document locking for student and teacher mutations', () => {
    const combinedUpdate = migration.slice(
      migration.indexOf('create or replace function public.update_assignment_with_submission_requirements_atomic'),
    )
    expect(combinedUpdate.indexOf('for v_artifact_id in')).toBeGreaterThanOrEqual(0)
    expect(combinedUpdate.indexOf('for v_artifact_id in')).toBeLessThan(
      combinedUpdate.indexOf('for v_doc_id in'),
    )
    expect(concurrencyHarness).toContain('run_teacher_artifact_race')
    expect(concurrencyHarness).toContain('run_old_replace_new_combined_race')
  })

  it('keeps restore and migration-first teacher lock ordering deterministic', () => {
    const restoreWrapper = migration.slice(
      migration.indexOf('create or replace function public.complete_classroom_archive_restore'),
      migration.indexOf('drop function if exists public.save_assignment_doc_atomic'),
    )
    expect(restoreWrapper.indexOf('set constraints public.ensure_current_assignment_submit_history immediate')).toBeLessThan(
      restoreWrapper.indexOf("set_config(\n    'pika.classroom_archive_restore'"),
    )
    const legacyReplace = migration.slice(
      migration.indexOf('create or replace function public.replace_assignment_submission_requirements_atomic'),
      migration.indexOf('create or replace function public.update_assignment_with_submission_requirements_atomic'),
    )
    expect(legacyReplace.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      legacyReplace.indexOf('update public.assignment_submission_requirements'),
    )
  })

  it('backfills the current authoritative submission and keeps description in combined updates', () => {
    expect(migration).toContain("h.created_at >= coalesce(d.submitted_at, '-infinity'::timestamptz)")
    expect(migration).toContain('and h.snapshot = d.content')
    expect(migration).toContain("when p_updates ? 'description' then p_updates->>'description'")
    expect(migration).toContain('silently preserve authoritative submit rows')
  })

  it('does not expose trigger functions as callable APIs', () => {
    expect(migration).toContain(
      'revoke all on function public.guard_assignment_submission_artifact_mutation() from public, anon, authenticated, service_role;',
    )
    expect(migration).toContain(
      'revoke all on function public.validate_assignment_submission_transition() from public, anon, authenticated, service_role;',
    )
    expect(migration).toContain(
      'revoke all on function public.guard_assignment_doc_history_after_submit() from public, anon, authenticated, service_role;',
    )
    expect(migration).toContain(
      'grant execute on function public.save_assignment_doc_atomic',
    )
    expect(migration).toContain(
      'grant execute on function public.submit_assignment_doc_atomic',
    )
  })

  it('proves the migration-first compatibility and CI rollout contract', () => {
    expect(rolloutGuide).toContain('migration 099 must be applied and verified before the application is deployed')
    expect(rolloutGuide).toContain('drain every previous-version application instance')
    expect(rolloutGuide).toContain('previous-version archive restores are accepted')
    expect(rolloutGuide).toContain('leave migration 099 in place if the application is rolled back')
    expect(concurrencyHarness).toContain('for migration in "$root"/supabase/migrations/*.sql')
    expect(concurrencyHarness).toContain('run_old_submit_new_requirement_rpc_race')
    expect(atomicHarness).toContain('assignment rpc privilege contract is invalid')
    expect(atomicHarness).toContain('pre-099 assignment archive row was not normalized')
    expect(workflow).toContain('bash scripts/check-atomic-assignment-submissions.sh')
    expect(workflow).toContain('bash scripts/check-assignment-submission-concurrency.sh')
    expect(restoreSource).toContain("'083_resumable_classroom_archive_restore' as const")
    expect(restoreSource).toContain("id: 'classroom-archive-v1-082-to-083'")
  })
})
