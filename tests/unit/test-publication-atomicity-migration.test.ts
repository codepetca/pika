import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/139_publish_test_from_draft_atomic.sql'),
  'utf8',
)
const databaseContract = readFileSync(
  resolve(process.cwd(), 'scripts/check-test-publication-atomicity.sh'),
  'utf8',
)
const ciWorkflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/ci.yml'),
  'utf8',
)

function functionDefinition(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = migration.indexOf('\n$$;', start)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end)
}

describe('atomic Test publication migration', () => {
  it('materializes and closes the Test inside one database transaction', () => {
    const definition = functionDefinition('publish_test_from_draft_atomic')
    const activation = definition.indexOf('public.activate_test_from_draft_atomic(')
    const close = definition.indexOf("status = 'closed'")

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expect(activation).toBeGreaterThanOrEqual(0)
    expect(close).toBeGreaterThan(activation)
    expect(definition).toMatch(
      /update public\.tests test[\s\S]{0,180}status = 'closed'[\s\S]{0,180}test\.id = p_test_id[\s\S]{0,80}test\.status = 'active'[\s\S]{0,80}returning test\.\* into v_test/,
    )
    expect(definition).toContain("message = 'publish_transition_failed'")
    expect(definition).toContain("jsonb_set(v_result, '{test}', to_jsonb(v_test), true)")
    expect(definition).not.toMatch(/\bcommit\b/i)
  })

  it('keeps the RPC service-role-only', () => {
    expect(migration).toContain(
      'revoke all on function public.publish_test_from_draft_atomic(',
    )
    expect(migration).toMatch(
      /revoke all on function public\.publish_test_from_draft_atomic\([\s\S]{0,100}from public, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.publish_test_from_draft_atomic\([\s\S]{0,100}to service_role;/,
    )
  })

  it('runs a real rollback contract after migration replay in CI', () => {
    expect(databaseContract).toContain('reject_test_publication_close')
    expect(databaseContract).toContain('perform public.publish_test_from_draft_atomic(')
    expect(databaseContract).toMatch(
      /select test\.status[\s\S]{0,180}is distinct from 'draft'/,
    )
    expect(databaseContract).toContain('from public.test_questions')
    expect(databaseContract).toContain('Failed publication did not roll back materialized questions')
    expect(databaseContract).toContain('rollback;')
    expect(ciWorkflow).toContain('bash scripts/check-test-publication-atomicity.sh')
  })
})
