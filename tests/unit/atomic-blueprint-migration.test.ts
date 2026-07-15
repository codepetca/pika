import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/081_atomic_blueprint_round_trips.sql',
)
const migration = fs.readFileSync(migrationPath, 'utf8')
const service = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/server/course-blueprints.ts'),
  'utf8',
)

describe('atomic blueprint migration', () => {
  it('defines a private operation ledger and service-role-only RPCs', () => {
    expect(migration).toContain('create table if not exists public.course_blueprint_operations')
    expect(migration).toContain('create or replace function public.create_course_blueprint_atomic')
    expect(migration).toContain('create or replace function public.instantiate_course_blueprint_atomic')
    expect(migration).toContain('revoke all on table public.course_blueprint_operations from public, anon, authenticated')
    expect(migration).toContain('grant execute on function public.create_course_blueprint_atomic')
    expect(migration).toContain('grant execute on function public.instantiate_course_blueprint_atomic')
    expect(migration).not.toContain('source_classroom_id uuid references')
    expect(migration).not.toContain('result_classroom_id uuid references')
  })

  it('persists failure evidence outside rollback subtransactions', () => {
    expect(migration).toContain("status = 'failed'")
    expect(migration).toContain('get stacked diagnostics v_error_sqlstate = returned_sqlstate')
    expect(migration).toContain("if v_operation.status = 'completed' and v_operation.result is not null")
    expect(migration).toContain("jsonb_set(v_operation.result, '{replayed}', 'true'::jsonb, true)")
  })

  it('guards source consistency and removes compensating-delete rollback helpers', () => {
    expect(migration).toContain('content_revision')
    expect(migration).toContain('v_blueprint_revision <> p_expected_content_revision')
    expect(migration).toContain('blueprint_source_revision')
    expect(migration).toContain('v_source_revision <> p_expected_source_revision')
    expect(migration).toContain('touch_classroom_blueprint_source_from_test_questions')
    expect(migration).toContain('touch_classroom_blueprint_source_from_requirements')
    expect(service).not.toContain('rollbackBlueprintCreation')
    expect(service).not.toContain('rollbackClassroomCreation')
  })
})
