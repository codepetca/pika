import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/087_atomic_assignment_feedback_returns.sql'),
  'utf8',
)
const service = readFileSync(
  resolve(process.cwd(), 'src/lib/server/assignment-returns.ts'),
  'utf8',
)
const gradeService = readFileSync(
  resolve(process.cwd(), 'src/lib/server/assignment-grades.ts'),
  'utf8',
)

describe('atomic assignment feedback return migration', () => {
  it('defines service-role-only RPCs with fixed search paths', () => {
    expect(migration).toContain('create or replace function public.return_assignment_feedback_atomic')
    expect(migration).toContain('create or replace function public.return_assignment_docs_with_feedback_atomic')
    expect(migration).toContain('create or replace function public.save_assignment_grades_atomic')
    expect(migration).toContain('create or replace function public.save_assignment_ai_grade_atomic')
    expect(migration).toContain('create or replace function public.save_assignment_ai_grades_atomic')
    expect(migration).toContain('create or replace function public.create_assignment_ai_grading_run_atomic')
    expect(migration).toContain('create or replace function public.finalize_assignment_ai_grading_item_atomic')
    expect(migration).toContain('create or replace function public.complete_assignment_repo_review_run_atomic')
    expect(migration.match(/security definer/g)).toHaveLength(8)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(8)
    expect(migration).toContain('revoke all on function public.save_assignment_grades_atomic')
    expect(migration).toContain('revoke all on function public.save_assignment_ai_grade_atomic')
    expect(migration).toContain('revoke all on function public.save_assignment_ai_grades_atomic')
    expect(migration).toContain('revoke all on function public.return_assignment_feedback_atomic')
    expect(migration).toContain('revoke all on function public.return_assignment_docs_with_feedback_atomic')
    expect(migration).toContain('grant execute on function public.return_assignment_feedback_atomic')
    expect(migration).toContain('grant execute on function public.return_assignment_docs_with_feedback_atomic')
    expect(migration).toContain('revoke all on function public.finalize_assignment_ai_grading_item_atomic')
    expect(migration).toContain('revoke all on function public.complete_assignment_repo_review_run_atomic')
  })

  it('serializes each feedback return before checking its document version', () => {
    const returnStart = migration.indexOf('create or replace function public.return_assignment_feedback_atomic')
    const returnEnd = migration.indexOf('create or replace function public.return_assignment_docs_with_feedback_atomic')
    const singleReturn = migration.slice(returnStart, returnEnd)
    const lock = singleReturn.indexOf('pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0))')
    const versionCheck = singleReturn.indexOf('v_doc.updated_at is distinct from p_expected_doc_updated_at')
    const historyInsert = singleReturn.indexOf('insert into public.assignment_feedback_entries')
    const docUpdate = singleReturn.indexOf('update public.assignment_docs d')

    expect(lock).toBeGreaterThan(-1)
    expect(versionCheck).toBeGreaterThan(lock)
    expect(historyInsert).toBeGreaterThan(versionCheck)
    expect(docUpdate).toBeGreaterThan(historyInsert)
    expect(singleReturn).toContain('and v_doc.teacher_feedback_draft is null')
    expect(singleReturn).toContain('and v_doc.feedback = v_feedback')
    expect(singleReturn).toContain('on conflict (assignment_id, student_id) do nothing')
  })

  it('serializes a selected batch before classification and commits history with visibility changes', () => {
    const batchStart = migration.indexOf('create or replace function public.return_assignment_docs_with_feedback_atomic')
    const batch = migration.slice(batchStart)
    const lock = batch.indexOf('pg_advisory_xact_lock')
    const materialize = batch.indexOf('insert into public.assignment_docs (assignment_id, student_id)')
    const rowLock = batch.indexOf('for update')
    const classification = batch.indexOf('into v_blocked_ids')
    const historyInsert = batch.indexOf('insert into public.assignment_feedback_entries')
    const visibilityUpdate = batch.indexOf('teacher_cleared_at = p_now')

    expect(lock).toBeGreaterThan(-1)
    expect(materialize).toBeGreaterThan(lock)
    expect(rowLock).toBeGreaterThan(materialize)
    expect(classification).toBeGreaterThan(rowLock)
    expect(historyInsert).toBeGreaterThan(classification)
    expect(visibilityUpdate).toBeGreaterThan(historyInsert)
    expect(batch).toContain('and d.student_id = any(v_returned_ids)')
  })

  it('serializes grade saves and rejects stale document revisions before updating', () => {
    const gradeStart = migration.indexOf('create or replace function public.save_assignment_grades_atomic')
    const grade = migration.slice(gradeStart, migration.indexOf('create or replace function public.return_assignment_feedback_atomic'))
    const lock = grade.indexOf('pg_advisory_xact_lock')
    const conflict = grade.indexOf("raise exception 'Assignment grade changed; reload and retry'")
    const update = grade.indexOf('update public.assignment_docs d')

    expect(lock).toBeGreaterThan(-1)
    expect(conflict).toBeGreaterThan(lock)
    expect(update).toBeGreaterThan(conflict)
    expect(grade).toContain('p_expected_doc_updated_at_by_student')
  })

  it('keeps delayed AI grades on the same lock and source-revision boundary', () => {
    const aiStart = migration.indexOf('create or replace function public.save_assignment_ai_grade_atomic')
    const aiEnd = migration.indexOf('create or replace function public.create_assignment_ai_grading_run_atomic')
    const aiGrade = migration.slice(aiStart, aiEnd)

    expect(aiGrade.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1)
    expect(aiGrade.indexOf('v_doc.updated_at is distinct from p_expected_doc_updated_at'))
      .toBeGreaterThan(aiGrade.indexOf('pg_advisory_xact_lock'))
    expect(aiGrade).toContain("raise exception 'Assignment grade changed; reload and retry'")
    expect(migration).toContain('assignment_doc_updated_at timestamptz')
  })

  it('materializes and locks AI-run documents before validating source revisions', () => {
    const runStart = migration.indexOf('create or replace function public.create_assignment_ai_grading_run_atomic')
    const runEnd = migration.indexOf('create or replace function public.return_assignment_feedback_atomic')
    const createRun = migration.slice(runStart, runEnd)
    const materialize = createRun.indexOf('insert into public.assignment_docs (assignment_id, student_id)')
    const rowLock = createRun.indexOf('for update of d')
    const revisionConflict = createRun.indexOf("raise exception 'Assignment grade changed; reload and retry'")
    const missingGradeWrite = createRun.indexOf('score_completion,')

    expect(materialize).toBeGreaterThan(createRun.indexOf('pg_advisory_xact_lock'))
    expect(rowLock).toBeGreaterThan(materialize)
    expect(revisionConflict).toBeGreaterThan(rowLock)
    expect(missingGradeWrite).toBeGreaterThan(revisionConflict)
  })

  it('keeps TypeScript coordinators on the atomic RPC boundary', () => {
    expect(service).toContain("rpc('return_assignment_feedback_atomic'")
    expect(service).toContain("rpc('return_assignment_docs_with_feedback_atomic'")
    expect(service).not.toContain("from('assignment_feedback_entries')")
    expect(service).not.toContain("update('assignment_docs')")
    expect(gradeService).toContain("rpc('save_assignment_grades_atomic'")
    expect(gradeService).toContain("rpc('save_assignment_ai_grade_with_provenance_atomic'")
    expect(gradeService).toContain("rpc('save_assignment_ai_grades_atomic'")
    expect(gradeService).toContain("rpc('finalize_assignment_ai_grading_item_with_provenance_atomic'")
    expect(gradeService).toContain("rpc('complete_assignment_repo_review_run_atomic'")
    expect(gradeService).not.toContain("upsert(")
  })

  it('keeps the expand migration rolling-safe and rejects invalid final scores', () => {
    expect(migration).not.toContain('create trigger guard_assignment_grade_contract')
    expect(migration).toContain('drop trigger if exists guard_assignment_grade_contract')
    expect(migration).toContain('p_mark_graded')
    expect(migration).toContain('Final assignment grades require integer scores from 0 to 10')
    expect(migration).toContain('p_score_completion is null')
    expect(migration).toContain('grade.score_completion is null')
  })

  it('finalizes AI items and repo-review runs in the grade transaction', () => {
    const itemStart = migration.indexOf('create or replace function public.finalize_assignment_ai_grading_item_atomic')
    const repoStart = migration.indexOf('create or replace function public.complete_assignment_repo_review_run_atomic')
    const itemRpc = migration.slice(itemStart, repoStart)
    const repoRpc = migration.slice(repoStart, migration.indexOf('-- Serialize roster cleanup'))

    expect(itemRpc).toContain('v_result := public.save_assignment_ai_grade_atomic')
    expect(itemRpc).toContain('update public.assignment_ai_grading_run_items item')
    expect(repoRpc).toContain('v_grade_result := public.save_assignment_ai_grades_atomic')
    expect(repoRpc).toContain('insert into public.assignment_repo_review_results')
    expect(repoRpc).toContain("status = 'completed'")
  })
})
