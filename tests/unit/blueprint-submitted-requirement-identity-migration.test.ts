import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/113_allow_submitted_requirement_identity_mapping.sql',
  ),
  'utf8',
).toLowerCase()

describe('submitted assignment requirement identity migration', () => {
  it('allows only service-role Blueprint identity mapping to bypass submission immutability', () => {
    expect(migration).toContain(
      'create or replace function public.guard_assignment_submission_requirement_mutation()',
    )
    expect(migration).toContain("current_setting('pika.identity_mapping', true) = 'on'")
    expect(migration).toContain("auth.role() = 'service_role'")
    expect(migration).toContain("tg_op = 'update'")
    expect(migration).toContain("'artifact_id'")
    expect(migration).toContain("'source_artifact_id'")
    expect(migration).toContain("'source_blueprint_version_id'")
    expect(migration).toContain('to_jsonb(new)')
    expect(migration).toContain('to_jsonb(old)')
  })

  it('retains the submitted-document lock for every non-lineage mutation', () => {
    expect(migration).toContain('assignment_requirement_move_forbidden')
    expect(migration).toContain('assignment_requirements_submitted_documents_immutable')
    expect(migration).toContain('from public.assignment_docs')
    expect(migration).toContain('for update')
    expect(migration).toContain(
      'revoke all on function public.guard_assignment_submission_requirement_mutation()',
    )
  })
})
