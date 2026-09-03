import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = [
  '155_discard_pristine_assessment_drafts.sql',
  '156_harden_pristine_test_draft_discard.sql',
].map((filename) => readFileSync(
  resolve(process.cwd(), 'supabase/migrations', filename),
  'utf8',
)).join('\n').toLowerCase()

function definition(name: string) {
  const replaceStart = migration.lastIndexOf(`create or replace function public.${name}`)
  const createStart = migration.lastIndexOf(`create function public.${name}`)
  const start = Math.max(replaceStart, createStart)
  const end = migration.indexOf('\n$$;', start) + 4
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end)
}

describe('pristine assessment draft discard migration', () => {
  it('serializes Assignment cleanup with requirement writes and rejects stale rows', () => {
    const sql = definition('discard_pristine_assignment_draft_atomic')
    const advisoryLock = sql.indexOf("pg_advisory_xact_lock")
    const assignmentLock = sql.indexOf('for update;')

    expect(advisoryLock).toBeGreaterThanOrEqual(0)
    expect(assignmentLock).toBeGreaterThan(advisoryLock)
    expect(sql).toContain('v_assignment.updated_at is distinct from p_expected_updated_at')
    expect(sql).toContain('assignment_submission_requirements')
    expect(sql).toContain('assignment_docs')
    expect(sql.indexOf("'discarded', false")).toBeLessThan(sql.indexOf('delete from public.assignments'))
  })

  it('uses the Test writer lock order and rejects concurrent draft or Test row changes', () => {
    const sql = definition('discard_pristine_test_draft_atomic')
    const classroomLock = sql.indexOf('from public.classrooms classroom')
    const testLock = sql.indexOf('from public.tests test', classroomLock)
    const draftLock = sql.indexOf('from public.assessment_drafts draft')

    expect(testLock).toBeGreaterThan(classroomLock)
    expect(draftLock).toBeGreaterThan(testLock)
    expect(sql).toContain('v_draft.version is distinct from p_expected_draft_version')
    expect(sql).toContain('v_test.updated_at is distinct from p_expected_test_updated_at')
    expect(sql).toContain("v_test.status is distinct from 'draft'")
    expect(sql).toContain('jsonb_array_length(v_draft.content->\'questions\') <> 0')
    expect(sql.indexOf("'discarded', false")).toBeLessThan(sql.indexOf('delete from public.tests'))
    expect(sql.indexOf('delete from public.assessment_drafts')).toBeLessThan(
      sql.indexOf('delete from public.tests'),
    )
  })

  it('keeps both discard functions private to the service role', () => {
    expect(migration).toMatch(
      /revoke all on function public\.discard_pristine_assignment_draft_atomic\([\s\S]*?from public, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /revoke all on function public\.discard_pristine_test_draft_atomic\([\s\S]*?from public, anon, authenticated;/,
    )
    expect(migration).toContain(
      'grant execute on function public.discard_pristine_assignment_draft_atomic(uuid, uuid, timestamptz)\nto service_role;',
    )
    expect(migration).toContain(
      'grant execute on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz)\nto service_role;',
    )
  })
})
