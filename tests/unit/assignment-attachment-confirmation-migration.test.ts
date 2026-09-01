import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/142_allow_acknowledged_missing_assignment_attachments.sql'),
  'utf8'
).toLowerCase()

describe('acknowledged missing assignment attachments migration', () => {
  it('allows missing rows while retaining the invalid and inaccessible artifact guard', () => {
    expect(migration).toContain('create or replace function private.validate_assignment_submission_requirements')
    expect(migration).toContain("a.validation_status in ('invalid', 'inaccessible')")
    expect(migration).toContain('join public.assignment_submission_artifacts a')
    expect(migration).not.toContain('left join public.assignment_submission_artifacts a')
    expect(migration).not.toContain('a.id is null')
  })

  it('keeps the private guard unavailable to API roles', () => {
    expect(migration).toContain(
      'revoke all on function private.validate_assignment_submission_requirements(public.assignment_docs)'
    )
    expect(migration).toContain('from public, anon, authenticated, service_role;')
  })
})
