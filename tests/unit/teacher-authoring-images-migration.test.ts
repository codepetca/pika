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
})
