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
const databaseContract = readFileSync(
  resolve(
    process.cwd(),
    'scripts/check-blueprint-question-ordinal-identity.sh',
  ),
  'utf8',
)
const migrationLifecycleContract = readFileSync(
  resolve(
    process.cwd(),
    'scripts/check-blueprint-question-identity-migration-lifecycle.sh',
  ),
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
    /select array_agg\(source_question\.id order by source_question\.id\)[\s\S]{0,300}coalesce\(\s*source_question\.source_artifact_id,\s*source_question\.artifact_id\s*\) = \(v_child->>'id'\)::uuid/,
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
  // Zero matches is only tolerated for a source Test still in draft status
  // (its questions live in draft JSON, not yet materialized as rows); an
  // active/closed Test's captured question must resolve to a real row.
  expect(definition).toMatch(
    /select source_test\.status into v_source_test_status\s+from public\.tests as source_test\s+where source_test\.id = v_parent_id/,
  )
  expect(definition).toMatch(
    /coalesce\(cardinality\(v_question_row_ids\), 0\) = 0\s+and v_source_test_status is distinct from 'draft'/,
  )
  expect(definition).toContain(
    `raise exception '${failurePrefix} Test question identity mapping failed'`,
  )
  expect(definition).toContain(
    "v_error_code := 'test_question_identity_not_found'",
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
  const ledgerSeed = definition.indexOf('insert into public.course_blueprint_operations (')
  const savepoint = definition.indexOf('\n  begin\n', ledgerSeed)
  expect(ledgerSeed).toBeGreaterThanOrEqual(0)
  const outsideSavepoint = definition.slice(ledgerSeed, savepoint)
  expect(outsideSavepoint).toContain('on conflict (id) do nothing;')
  expect(savepoint).toBeGreaterThan(ledgerSeed)
  expect(outsideSavepoint).toMatch(
    /select \*\s+into v_operation\s+from public\.course_blueprint_operations\s+where id = p_operation_id\s+for update;/,
  )
  expect(outsideSavepoint).toContain(
    'v_operation.request_sha256 <> p_request_sha256',
  )
  expect(outsideSavepoint).toContain("'error_code', 'idempotency_conflict'")
  expect(outsideSavepoint).toMatch(
    /v_operation\.status = 'completed'[\s\S]{0,160}'\{replayed\}'/,
  )
  expect(definition).toContain(
    "v_error_code := 'test_question_identity_ambiguous'",
  )
  expect(definition).toContain('exception when others then')
  expect(definition).toContain('v_error_sqlstate = returned_sqlstate')
  expect(definition).toContain(
    "v_error_code := coalesce(v_error_code, 'blueprint_identity_mapping_failed')",
  )
  expect(definition).toMatch(
    /'status', case\s+when v_error_code in \('test_question_identity_ambiguous', 'test_question_identity_not_found'\)\s+then 409\s+else 500\s+end,/,
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
  it('serializes draft saves before version-bound activation', () => {
    const saveDefinition = functionDefinition('save_test_draft_atomic')
    const activationDefinition = functionDefinition('activate_test_from_draft_atomic')

    for (const definition of [saveDefinition, activationDefinition]) {
      expect(definition).toContain('security definer')
      expect(definition).toContain("set search_path = ''")
      const testDiscovery = definition.indexOf('from public.tests test')
      const classroomLock = definition.indexOf('from public.classrooms classroom')
      const testLock = definition.indexOf('from public.tests test', testDiscovery + 1)
      const draftLock = definition.indexOf('from public.assessment_drafts draft')
      expect(testDiscovery).toBeGreaterThanOrEqual(0)
      expect(classroomLock).toBeGreaterThan(testDiscovery)
      expect(testLock).toBeGreaterThan(classroomLock)
      expect(draftLock).toBeGreaterThan(testLock)
      expect(definition.slice(testDiscovery, classroomLock)).not.toContain('for update;')
      expect(definition.slice(classroomLock, testLock)).toContain('for update;')
      expect(definition.slice(testLock, draftLock)).toContain('for update;')
      expect(definition.slice(classroomLock, testLock)).toContain(
        'classroom.id = v_classroom_id',
      )
      expect(definition.slice(testLock, draftLock)).toContain(
        'test.classroom_id = v_classroom_id',
      )
      expect(definition).toMatch(
        /from public\.assessment_drafts draft[\s\S]{0,180}assessment_type = 'test'[\s\S]{0,100}for update;/,
      )
      expect(definition).toContain('v_draft.version is distinct from p_expected_draft_version')
      expect(definition).toContain("message = 'draft_version_conflict'")
      expect(definition).toMatch(
        /coalesce\(v_question->>'id', ''\) !~\*[\s\S]{0,180}\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}/,
      )
      // Two distinct incoming question ids can each independently resolve to
      // the same physical row (one via artifact_id, the other via
      // source_artifact_id) and pass the ambiguity check individually. Guard
      // against a second id silently reusing an already-claimed row.
      expect(definition).toMatch(
        /v_matched_row_id := v_matched_row_ids\[1\];\s*(?:--.*\s*)*if v_matched_row_id is not null and v_matched_row_id = any\(v_retained_row_ids\) then\s+raise exception using errcode = '22023', message = 'question_identity_ambiguous';\s+end if;/,
      )
      // save's reopen branch and activation must validate identically and
      // skip no-op writes identically — a fix applied to only one of these
      // two near-duplicate loops is exactly how they drift apart.
      expect(definition).toMatch(
        /if nullif\(btrim\(v_question->>'question_text'\), ''\) is null then\s+raise exception using errcode = '22023', message = 'invalid_draft_content';\s+end if;/,
      )
      expect(definition).toMatch(
        /where question\.id = v_matched_row_id\s+and \(\s+question\.question_type is distinct from v_question->>'question_type'/,
      )
    }

    expect(saveDefinition).toMatch(
      /update public\.assessment_drafts draft[\s\S]{0,220}version = draft\.version \+ 1[\s\S]{0,180}draft\.version = p_expected_draft_version/,
    )
    expect(saveDefinition).toContain("v_test.status in ('active', 'closed')")
    expect(
      saveDefinition.indexOf("coalesce(v_question->>'id', '') !~*"),
    ).toBeLessThan(
      saveDefinition.indexOf("if v_test.status in ('active', 'closed') then"),
    )
    expect(saveDefinition).toMatch(
      /coalesce\(question\.source_artifact_id, question\.artifact_id\)\s+= v_question_id/,
    )
    expect(saveDefinition).not.toContain('question.id = v_question_id')
    expect(saveDefinition).toMatch(
      /update public\.tests test[\s\S]{0,260}where test\.id = p_test_id[\s\S]{0,80}test\.status = v_test\.status/,
    )
    expect(activationDefinition).toContain("v_test.status is distinct from 'draft'")
    expect(activationDefinition).toContain("message = 'test_not_draft'")
    expect(activationDefinition).toMatch(
      /coalesce\(question\.source_artifact_id, question\.artifact_id\)\s+= v_question_id/,
    )
    expect(activationDefinition).not.toContain('question.id = v_question_id')
    expect(activationDefinition).toMatch(
      /insert into public\.test_questions \([\s\S]{0,180}artifact_id[\s\S]{0,320}p_test_id,[\s\S]{0,80}v_question_id/,
    )
    expect(activationDefinition).toMatch(
      /update public\.tests test[\s\S]{0,240}status = 'active'[\s\S]{0,120}test\.status = 'draft'/,
    )
    expect(migration).toContain('grant execute on function public.save_test_draft_atomic(')
    expect(migration).toContain('grant execute on function public.activate_test_from_draft_atomic(')
    expect(saveDefinition).toContain(
      "p_content->'question_identity_version' is distinct from '1'::jsonb",
    )
    expect(saveDefinition).not.toContain(
      "p_content ? 'question_identity_version'",
    )
    expect(activationDefinition).toContain(
      "v_draft.content->'question_identity_version' is distinct from '1'::jsonb",
    )
    expect(migration).toContain(
      'create unique index if not exists test_questions_test_portable_identity_unique',
    )
    expect(migration).toMatch(
      /on public\.test_questions \(\s*test_id,\s*\(coalesce\(source_artifact_id, artifact_id\)\)\s*\)/,
    )
    expect(migration).toMatch(
      /create unique index if not exists tests_classroom_active_portable_identity_unique[\s\S]{0,220}coalesce\(source_artifact_id, artifact_id\)[\s\S]{0,120}where blueprint_archived_at is null/,
    )
    expect(migration).toContain(
      'assessment_drafts_test_question_identity_version_check',
    )
    expect(migration).toContain(
      "content->'question_identity_version' is not distinct from '1'::jsonb",
    )
  })

  it('freezes materialized questions once student work exists', () => {
    const definition = functionDefinition('lock_test_parent_for_child_mutation')

    expect(definition).toContain("tg_op = 'UPDATE'")
    expect(definition).toContain('to_jsonb(new) - array[')
    expect(definition).toContain('to_jsonb(old) - array[')
    for (const cacheField of [
      'ai_reference_cache_key',
      'ai_reference_cache_answers',
      'ai_reference_cache_model',
      'ai_reference_cache_generated_at',
      'updated_at',
    ]) {
      expect(definition).toContain(`'${cacheField}'`)
    }
    expect(definition).toContain('is not distinct from')
    const classroomLock = definition.indexOf('from public.classrooms classroom')
    const testLock = definition.indexOf('from public.tests test', classroomLock)
    expect(classroomLock).toBeGreaterThanOrEqual(0)
    expect(testLock).toBeGreaterThan(classroomLock)
    expect(definition.slice(classroomLock, testLock)).toContain('for update;')
    expect(definition).toMatch(
      /from public\.tests test[\s\S]{0,180}for update;/,
    )
    expect(definition).toContain("tg_table_name = 'test_questions'")
    expect(definition).toContain("test.status in ('active', 'closed')")
    expect(definition).toContain('from public.test_attempts attempt')
    expect(definition).toContain('from public.test_responses response')
    expect(definition).toContain("errcode = '55000'")
    expect(definition).toContain('message = \'test_questions_locked: Test questions cannot be changed after student work exists\'')
    expect(databaseContract).toContain(
      'AI reference cache did not persist after student work',
    )
    expect(databaseContract).toContain(
      'AI reference cache changed the Classroom structural revision',
    )
    expect(databaseContract).toContain(
      'Concurrent Test saves did not serialize at the Classroom row',
    )
  })

  it('locks Classroom before Test for student save and submission RPCs', () => {
    const atomicSubmitContract = readFileSync(
      resolve(process.cwd(), 'scripts/check-atomic-test-submit.sh'),
      'utf8',
    )

    for (const name of ['save_test_attempt_atomic', 'submit_test_attempt_atomic']) {
      const definition = functionDefinition(name)
      const discovery = definition.indexOf('from public.tests test')
      const classroomLock = definition.indexOf('from public.classrooms classroom')
      const testLock = definition.indexOf('from public.tests test', discovery + 1)
      const legacyCall = definition.indexOf(`private.${name}_pre_parent_lock_order`)

      expect(discovery).toBeGreaterThanOrEqual(0)
      expect(classroomLock).toBeGreaterThan(discovery)
      expect(testLock).toBeGreaterThan(classroomLock)
      expect(legacyCall).toBeGreaterThan(testLock)
      expect(definition.slice(discovery, classroomLock)).not.toContain('for share;')
      expect(definition.slice(classroomLock, testLock)).toContain('for share;')
      expect(definition.slice(testLock, legacyCall)).toContain('for share;')
      expect(definition.slice(testLock, legacyCall)).toContain(
        'test.classroom_id = v_classroom_id',
      )
    }

    expect(migration).toContain(
      'set schema private;',
    )
    expect(migration).toContain(
      'revoke all on function private.save_test_attempt_atomic_pre_parent_lock_order',
    )
    expect(migration).toContain(
      'revoke all on function private.submit_test_attempt_atomic_pre_parent_lock_order',
    )
    expect(atomicSubmitContract).toContain('run_parent_order_race save 41')
    expect(atomicSubmitContract).toContain('run_parent_order_race submit 42')
    expect(atomicSubmitContract).toContain(
      'attempt held Test while waiting for Classroom',
    )
  })

  it('maps active classroom capture questions by stable identity', () => {
    const definition = functionDefinition(
      'create_course_blueprint_atomic_v2_pre_managed_storage',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expect(definition.slice(0, definition.indexOf(
      'insert into public.course_blueprint_operations (',
    ))).toMatch(
      /p_operation_type not in \('import', 'capture'\)[\s\S]{0,120}errcode = '22023'/,
    )
    expectReadOnlyStableQuestionIdentityValidation(definition, 'Captured')
    expectDurableIdentityFailureLedger(definition)
    expect(definition).toMatch(
      /update public\.assignments[\s\S]{0,420}where classroom_id = p_source_classroom_id\s+and blueprint_archived_at is null\s+and position = v_position/,
    )
    expect(definition).toMatch(
      /from public\.tests as source_test\s+where source_test\.classroom_id = p_source_classroom_id\s+and source_test\.blueprint_archived_at is null\s+and coalesce\(source_test\.source_artifact_id, source_test\.artifact_id\)/,
    )
    expect(definition).toMatch(
      /from public\.lesson_plans lesson\s+where lesson\.classroom_id = p_source_classroom_id\s+and lesson\.blueprint_archived_at is null/,
    )
    expect(definition).toMatch(
      /update public\.classwork_materials[\s\S]{0,340}where classroom_id = p_source_classroom_id\s+and blueprint_archived_at is null\s+and position = coalesce/,
    )
    expect(definition).toMatch(
      /update public\.surveys[\s\S]{0,340}where classroom_id = p_source_classroom_id\s+and blueprint_archived_at is null\s+and position = coalesce/,
    )
    expect(definition).toContain(
      'from public.save_course_blueprint_version_atomic(',
    )
    expect(definition).toMatch(
      /update public\.tests test\s+set source_blueprint_version_id = v_version\.id[\s\S]{0,500}coalesce\(\s*test\.source_artifact_id,\s*test\.artifact_id\s*\)/,
    )
    expect(definition).not.toMatch(
      /update public\.tests\s+set\s+artifact_id/,
    )
  })

  it('uses Version provenance for captured-origin Test proposal membership', () => {
    const definition = functionDefinition(
      'apply_course_blueprint_classroom_proposal_atomic',
    )

    expect(definition).toMatch(
      /test\.source_artifact_id is not null\s+or exists \(\s+select 1\s+from public\.course_blueprint_versions source_version\s+where source_version\.id = test\.source_blueprint_version_id\s+and source_version\.course_blueprint_id = v_proposal\.course_blueprint_id/,
    )
    expect(definition).toMatch(
      /coalesce\(test\.source_artifact_id, test\.artifact_id\) = v_logical_id/,
    )
    expect(databaseContract).toContain(
      'Capture did not record Version membership without rewriting Test identity',
    )
    expect(databaseContract).toContain(
      'Proposal did not update the captured origin Test in place',
    )
    expect(databaseContract).toContain(
      'Proposal archived or adopted the local-only Test',
    )
    expect(databaseContract).toContain(
      'Proposal duplicated the captured portable Test identity',
    )
  })

  it('maps archived classroom reuse questions by stable identity', () => {
    const definition = functionDefinition(
      'create_archived_classroom_blueprint_atomic',
    )

    expect(definition).toContain('security definer')
    expect(definition).toContain("set search_path = ''")
    expectReadOnlyStableQuestionIdentityValidation(definition, 'Archived')
    expect(definition).toMatch(
      /from public\.tests as source_test\s+where source_test\.classroom_id = p_source_classroom_id\s+and source_test\.blueprint_archived_at is null\s+and coalesce\(source_test\.source_artifact_id, source_test\.artifact_id\)/,
    )
    expectDurableIdentityFailureLedger(definition)
    const ledgerValidation = definition.indexOf(
      'select *\n  into v_operation\n  from public.course_blueprint_operations',
    )
    const winnerReplay = definition.indexOf(
      'if v_classroom.source_blueprint_id is not null then',
    )
    expect(ledgerValidation).toBeGreaterThanOrEqual(0)
    expect(winnerReplay).toBeGreaterThan(ledgerValidation)
    expect(definition.slice(ledgerValidation, winnerReplay)).toContain(
      "v_operation.operation_type <> 'import'",
    )
    expect(definition.slice(ledgerValidation, winnerReplay)).toContain(
      'v_operation.request_sha256 <> p_request_sha256',
    )
    expect(definition.slice(ledgerValidation, winnerReplay)).toContain(
      "'error_code', 'idempotency_conflict'",
    )
    expect(definition.slice(0, ledgerValidation)).toMatch(
      /insert into public\.course_blueprint_operations \([\s\S]{0,700}on conflict \(id\) do nothing/,
    )
    expect(definition.slice(winnerReplay)).toMatch(
      /update public\.course_blueprint_operations\s+set\s+status = 'completed',[\s\S]{0,500}attempt_count = case when status = 'failed' then attempt_count \+ 1 else attempt_count end[\s\S]{0,500}result_blueprint_id = v_classroom\.source_blueprint_id[\s\S]{0,500}where id = p_operation_id/,
    )
    expect(definition).toMatch(
      /v_classroom\.blueprint_source_revision <> p_expected_source_revision[\s\S]{0,500}status = 'failed'[\s\S]{0,500}error_code = 'source_classroom_changed'/,
    )
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
    expect(definition).toContain('source_test.value || jsonb_build_object(')
    expect(definition).toMatch(/'questions',\s*'\[\]'::jsonb/)
    expect(definition).toMatch(
      /'draft_content',[\s\S]{0,260}'\{question_identity_version\}',\s*'1'::jsonb/,
    )
    expect(definition).toMatch(
      /public\.instantiate_course_blueprint_atomic_v2_pre_question_identity\([\s\S]{0,300}v_compatibility_plan/,
    )
    expect(definition).toMatch(
      /source_test\.source_artifact_id = \(v_item->>'artifact_id'\)::uuid/,
    )
    expect(definition).not.toMatch(/delete from public\.test_questions/)
    expect(definition).toMatch(
      /insert into public\.test_questions \([\s\S]{0,260}artifact_id,[\s\S]{0,100}source_artifact_id,[\s\S]{0,100}source_blueprint_version_id/,
    )
    expect(definition).toMatch(
      /\(v_child->>'artifact_id'\)::uuid,[\s\S]{0,80}\(v_child->>'artifact_id'\)::uuid,[\s\S]{0,80}p_blueprint_version_id/,
    )
    expect(definition).not.toMatch(
      /update public\.test_questions[\s\S]{0,220}position = coalesce\(\(v_child->>'position'/,
    )
    const ledgerSeed = definition.indexOf(
      'insert into public.course_blueprint_operations (',
    )
    const rematerializationSavepoint = definition.indexOf(
      '\n  begin\n',
      ledgerSeed,
    )
    const compatibilityCall = definition.indexOf(
      'v_result := public.instantiate_course_blueprint_atomic_v2_pre_question_identity(',
    )
    expect(ledgerSeed).toBeGreaterThanOrEqual(0)
    expect(rematerializationSavepoint).toBeGreaterThan(ledgerSeed)
    expect(compatibilityCall).toBeGreaterThan(rematerializationSavepoint)
    expect(definition).toContain('exception when others then')
    expect(definition).toContain('v_error_sqlstate = returned_sqlstate')
    expect(definition).toContain(
      "v_error_code := 'test_question_identity_mapping_failed'",
    )
    expect(definition).toMatch(
      /status = 'failed',[\s\S]{0,180}attempt_count = case when status = 'failed' then attempt_count \+ 1 else attempt_count end/,
    )
    expect(definition).toContain('result_classroom_id = null')
    expect(definition).toContain('resource_counts = v_resource_counts')
    expect(definition).not.toMatch(
      /exception when others then\s+perform set_config\('pika\.identity_mapping', 'off', true\);\s+raise;/,
    )
  })

  it('backfills legacy draft row IDs to portable identity transactionally', () => {
    const draftLock = migration.indexOf(
      'lock table public.assessment_drafts in exclusive mode;',
    )
    const questionLock = migration.indexOf(
      'lock table public.test_questions in share row exclusive mode;',
    )
    const identityMappingOn = migration.indexOf(
      "perform set_config('pika.identity_mapping', 'on', true);",
      questionLock,
    )
    const draftBackfill = migration.indexOf(
      'update public.assessment_drafts',
      identityMappingOn,
    )
    const identityMappingOff = migration.indexOf(
      "perform set_config('pika.identity_mapping', 'off', true);",
      draftBackfill,
    )
    expect(draftLock).toBeGreaterThanOrEqual(0)
    expect(questionLock).toBeGreaterThan(draftLock)
    expect(identityMappingOn).toBeGreaterThan(questionLock)
    expect(draftBackfill).toBeGreaterThan(identityMappingOn)
    expect(identityMappingOff).toBeGreaterThan(draftBackfill)
    expect(migration).toContain(
      "raise exception 'Legacy Test draft question identity backfill is ambiguous'",
    )
    expect(migration).toContain(
      "raise exception 'Legacy Test draft question identity is not UUIDv4'",
    )
    expect(migration).toContain(
      "raise exception 'Legacy Test draft resolved portable identity is not UUIDv4'",
    )
    expect(migration).toContain(
      "raise exception 'Legacy Test draft question identity backfill reuses one row'",
    )
    expect(migration).toContain(
      "raise exception 'Legacy Test draft question identity backfill produces duplicate portable identity'",
    )
    expect(migration).toMatch(
      /from public\.assessment_drafts[\s\S]{0,120}assessment_type = 'test'/,
    )
    expect(migration).toMatch(
      /coalesce\(\s*source_question\.source_artifact_id,\s*source_question\.artifact_id,\s*source_question\.id\s*\)/,
    )
    expect(migration).toMatch(
      /update public\.assessment_drafts\s+set\s+content = jsonb_set\([\s\S]{0,240}'\{question_identity_version\}'[\s\S]{0,120}'1'::jsonb[\s\S]{0,120}version = public\.assessment_drafts\.version \+ 1/,
    )
    expect(migration).toContain('if not v_is_portable then')
    expect(migration).toContain(
      "raise exception 'Portable Test draft question identity does not match persisted lineage'",
    )
  })

  it('prefers the exact legacy row ID before portable-identity fallback', () => {
    expect(migration).toMatch(
      /select source_question\.id\s+into v_question_row_id\s+from public\.test_questions as source_question\s+where source_question\.test_id = v_draft\.assessment_id\s+and source_question\.id = v_question_id/,
    )
    expect(migration).toMatch(
      /if v_question_row_id is null then\s+select array_agg\(source_question\.id order by source_question\.id\)\s+into v_question_row_ids[\s\S]{0,360}coalesce\(\s*source_question\.source_artifact_id,\s*source_question\.artifact_id\s*\) = v_question_id/,
    )
    expect(migration).not.toMatch(
      /source_question\.artifact_id = v_question_id\s+or source_question\.source_artifact_id = v_question_id\s+or source_question\.id = v_question_id/,
    )
  })

  it('runs the rollback and replay database contract in CI', () => {
    expect(ciWorkflow).toContain(
      'bash scripts/check-blueprint-question-ordinal-identity.sh',
    )
    expect(ciWorkflow).toContain(
      'bash scripts/check-blueprint-question-identity-migration-lifecycle.sh',
    )
    expect(migrationLifecycleContract).toContain(
      'supabase db reset --local --version 133 --no-seed',
    )
    expect(migrationLifecycleContract).toContain(
      'pnpm exec tsx scripts/check-test-question-identity-pre-migration.ts',
    )
    expect(migrationLifecycleContract).toContain('supabase migration up --local')
    expect(migrationLifecycleContract).toContain(
      'Actual 133-to-134 migration did not backfill the collision',
    )
    expect(migrationLifecycleContract).toContain(
      'Migrated collision did not survive save and activation',
    )
    expect(databaseContract).toContain(
      'Non-UUIDv4 draft question identity unexpectedly saved',
    )
    expect(databaseContract).toContain(
      'Rejected non-UUIDv4 draft identity changed persisted Test state',
    )
    expect(databaseContract).toContain(
      'Legacy row-ID precedence did not resolve the question-zero identity collision',
    )
    expect(databaseContract).toContain(
      'Backfill did not mark the canonical portable draft identity version',
    )
    expect(databaseContract).toContain(
      'Portable draft replay re-entered the legacy row-ID namespace',
    )
    expect(databaseContract).toContain(
      'Legacy row-ID precedence mutated persisted question rows',
    )
    expect(databaseContract).toContain(
      'Post-backfill save and activation did not preserve canonical question identity',
    )
    expect(databaseContract).toContain(
      'Instantiated Test draft did not retain the portable identity discriminator',
    )
    expect(databaseContract).toContain(
      'Migration fence did not wait behind the in-flight draft save',
    )
    expect(databaseContract).toContain(
      'Migration-first draft identity rewrite deadlocked with a draft save',
    )
    expect(databaseContract).toContain(
      'Migration identity backfill advanced the Classroom structural revision',
    )
    expect(databaseContract).toContain(
      'Stale archived request did not retain its failed ledger',
    )
    expect(databaseContract).toContain(
      'Stale archived operation did not reconcile to the winner',
    )
    expect(databaseContract).toContain(
      'create function public.b134_archived_reuse_plan',
    )
    expect(databaseContract).toContain(
      'Archived reuse after save failed',
    )
    expect(databaseContract).toContain(
      'Archived reuse before activation failed',
    )
    expect(databaseContract).toContain(
      'b134_archive_holds_before_save',
    )
    expect(databaseContract).toContain(
      'b134_archive_holds_before_activation',
    )
  })
})
