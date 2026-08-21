import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  'supabase/migrations/126_classroom_archive_expected_revision.sql',
  'utf8',
)

describe('classroom archive expected revision migration', () => {
  it('holds source rows while validating the expected revision before export begins', () => {
    expect(sql).toContain('begin_classroom_archive_export_v2_expected_revision')
    expect(sql).toContain('p_expected_source_revision bigint')
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0))')
    expect(sql).toContain('for share of classroom, revision')
    expect(sql).toContain('v_revision <> p_expected_source_revision')
    expect(sql).toContain('v_operation_source_revision <> p_expected_source_revision')
    expect(sql).toContain("'classroom_archive_source_revision_changed'")
    expect(sql).toContain('return public.begin_classroom_archive_export_v2(')
  })

  it('keeps the revision-fenced entry point service-role only', () => {
    expect(sql).toMatch(/revoke all on function public\.begin_classroom_archive_export_v2_expected_revision\([\s\S]+?from public, anon, authenticated;/)
    expect(sql).toMatch(/grant execute on function public\.begin_classroom_archive_export_v2_expected_revision\([\s\S]+?to service_role;/)
  })
})
