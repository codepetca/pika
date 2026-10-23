import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('supabase/migrations/291_teacher_authoring_images.sql', 'utf8')
describe('teacher authored image persistence contract', () => {
 it('records an explicit private-to-server reference ledger and a 2MB raster-only identity', () => {
  expect(sql).toContain('byte_size between 1 and 2097152')
  expect(sql).toContain('alter table public.teacher_authoring_image_references enable row level security')
  expect(sql).toContain('revoke all on table public.teacher_authoring_image_references from public, anon, authenticated, service_role')
  expect(sql).toContain('grant select on table public.teacher_authoring_image_references to service_role')
 })
 it('attaches in the saving transaction and delays removal checks until bulk import completes', () => {
  expect(sql).toContain('perform public.managed_storage_mark_ready(v_id)')
  expect(sql).toContain('deferrable initially deferred')
  expect(sql).toContain("message = 'authoring_image_reference_not_attachable'")
  for (const table of ['assignments','classwork_materials','tests','test_questions','survey_questions','assessment_drafts','test_ai_grading_run_items']) expect(sql).toContain(`after insert or update or delete on public.${table}`)
 })
 it('retains only unclaimed new-purpose removals for one hour and revives only that exact state', () => {
  const sync = sql.split('create function public.sync_teacher_authoring_image_references()')[1].split('$$;')[0]
  for (const condition of ["v_object.status = 'cleanup_pending'", "v_object.cleanup_reason_code = 'authoring_image_reference_removed'",
   'v_object.next_attempt_at > pg_catalog.clock_timestamp()', 'v_object.attempt_count = 0',
   'v_object.lease_token is null and v_object.lease_expires_at is null',
   'v_object.verified_at is not null and v_object.ready_at is not null',
   "v_object.classroom_id is distinct from v_classroom_id", "v_object.purpose <> 'teacher_authoring_image'",
   "set status = 'ready', cleanup_reason_code = null, last_error_code = null"]) expect(sync).toContain(condition)
  expect(sync.indexOf('perform public.lock_managed_storage_protocol()')).toBeLessThan(sync.indexOf('for update'))
  expect(sync.indexOf('for update')).toBeLessThan(sync.indexOf("v_object.status = 'cleanup_pending'"))
  const cleanup = sql.split('create function public.queue_removed_teacher_authoring_image()')[1]
  for (const condition of ["perform public.queue_managed_storage_cleanup(old.managed_object_id,'authoring_image_reference_removed')",
   "next_attempt_at = pg_catalog.clock_timestamp() + interval '1 hour'", "purpose = 'teacher_authoring_image'",
   "status = 'cleanup_pending'", "cleanup_reason_code = 'authoring_image_reference_removed'",
   'attempt_count = 0 and lease_token is null and lease_expires_at is null']) expect(cleanup).toContain(condition)
  expect(sql).not.toMatch(/create (?:or replace )?function public\.(?:queue_managed_storage_cleanup|claim_managed_storage_cleanup|managed_storage_mark_ready)\(/)
 })
 it('prepares bounded real-Survey sequential move, swap, Undo, and negative retention-state proof cases', () => {
  const proof = readFileSync('scripts/check-teacher-authoring-images-database.sql', 'utf8')
  expect(proof).toContain('insert into public.surveys(')
  expect(proof).toContain('insert into public.survey_questions(')
  expect(proof).toContain('Sequential Survey image swap did not preserve both identities')
  expect(proof).toContain('Undo did not restore the unclaimed retained image cleanly')
  expect(proof).toContain('array[103,122,123,124,125,126,127,128,129,130]')
  expect(proof).toContain("interval '59 minutes'")
  expect(proof.match(/set constraints removed_teacher_authoring_image_cleanup immediate/g)?.length).toBeGreaterThan(5)
  expect(proof).toContain('Rejected retention attachment changed source, managed-object state, or ledger')
  expect(proof.trim()).toMatch(/rollback;$/)
 })
})
