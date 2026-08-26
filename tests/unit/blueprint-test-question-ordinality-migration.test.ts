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

function expectOrdinalQuestionIdentityMapping(definition: string) {
  expect(definition).toMatch(
    /for v_child, v_question_position in\s+select\s+question\.value,\s+\(question\.ordinality - 1\)::integer\s+from jsonb_array_elements\([\s\S]{0,180}v_item->'content'->'questions'[\s\S]{0,120}with ordinality as question\(value, ordinality\)/,
  )
  expect(definition).toMatch(
    /update public\.test_questions[\s\S]{0,260}where test_id = v_parent_id\s+and position = v_question_position/,
  )
}

describe('Blueprint test-question ordinal identity migration', () => {
  it('maps active classroom capture questions by canonical array order', () => {
    const definition = functionDefinition(
      'create_course_blueprint_atomic_v2_pre_managed_storage',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectOrdinalQuestionIdentityMapping(definition)
  })

  it('maps archived classroom reuse questions by canonical array order', () => {
    const definition = functionDefinition(
      'create_archived_classroom_blueprint_atomic',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectOrdinalQuestionIdentityMapping(definition)
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
