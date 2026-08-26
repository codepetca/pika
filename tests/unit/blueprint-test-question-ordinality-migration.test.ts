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

function expectReadOnlyStableQuestionIdentityValidation(
  definition: string,
  failurePrefix: 'Captured' | 'Archived',
) {
  expect(definition).toMatch(
    /for v_child in\s+select question\.value\s+from jsonb_array_elements\([\s\S]{0,180}v_item->'content'->'questions'[\s\S]{0,120}as question\(value\)/,
  )
  expect(definition).toMatch(
    /select array_agg\(source_question\.id order by source_question\.id\)[\s\S]{0,260}source_question\.artifact_id = \(v_child->>'id'\)::uuid[\s\S]{0,180}source_question\.source_artifact_id = \(v_child->>'id'\)::uuid/,
  )
  expect(definition).toContain(
    'if coalesce(cardinality(v_question_row_ids), 0) > 1 then',
  )
  expect(definition).toContain(
    `raise exception '${failurePrefix} Test question identity mapping is ambiguous'`,
  )
  expect(definition).toMatch(
    new RegExp(
      `raise exception '${failurePrefix} Test question identity mapping is ambiguous'\\s+using errcode = '22023'`,
    ),
  )
  expect(definition).not.toMatch(
    /source_question\.id = \(v_child->>'id'\)::uuid/,
  )
  expect(definition).not.toMatch(
    /update public\.test_questions\s+set\s+artifact_id = \(v_child->>'id'\)::uuid/,
  )
  expect(definition).not.toMatch(/offset v_question_index/)
}

function expectDurableIdentityFailureLedger(definition: string) {
  expect(definition).toMatch(
    /insert into public\.course_blueprint_operations \([\s\S]{0,700}on conflict \(id\) do nothing;\s+begin/,
  )
  expect(definition).toContain(
    "v_error_code := 'test_question_identity_ambiguous'",
  )
  expect(definition).toContain('exception when others then')
  expect(definition).toContain('v_error_sqlstate = returned_sqlstate')
  expect(definition).toContain(
    "v_error_code := coalesce(v_error_code, 'blueprint_identity_mapping_failed')",
  )
  expect(definition).toContain(
    "'status', case when v_error_code = 'test_question_identity_ambiguous' then 409 else 500 end",
  )
  expect(definition).toContain("'error_code', v_error_code")
  expect(definition).toMatch(
    /status = 'failed',[\s\S]{0,180}attempt_count = case when status = 'failed' then attempt_count \+ 1 else attempt_count end/,
  )
  expect(definition).toContain('result_blueprint_id = null')
  expect(definition).toContain('result_classroom_id = null')
  expect(definition).toContain('result = v_result')
  expect(definition).toContain('resource_counts = v_resource_counts')
  expect(definition).toContain('error_code = v_error_code')
  expect(definition).toContain('error_sqlstate = v_error_sqlstate')
}

describe('Blueprint test-question identity migration', () => {
  it('maps active classroom capture questions by stable identity', () => {
    const definition = functionDefinition(
      'create_course_blueprint_atomic_v2_pre_managed_storage',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectReadOnlyStableQuestionIdentityValidation(definition, 'Captured')
    expectDurableIdentityFailureLedger(definition)
  })

  it('maps archived classroom reuse questions by stable identity', () => {
    const definition = functionDefinition(
      'create_archived_classroom_blueprint_atomic',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectReadOnlyStableQuestionIdentityValidation(definition, 'Archived')
    expectDurableIdentityFailureLedger(definition)
    expect(migration).toContain(
      'grant execute on function public.create_archived_classroom_blueprint_atomic(',
    )
  })

  it('rematerializes instantiated Version questions from explicit artifact identity', () => {
    const definition = functionDefinition(
      'instantiate_course_blueprint_atomic_v2_pre_managed_storage',
    )

    expect(migration).toContain(
      ') rename to instantiate_course_blueprint_atomic_v2_pre_question_identity;',
    )
    expect(definition).toContain(
      'public.instantiate_course_blueprint_atomic_v2_pre_question_identity(',
    )
    expect(definition).toMatch(
      /source_test\.source_artifact_id = \(v_item->>'artifact_id'\)::uuid/,
    )
    expect(definition).toMatch(
      /delete from public\.test_questions\s+where test_id = v_parent_id/,
    )
    expect(definition).toMatch(
      /insert into public\.test_questions \([\s\S]{0,260}artifact_id,[\s\S]{0,100}source_artifact_id,[\s\S]{0,100}source_blueprint_version_id/,
    )
    expect(definition).toMatch(
      /\(v_child->>'artifact_id'\)::uuid,[\s\S]{0,80}\(v_child->>'artifact_id'\)::uuid,[\s\S]{0,80}p_blueprint_version_id/,
    )
    expect(definition).not.toMatch(
      /update public\.test_questions[\s\S]{0,220}position = coalesce\(\(v_child->>'position'/,
    )
  })

  it('backfills legacy draft row IDs to portable identity transactionally', () => {
    expect(migration).toContain(
      'lock table public.assessment_drafts in share row exclusive mode;',
    )
    expect(migration).toContain(
      "raise exception 'Legacy Test draft question identity backfill is ambiguous'",
    )
    expect(migration).toMatch(
      /from public\.assessment_drafts[\s\S]{0,120}assessment_type = 'test'/,
    )
    expect(migration).toMatch(
      /coalesce\(\s*source_question\.source_artifact_id,\s*source_question\.artifact_id,\s*source_question\.id\s*\)/,
    )
    expect(migration).toMatch(
      /update public\.assessment_drafts\s+set\s+content = jsonb_set\(content, '\{questions\}', v_questions, false\),\s+version = public\.assessment_drafts\.version \+ 1/,
    )
  })

  it('runs the rollback and replay database contract in CI', () => {
    expect(ciWorkflow).toContain(
      'bash scripts/check-blueprint-question-ordinal-identity.sh',
    )
  })
})
