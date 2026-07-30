import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/115_hot_archived_classroom_purge.sql'),
  'utf8',
)

describe('hot archived classroom purge migration', () => {
  it('limits eligibility to the owning teacher and a hot archived classroom', () => {
    expect(migration).toContain('v_operation.teacher_id <> p_teacher_id')
    expect(migration).toContain('v_teacher_id <> p_teacher_id')
    expect(migration).toContain('if v_archived_at is null then')
    expect(migration).toContain("where classroom_id = p_classroom_id")
    expect(migration).toContain("'classroom_is_cold_archived'")
    expect(migration).toContain("'classroom_not_found'")
  })

  it('serializes purge and conflicting classroom operations', () => {
    expect(migration).toContain(
      "'pika-classroom-operation:' || p_classroom_id::text",
    )
    expect(migration).toContain('perform public.classroom_purge_lock(p_classroom_id)')
    expect(migration).toContain('classroom_purge_fences')
    expect(migration).toContain(
      'create or replace function public.reject_classroom_resource_change_during_purge()',
    )
    expect(migration).toContain(
      'create or replace function public.reject_classroom_operation_during_purge()',
    )
    expect(migration).toContain("'classroom_archive_operation_active'")
    expect(migration).toContain("'classroom_grading_operation_active'")
    expect(migration).toContain("'classroom_blueprint_operation_active'")
  })

  it('captures exact membership and deletes every resource child-first', () => {
    expect(migration).toMatch(
      /insert into public\.classroom_purge_resources[\s\S]{0,700}order by export_position/,
    )
    expect(migration).toMatch(
      /from public\.classroom_archive_resource_contract[\s\S]{0,80}order by export_position desc/,
    )
    expect(migration).toContain(
      "raise exception 'Classroom purge membership drift for %'",
    )
    expect(migration).toContain(
      "perform set_config('pika.classroom_purge_finalize', 'on', true)",
    )
  })

  it('cannot finalize a partial object inventory or pending storage cleanup', () => {
    expect(migration).toContain('inventory_completed_at timestamptz')
    expect(migration).toContain(
      'create or replace function public.seal_classroom_purge_inventory(',
    )
    expect(migration).toContain(
      "raise exception 'Classroom purge object inventory is incomplete'",
    )
    expect(migration).toMatch(
      /from public\.classroom_purge_objects[\s\S]{0,140}status not in \('deleted', 'preserved'\)/,
    )
    expect(migration).toContain("'operation_status', 'inventorying'")
  })

  it('uses retryable object leases and redacts paths after verified deletion', () => {
    expect(migration).toContain(
      'create or replace function public.claim_classroom_purge_object(',
    )
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('lease_expires_at <= clock_timestamp()')
    expect(migration).toContain(
      'create or replace function public.fail_classroom_purge_object(',
    )
    expect(migration).toContain("status = 'failed'")
    expect(migration).toContain("least(interval '1 hour'")
    expect(migration).toMatch(
      /complete_classroom_purge_object[\s\S]{0,900}storage_path = null/,
    )
  })

  it('covers all managed buckets and safely preserves shared objects', () => {
    for (const bucket of [
      'assignment-artifacts',
      'submission-images',
      'test-documents',
      'classroom-archives',
      'gradex-analytics-extracts',
    ]) {
      expect(migration).toContain(`'${bucket}'`)
    }
    expect(migration).toContain(
      'create or replace function public.classroom_purge_storage_path_is_shared(',
    )
    expect(migration).toContain("'preserve_shared'")
    expect(migration).toContain('public.course_blueprint_versions')
  })

  it('preserves Blueprints and users while reconciling operational metadata', () => {
    expect(migration).not.toMatch(/delete from public\.course_blueprints/)
    expect(migration).not.toMatch(/delete from public\.users/)
    expect(migration).toContain(
      'update public.course_blueprint_change_proposals',
    )
    expect(migration).toContain('delete from public.classroom_gradex_extracts')
    expect(migration).toContain('delete from public.classroom_archives')
    expect(migration).toContain(
      'delete from public.classroom_archive_operations',
    )
  })

  it('exposes purge mutations only to the service role', () => {
    expect(migration).toContain(
      'revoke all on table public.classroom_purge_operations from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'grant execute on function public.begin_hot_archived_classroom_purge',
    )
    expect(migration).not.toMatch(
      /grant execute on function public\.begin_hot_archived_classroom_purge[\s\S]{0,120}to authenticated/,
    )
  })
})
