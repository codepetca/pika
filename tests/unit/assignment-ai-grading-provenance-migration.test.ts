import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/101_assignment_ai_grading_provenance.sql'),
  'utf8',
)
const service = readFileSync(
  resolve(process.cwd(), 'src/lib/server/assignment-grades.ts'),
  'utf8',
)
const databaseHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-atomic-assignment-feedback-returns.sh'),
  'utf8',
)

describe('assignment AI grading provenance migration', () => {
  it('adds a bounded provenance contract and rolling-safe atomic wrappers', () => {
    expect(migration).toContain('add column if not exists ai_grading_provenance jsonb')
    expect(migration).toContain('assignment-grading-provenance-v1')
    expect(migration).toContain('octet_length(ai_grading_provenance::text) <= 4096')
    expect(migration).toContain('create trigger clear_stale_assignment_ai_grading_provenance')
    expect(migration).toContain('new.ai_grading_provenance := null')
    expect(migration).toContain('create or replace function public.save_assignment_ai_grade_with_provenance_atomic')
    expect(migration).toContain('create or replace function public.finalize_assignment_ai_grading_item_with_provenance_atomic')
    expect(migration.match(/security definer/g)).toHaveLength(2)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(3)
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('keeps provenance in the same transaction as grade and item finalization', () => {
    const directStart = migration.indexOf('create or replace function public.save_assignment_ai_grade_with_provenance_atomic')
    const itemStart = migration.indexOf('create or replace function public.finalize_assignment_ai_grading_item_with_provenance_atomic')
    const direct = migration.slice(directStart, itemStart)
    const item = migration.slice(itemStart)

    expect(direct).toContain('v_result := public.save_assignment_ai_grade_atomic')
    expect(direct).toContain('set ai_grading_provenance = p_ai_grading_provenance')
    expect(item).toContain('v_result := public.finalize_assignment_ai_grading_item_atomic')
    expect(item).toContain("if v_item_status not in ('completed', 'skipped') then")
    expect(item).toContain('set ai_grading_provenance = p_ai_grading_provenance')
  })

  it('routes both Pika persistence paths through the provenance-aware RPCs', () => {
    expect(service).toContain("rpc('save_assignment_ai_grade_with_provenance_atomic'")
    expect(service).toContain("rpc('finalize_assignment_ai_grading_item_with_provenance_atomic'")
    expect(service).toContain('p_ai_grading_provenance: opts.aiGradingProvenance ?? null')
    expect(service).toContain('p_ai_grading_provenance: opts.grade.aiGradingProvenance ?? null')
  })

  it('keeps a database-backed direct, durable, privilege, and replay contract in CI', () => {
    expect(databaseHarness).toContain('save_assignment_ai_grade_with_provenance_atomic')
    expect(databaseHarness).toContain('finalize_assignment_ai_grading_item_with_provenance_atomic')
    expect(databaseHarness).toContain("v_provenance->>'gradingProfileVersion'")
    expect(databaseHarness).toContain('AI item provenance replay overwrote the original audit')
  })
})
