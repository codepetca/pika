import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'

const sql = () => readFileSync('supabase/migrations/249_contextual_test_draft_owner_save.sql', 'utf8')

// Source assertions are regression fences, not transactional runtime evidence.
describe('contextual owner Test draft PATCH migration source contract', () => {
  it('seals every helper and gives only service role the two entrypoints', () => {
    const source = sql()
    for (const name of ['snapshot_test_draft_save_for_owner_v1', 'finish_test_draft_save_for_owner_v1']) {
      expect(source).toContain(`function public.${name}(`)
      expect(source).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`, 's'))
      expect(source).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, 's'))
    }
    const helpers = [...source.matchAll(/create function private\.(\w+)\(/g)].map(match => match[1])
    expect(helpers.length).toBeGreaterThan(1)
    for (const name of helpers) expect(source).toMatch(new RegExp(`revoke all on function private\\.${name}\\([^;]+from public, anon, authenticated, service_role`, 's'))
    expect(source).not.toMatch(/auth\.uid|users\.role|teacher_entitlements|set_config\(/)
  })

  it('reuses immutable247 parent locks and binds the complete raw documents to a distinct digest', () => {
    const source = sql()
    expect(source).toContain('private.test_draft_owner_source_v1(')
    expect(source).toContain("v_source - 'source_sha256'")
    expect(source).toContain("'documents', v_test.documents, 'updated_at', v_test.updated_at")
    expect(source).toContain("extensions.digest(v_source::text, 'sha256')")
    expect(source).toContain("v_source->>'source_sha256' is distinct from p_expected_source_sha256")
    expect(source).toContain('v_before.classroom_id is distinct from p_classroom_id')
  })

  it('permits initialized save or verified inspect only and fences version overflow and future stamps', () => {
    const source = sql()
    expect(source).toContain("p_operation not in ('inspect', 'save')")
    expect(source).toContain("p_operation = 'save' and v_source->'draft' = 'null'::jsonb")
    expect(source).toContain('v_before.version = 2147483647')
    expect(source).toContain('v_before.updated_at > pg_catalog.transaction_timestamp()')
    expect(source).toContain('v_test.updated_at > pg_catalog.transaction_timestamp()')
    expect(source).not.toMatch(/insert into public\.assessment_drafts|on conflict[^;]*do update/is)
  })

  it('validates bounded portable candidate and document envelopes independently in SQL', () => {
    const source = sql()
    for (const limit of ['2097152', '8388608', '67108864', '10000']) expect(source).toContain(limit)
    expect(source).toContain("p_content->'question_identity_version' is distinct from '1'::jsonb")
    expect(source).toContain('v_question_id = any(v_seen_ids)')
    expect(source).toContain('pg_catalog.jsonb_array_length(p_documents) > 20')
    expect(source).toContain('snapshot_managed_object_id')
    expect(source).toContain('v_object.classroom_id is distinct from p_classroom_id')
  })

  it('accepts marked GET-compatible baselines without applying strict candidate validation to raw legacy fields', () => {
    const source = sql()
    expect(source).toContain('function private.test_draft_save_baseline_valid_v1(p_content jsonb)')
    expect(source).toContain('private.test_draft_save_baseline_valid_v1(v_before.content)')
    expect(source).not.toContain('private.validate_test_draft_save_content_v1(v_before.content,true)')
    const baseline = source.slice(source.indexOf('create function private.test_draft_save_baseline_valid_v1('), source.indexOf('revoke all on function private.test_draft_save_baseline_valid_v1('))
    // Extra raw top/question keys are deliberately ignored, just as GET does.
    expect(baseline).not.toContain('jsonb_object_keys')
    expect(baseline).not.toContain('?&')
    expect(baseline).toContain("p_content->'question_identity_version' is distinct from '1'::jsonb")
    expect(baseline).toContain("v_question->'points' is null or v_question->'points' = 'null'::jsonb")
    expect(baseline).toContain("v_question->'response_max_chars' is null or v_question->'response_max_chars' = 'null'::jsonb")
    expect(baseline).toContain('v_seen_ids')
    expect(baseline).toContain("v_question->>'question_type' = 'open_response'")
    expect(baseline).toContain('return false')
    // Strict decoding remains exclusively on the new canonical candidate.
    expect(source).toContain("perform private.validate_test_draft_save_content_v1(p_content,v_test.status='draft')")
  })

  it('delegates only to134 SQL and checks actual post-trigger rows, work and precise revisions', () => {
    const source = sql()
    expect(source).toContain('public.save_test_draft_atomic(')
    expect(source).toContain('pg_catalog.to_jsonb(v_after) is distinct from pg_catalog.to_jsonb(v_expected)')
    expect(source).toContain('v_state_after->\'student_work\' is distinct from v_state_before->\'student_work\'')
    expect(source).toContain('v_question_mutations')
    expect(source).toContain('v_archive_before + 3 + 2 * v_question_mutations + v_test_changed')
    expect(source).toContain('v_blueprint_before + 1 + v_question_mutations + v_test_changed')
    expect(source).toContain('test_draft_postcondition_failed')
    expect(source).toContain("'test', v_source_after->'test'")
    expect(source).not.toContain("'test', pg_catalog.to_jsonb(v_test)")
  })

  it('retains finite managed identities and queue effects without immediate Storage deletion', () => {
    const source = sql()
    expect(source).toContain('public.managed_storage_json_references')
    expect(source).toContain('public.test_document_snapshot_storage_cleanup')
    expect(source).toContain("'teacher_document'")
    expect(source).toContain('evidence_sha256')
    expect(source).toContain("'embedded_reference_removed'")
    expect(source).not.toMatch(/delete from storage\.|update storage\.|insert into storage\./i)
    expect(source).not.toMatch(/grant execute on function private\./)
    expect(source).toContain("v_object.purpose='test_execution_snapshot'")
    expect(source).toContain("v_object.resource_type is distinct from 'test'")
    expect(source).toContain('v_object.resource_id is distinct from p_test_id')
    expect(source).toContain("retained.value->>'snapshot_managed_object_id'=v_object.id::text")
    expect(source).toContain("baseline.value->>'url'=retained.value->>'url'")
    expect(source).toContain("v_object.purpose is distinct from 'teacher_test_material'")
  })

  it('catches134 suppressed strict RETURNING only inside the writer and validates regenerated references', () => {
    const source = sql()
    const call = source.indexOf('v_inner_result:=public.save_test_draft_atomic(')
    const suppression = source.indexOf('exception when no_data_found then')
    expect(call).toBeGreaterThan(-1)
    expect(suppression).toBeGreaterThan(call)
    expect(suppression).toBeLessThan(source.indexOf('select draft.* into v_after'))
    expect(source).toContain('reference.id=any(v_reference_row_ids)')
    expect(source).toContain('reference.created_at<v_write_started')
    expect(source).toContain('v_object.content_type is distinct from v_question->>\'upload_content_type\'')
    expect(source).not.toMatch(/create or replace|alter table|create trigger|disable trigger/i)
  })

  it('keeps raw snapshot identity and the four authorized server fields without legacy key widening', () => {
    const source = sql()
    expect(source).toContain("document.value->>'id' = v_document->>'id' and document.value->>'source' = 'link'")
    expect(source).toContain("document.value->>'url' = v_document->>'url'")
    expect(source).toContain("where key in ('snapshot_path','snapshot_managed_object_id','snapshot_content_type','synced_at')")
    expect(source).toContain("v_document := v_document - array['snapshot_path','snapshot_managed_object_id','snapshot_content_type','synced_at']")
    expect(source).toContain("message='test_draft_identity_conflict'")
    expect(source).toContain('v_questions_before_map')
    expect(source).toContain('v_questions_after_map')
  })

  it('retains a submitted valid upload URL while binding every managed reference to its exact identity', () => {
    const source = sql()
    expect(source).toContain("where key not in ('id','title','source','url','storage_bucket','storage_path','managed_object_id','upload_content_type')")
    expect(source).toContain("if v_document ? 'url' and (pg_catalog.jsonb_typeof(v_document->'url') is distinct from 'string'")
    expect(source).toContain("pg_catalog.char_length(v_document->>'url')>4096")
    expect(source).toContain('public.managed_storage_payload_has_exact_reference(v_documents,object.id,object.storage_bucket,object.storage_path)')
    expect(source).not.toContain("v_document := v_document - 'url'")
  })

  it('closes contention and exact policy errors while preserving unknown capability errors', () => {
    const source = sql()
    expect(source).toContain("set lock_timeout = '1s'")
    expect(source).toContain("interval '8 seconds'")
    expect(source).toContain("interval '20 seconds'")
    expect(source).toContain("when sqlstate '40P01' or sqlstate '55P03' or sqlstate '40001' or sqlstate '23505'")
    expect(source).toContain("message = 'test_questions_locked: Only question wording and existing choice text can change after a student starts'")
    expect(source).not.toMatch(/when[^;]*42501|set statement_timeout|errcode = '40001'/s)
    expect(source.match(/clock_timestamp\(\) >= v_phase_deadline/g)?.length).toBeGreaterThanOrEqual(4)
  })
})

// These execute the existing GET decoder to pin the compatibility examples
// consumed by the separately executed SQL fixture. They do not execute SQL.
describe('stored baseline compatibility examples for the SQL predicate', () => {
  const question = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', question_type: 'multiple_choice', question_text: 'Question', options: ['First', 'Second'], correct_option: 0 }
  const baseline = { title: 'Test', show_results: false, question_identity_version: 1, questions: [question] }
  const validate = (value: unknown) => validateTestDraftContent(value, { allowEmptyQuestionText: true, requirePortableQuestionIdentity: true })

  it('accepts ignored raw top/question fields and missing optional fields', () => {
    const result = validate({ ...baseline, legacy_extra: { ignored: true }, questions: [{ ...question, legacy_question_extra: 'ignored' }] })
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected GET-compatible baseline')
    expect(result.value.questions[0]).toMatchObject({ points: 1, response_max_chars: 5000, response_monospace: false, answer_key: null, sample_solution: null })
    expect(result.value).not.toHaveProperty('legacy_extra')
    expect(result.value.questions[0]).not.toHaveProperty('legacy_question_extra')
  })

  it('accepts open-response defaults and existing finite Number coercions', () => {
    const result = validate({ ...baseline, questions: [{ id: question.id, question_type: 'open_response', question_text: '', points: '0x5', response_max_chars: ['1000'], response_monospace: 'ignored default' }] })
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected GET-compatible baseline')
    expect(result.value.questions[0]).toMatchObject({ options: [], correct_option: null, answer_key: null, sample_solution: null, points: 5, response_max_chars: 1000, response_monospace: false })
  })

  it.each([
    { ...baseline, title: null },
    { ...baseline, show_results: 'false' },
    { ...baseline, question_identity_version: undefined },
    { ...baseline, questions: [{ ...question, id: 'invalid' }] },
    { ...baseline, questions: [question, { ...question, id: question.id.toUpperCase() }] },
    { ...baseline, questions: [{ ...question, question_text: null }] },
    { ...baseline, questions: [{ ...question, correct_option: '0' }] },
    { ...baseline, questions: [{ ...question, points: 'Infinity' }] },
  ])('rejects malformed required fields, portable identity, duplicates or nonfinite grading', value => {
    expect(validate(value).valid).toBe(false)
  })
})
