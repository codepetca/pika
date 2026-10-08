import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/193_contextual_classwork_creation_fence.sql',
  'utf8',
)
const behaviorScript = () => readFileSync(
  'scripts/check-contextual-classwork-creation-database.sh',
  'utf8',
)
const concurrencyScript = () => readFileSync(
  'scripts/check-contextual-classwork-creation-concurrency.mjs',
  'utf8',
)
const workflow = () => readFileSync('.github/workflows/ci.yml', 'utf8')

describe('contextual classwork creation fence migration', () => {
  it('uses one private fixed-search-path position allocator', () => {
    const sql = migration()
    expect(sql).toContain('function private.lock_classwork_creation_context_v1(')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(/revoke all on function private\.lock_classwork_creation_context_v1\(uuid, uuid\)[\s\S]+from public, anon, authenticated, service_role/)
    expect(sql).toContain("'pika-classroom-operation:'")
    expect(sql).toContain('from public.assignments as assignment')
    expect(sql).toContain('from public.classwork_materials as material')
    expect(sql).toContain('from public.surveys as survey')
  })

  it('routes all three contextual creators through the shared allocator', () => {
    const sql = migration()
    expect(sql.match(/:= private\.lock_classwork_creation_context_v1\(/g)).toHaveLength(3)
    expect(sql).toContain('create or replace function public.create_assignment_for_owner_v1(')
    expect(sql).toContain('function public.create_classwork_material_for_owner_v1(')
    expect(sql).toContain('function public.create_survey_for_owner_v1(')
  })

  it('keeps new public boundaries service-only', () => {
    const sql = migration()
    for (const name of [
      'create_classwork_material_for_owner_v1',
      'create_survey_for_owner_v1',
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]+?from public, anon, authenticated`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+?to service_role`))
    }
  })

  it('runs rollback-only and cross-kind concurrency contracts in CI', () => {
    expect(behaviorScript()).toContain('rollback;')
    expect(behaviorScript()).not.toContain('supabase db push')
    expect(concurrencyScript()).toContain('material_then_survey_positions_serialize')
    expect(concurrencyScript()).toContain('survey_then_assignment_positions_serialize')
    expect(concurrencyScript()).not.toContain('supabase db push')
    expect(workflow()).toContain('bash scripts/check-contextual-classwork-creation-database.sh')
    expect(workflow()).toContain('node scripts/check-contextual-classwork-creation-concurrency.mjs')
  })
})
