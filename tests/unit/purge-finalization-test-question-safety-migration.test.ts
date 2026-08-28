import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/136_classroom_blueprint_purge_finalization_safety.sql',
  ),
  'utf8',
)

describe('purge finalization Test-question safety migration', () => {
  it('keeps the student-work freeze while allowing only owner-run Classroom deletion', () => {
    expect(migration).toMatch(
      /tg_op = 'DELETE'[\s\S]{0,120}current_user = 'postgres'[\s\S]{0,180}current_setting\('pika\.classroom_purge_finalize', true\)/,
    )
    expect(migration).toContain(
      'test_questions_locked: Test questions cannot be changed after student work exists',
    )
    expect(migration).toContain(
      "current_setting('pika.course_blueprint_purge_finalize', true)",
    )
    expect(migration).toMatch(
      /to_jsonb\(new\) - array\[\s*'source_blueprint_version_id',[\s\S]{0,180}to_jsonb\(old\) - array\[/,
    )
  })

  it('orders linked Classroom and Blueprint purges before either snapshot starts', () => {
    expect(migration).toContain("return 'linked_course_blueprint_purge_active'")
    expect(migration).toContain("return 'linked_classroom_purge_active'")
    expect(migration).toContain('public.course_blueprint_purge_fences')
    expect(migration).toContain('public.classroom_purge_fences')
    expect(migration).toContain(
      'private.classroom_purge_conflict_pre_cross_purge_order',
    )
    expect(migration).toContain(
      'private.course_blueprint_purge_conflict_pre_cross_purge_order',
    )
    expect(migration).toMatch(
      /function public\.classroom_purge_conflict\(p_classroom_id uuid\)[\s\S]{0,120}security definer\s+set search_path = ''/,
    )
    expect(migration).toMatch(
      /function public\.course_blueprint_purge_conflict\(p_blueprint_id uuid\)[\s\S]{0,120}security definer\s+set search_path = ''/,
    )
  })

  it('drains legacy interleaved purges in Classroom-then-Blueprint order', () => {
    expect(migration).toContain(
      'course_blueprint_purge_waiting_for_classroom_purge',
    )
    expect(migration).toMatch(
      /tg_table_name = 'course_blueprint_change_proposals'[\s\S]{0,500}'source_classroom_id', 'updated_at'/,
    )
    expect(migration).toMatch(
      /tg_table_name = 'course_blueprint_operations'[\s\S]{0,500}'source_classroom_id', 'result_classroom_id'/,
    )
    expect(migration).toMatch(
      /tg_op = 'DELETE'[\s\S]{0,160}current_setting\('pika\.classroom_purge_finalize', true\)/,
    )
  })

  it('reclassifies only retained generic Blueprint failures with a live linked Classroom fence', () => {
    expect(migration).toMatch(
      /update public\.course_blueprint_purge_operations operation[\s\S]*operation\.status = 'failed'[\s\S]*operation\.retryable is false[\s\S]*operation\.error_code = 'database_finalize_failed'/,
    )
    expect(migration).toMatch(
      /exists \([\s\S]*from public\.classroom_purge_fences classroom_fence[\s\S]*classroom\.source_blueprint_id = operation\.course_blueprint_id/,
    )
  })
})
