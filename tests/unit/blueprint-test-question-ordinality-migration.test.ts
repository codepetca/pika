import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/134_blueprint_test_question_ordinal_identity.sql',
  ),
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

function expectStableQuestionIdentityMapping(definition: string) {
  expect(definition).toMatch(
    /for v_child in\s+select question\.value\s+from jsonb_array_elements\([\s\S]{0,180}v_item->'content'->'questions'[\s\S]{0,120}as question\(value\)/,
  )
  expect(definition).toMatch(
    /select array_agg\(source_question\.id order by source_question\.id\)[\s\S]{0,260}source_question\.artifact_id = \(v_child->>'id'\)::uuid[\s\S]{0,180}source_question\.source_artifact_id = \(v_child->>'id'\)::uuid[\s\S]{0,180}source_question\.id = \(v_child->>'id'\)::uuid/,
  )
  expect(definition).toContain(
    'if coalesce(cardinality(v_question_row_ids), 0) > 1 then',
  )
  expect(definition).toContain(
    'elsif coalesce(cardinality(v_question_row_ids), 0) = 1 then',
  )
  expect(definition).not.toMatch(/offset v_question_index/)
}

describe('Blueprint test-question ordinal identity migration', () => {
  it('maps active classroom capture questions by canonical array order', () => {
    const definition = functionDefinition(
      'create_course_blueprint_atomic_v2_pre_managed_storage',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectStableQuestionIdentityMapping(definition)
  })

  it('maps archived classroom reuse questions by canonical array order', () => {
    const definition = functionDefinition(
      'create_archived_classroom_blueprint_atomic',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectStableQuestionIdentityMapping(definition)
    expect(migration).toContain(
      'grant execute on function public.create_archived_classroom_blueprint_atomic(',
    )
  })

  it('runs the rollback and replay database contract in CI', () => {
    expect(ciWorkflow).toContain(
      'bash scripts/check-blueprint-question-ordinal-identity.sh',
    )
  })
})
