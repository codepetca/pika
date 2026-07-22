import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/102_test_ai_grading_provenance.sql'),
  'utf8',
)
const service = readFileSync(
  resolve(process.cwd(), 'src/lib/server/test-grades.ts'),
  'utf8',
)
const databaseHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-atomic-test-grading.sh'),
  'utf8',
)

describe('test AI grading provenance migration', () => {
  it('adds a bounded provenance contract and rolling-safe atomic wrappers', () => {
    expect(migration).toContain('add column if not exists ai_grading_provenance jsonb')
    expect(migration).toContain('test-grading-provenance-v1')
    expect(migration).toContain("-4[0-9a-f]{3}-[89ab]")
    expect(migration).toContain("ai_model = ai_grading_provenance->>'model'")
    expect(migration).toContain('octet_length(ai_grading_provenance::text) <= 4096')
    expect(migration).toContain('create trigger clear_stale_test_ai_grading_provenance')
    expect(migration).toContain('new.ai_grading_provenance := null')
    expect(migration).toContain(
      'create or replace function public.save_test_response_grades_with_provenance_atomic',
    )
    expect(migration).toContain(
      'create or replace function public.finalize_test_ai_grading_item_with_provenance_atomic',
    )
    expect(migration.match(/security definer/g)).toHaveLength(2)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(4)
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('keeps provenance in the same transaction as manual and durable writes', () => {
    const directStart = migration.indexOf(
      'create or replace function public.save_test_response_grades_with_provenance_atomic',
    )
    const itemStart = migration.indexOf(
      'create or replace function public.finalize_test_ai_grading_item_with_provenance_atomic',
    )
    const direct = migration.slice(directStart, itemStart)
    const item = migration.slice(itemStart)

    expect(direct).toContain('v_result := public.save_test_response_grades_atomic')
    expect(direct).toContain('set ai_grading_provenance = case')
    expect(migration).toContain("to_jsonb(new) - 'ai_grading_provenance'")
    expect(item).toContain('v_result := public.finalize_test_ai_grading_item_atomic')
    expect(item).toContain("v_item_status <> 'completed'")
    expect(item).toContain('set ai_grading_provenance = p_ai_grading_provenance')
  })

  it('routes manual and durable persistence through provenance-aware RPCs', () => {
    expect(service).toContain("rpc('save_test_response_grades_with_provenance_atomic'")
    expect(service).toContain(
      "rpc('finalize_test_ai_grading_item_with_provenance_atomic'",
    )
    expect(service).toContain('ai_grading_provenance: grade.ai_grading_provenance ?? null')
    expect(service).toContain('p_ai_grading_provenance: input.aiGradingProvenance')
  })

  it('keeps database-backed persistence, replay, and legacy clearing coverage in CI', () => {
    expect(databaseHarness).toContain('save_test_response_grades_with_provenance_atomic')
    expect(databaseHarness).toContain('finalize_test_ai_grading_item_with_provenance_atomic')
    expect(databaseHarness).toContain("ai_grading_provenance->>'gradingRequestId'")
    expect(databaseHarness).toContain('test AI provenance replay overwrote the original audit')
    expect(databaseHarness).toContain('legacy test grade write left stale AI provenance')
  })
})
