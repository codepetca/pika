import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/103_repo_review_grading_provenance.sql'),
  'utf8',
).toLowerCase()
const gradeService = readFileSync(
  resolve(process.cwd(), 'src/lib/server/assignment-grades.ts'),
  'utf8',
)

describe('repository-review grading provenance migration', () => {
  it('stores bounded model provenance on each repository-review result', () => {
    expect(migration).toContain('add column if not exists grading_model text')
    expect(migration).toContain('add column if not exists grading_provenance jsonb')
    expect(migration).toContain('assignment_repo_review_results_grading_provenance_contract')
    expect(migration).toContain('assignment-grading-provenance-v1')
    expect(migration).toContain("grading_model = grading_provenance->>'model'")
    expect(migration).toContain('octet_length(grading_provenance::text) <= 4096')
  })

  it('allows truthful zero-request provenance for deterministic local grading', () => {
    expect(migration).toContain('drop constraint if exists assignment_docs_ai_grading_provenance_contract')
    expect(migration).toContain("(ai_grading_provenance->>'providerrequestcount')::integer between 0 and 10")
    expect(migration).toContain("(grading_provenance->>'providerrequestcount')::integer between 0 and 10")
  })

  it('wraps the old atomic completion contract and preserves completed replay', () => {
    expect(migration).toContain('create or replace function public.complete_assignment_repo_review_run_with_provenance_atomic')
    expect(migration).toContain('public.complete_assignment_repo_review_run_atomic(')
    expect(migration).toContain("if v_status <> 'completed' then")
    expect(migration).toContain('grading_model = payload.grading_model')
    expect(migration).toContain('set ai_grading_provenance = payload.ai_grading_provenance')
    expect(migration).toContain('revoke all on function public.complete_assignment_repo_review_run_with_provenance_atomic')
    expect(migration).toContain('to service_role')
  })

  it('routes application completion through the provenance wrapper', () => {
    expect(gradeService).toContain("rpc('complete_assignment_repo_review_run_with_provenance_atomic'")
    expect(gradeService).toContain('ai_grading_provenance: grade.aiGradingProvenance ?? null')
  })
})
