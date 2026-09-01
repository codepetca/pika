import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/144_allow_acknowledged_missing_assignment_attachments.sql'),
  'utf8'
).toLowerCase()

describe('acknowledged missing assignment attachments migration', () => {
  it('keeps invalid artifacts blocked and requires an exact duplicate-free missing acknowledgement', () => {
    expect(migration).toContain('create or replace function private.validate_assignment_submission_requirements')
    expect(migration).toContain("a.validation_status in ('invalid', 'inaccessible')")
    expect(migration).toContain('join public.assignment_submission_artifacts a')
    expect(migration).toContain('if p_acknowledged_missing_requirement_ids is not null then')
    expect(migration).toContain('count(distinct acknowledged_id)')
    expect(migration).toContain(
      'cardinality(p_acknowledged_missing_requirement_ids) <> cardinality(v_current_missing_requirement_ids)'
    )
    expect(migration).toContain('not (acknowledged_id = any(v_current_missing_requirement_ids))')
    expect(migration).toContain('not (missing_id = any(p_acknowledged_missing_requirement_ids))')
    expect(migration).toContain('left join public.assignment_submission_artifacts a')
    expect(migration).toContain('a.id is null')
    expect(migration).toContain("message = 'assignment_submission_requirements_missing'")
  })

  it('evaluates acknowledgement inside both locked submission paths', () => {
    expect(migration).toContain("hashtextextended('assignment_submission:' || p_assignment_id::text, 0)")
    expect(migration).toContain('p_acknowledged_missing_requirement_ids uuid[]')
    expect(migration).toContain('create or replace function public.submit_assignment_doc_atomic(')
    expect(migration).toContain('create or replace function public.submit_assignment_doc_with_pal_event_atomic(')
    expect(migration).toContain("'assignment_first_completion'")
  })

  it('preserves strict legacy call shapes and keeps private helpers unavailable to API roles', () => {
    expect(migration).toContain('old app instances remain strict by default')
    expect(migration).toContain("p_char_count, '{}'::uuid[]")
    expect(migration).toContain(
      'revoke all on function private.validate_assignment_submission_requirements(public.assignment_docs, uuid[])'
    )
    expect(migration).toContain('from public, anon, authenticated, service_role;')
  })
})
