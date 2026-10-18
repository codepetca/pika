import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Source/CPU evidence only. No SQL parser, database execution, native acceptance
// or elapsed-time fit is claimed by these tests.
const sql = readFileSync('scripts/contextual-surveys-db-contracts.sql', 'utf8')
const migration = readFileSync('supabase/migrations/269_contextual_surveys_workflow.sql', 'utf8')
const matrix = sql.slice(sql.indexOf('-- Payload subset,'))
const cases = ['owner-patch', 'question-create', 'question-update', 'expected-question', 'expected-questions', 'detail-owner', 'detail-member']
const readCases = ['list-owner', 'list-member', 'results-owner', 'results-member']
const countCases = ['results-owner', 'results-member', 'detail-questions-owner', 'detail-questions-member', 'detail-responses-member-joint', 'list-owner', 'list-member', 'response-questions']
const fourMiB = 4194304, eightMiB = 8388608
// Independent ASCII JSONB-text size model for this fixed construction. This is
// not a general PostgreSQL serializer or an assertion about HTTP wire size.
function asciiJsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(asciiJsonbText).join(', ')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${asciiJsonbText(entry)}`).join(', ')}}`
  return JSON.stringify(value)
}

describe('bounded rollback-only Survey SQL payload subset', () => {
  it('keeps the existing one-dispatch transaction, statement deadline and compact output', () => {
    expect(sql).toMatch(/^--[\s\S]*?\nbegin;\nset local statement_timeout = '35s';\nset local lock_timeout = '1s';/)
    expect(sql.match(/do \$contract\$/g)).toHaveLength(1)
    expect(sql.trimEnd()).toMatch(/rollback;$/)
    expect(Buffer.byteLength(sql)).toBeLessThan(262144)
    expect(sql).not.toMatch(/disable\s+trigger|session_replication_role|alter\s+function|security\s+definer|pg_sleep/i)
    expect([...sql.matchAll(/generate_series\(([^)]+)\)/g)].map(match => match[1])).toEqual(['1,1699', '1,10000', '1,10000'])
    expect(sql).not.toMatch(/raise\s+(notice|log|info)/i)
    expect(sql).toContain('create temporary table survey_payload_receipts(label text primary key,measured_bytes integer not null,measured_count integer,expected_code text,verified boolean not null) on commit drop')
    expect(sql).toContain("'kind','survey-sql-payload-matrix','nativeVerified',false")
    expect(sql).toContain("'schemaVersion',1,'columns',jsonb_build_array('label','bytes','count','code','verified')")
    expect(sql).toContain('jsonb_agg(jsonb_build_array(label,measured_bytes,measured_count,expected_code,verified) order by label)')
  })

  it('enumerates exactly seven paired size guards and five additional input-shape checks', () => {
    const list = matrix.match(/foreach v_case in array array\[([^\]]+)\]/)?.[1]
    expect(list?.split(',').map(value => value.trim().replaceAll("'", ''))).toEqual(cases)
    expect(matrix).toContain('for v_delta in 0..2 loop')
    expect(matrix).toContain("continue when v_delta=2 and v_case in ('detail-owner','detail-member')")
    expect(matrix).toContain("v_limit:=case when v_case in ('owner-patch','question-create','question-update') then 4194304 else 8388608 end")
    expect(matrix).toContain("if v_delta<2 then assert v_measured=v_limit+v_delta,'Exact SQL payload measurement differs';end if")
    expect(matrix).toContain("when 0 then ':exact' when 1 then ':plus-one' else ':shape'")
    expect(cases.reduce((sum, name) => sum + (name.startsWith('detail-') ? 2 : 3), 0)).toBe(19)
  })

  it('keeps source-owned receipt metadata below4KiB without transporting generated payloads', () => {
    const receipts = [
      ...cases.flatMap(name => ['exact','plus-one', ...(name.startsWith('detail-') ? [] : ['shape'])].map(suffix => [`${name}:${suffix}`, eightMiB + 1, null, 'PT409', true])),
      ...readCases.flatMap(name => ['exact','plus-one'].map(suffix => [`${name}:${suffix}`, eightMiB + 1, null, 'PT503', true])),
      ...['exact','plus-one','shape'].map(suffix => [`response-vector:${suffix}`, eightMiB + 1, null, 'PT400', true]),
      ...countCases.flatMap(name => ['exact','plus-one'].map(suffix => [`count-${name}:${suffix}`, eightMiB, 10001, 'PT503', true])),
      ...['response-empty','response-keys-short','response-keys-extra'].map(name => [`count-${name}`, 1000, 2, 'PT400', true]),
    ]
    const upperReceipt = { kind: 'survey-sql-payload-matrix', nativeVerified: false, schemaVersion: 1, columns: ['label','bytes','count','code','verified'], cases: receipts }
    expect(receipts).toHaveLength(49)
    expect(Buffer.byteLength(asciiJsonbText(upperReceipt))).toBeLessThan(4096)
    // Both null and the other fixed codes are no larger than this conservative
    // ASCII model. PostgreSQL execution/framing bytes remain separately unproved.
    expect(matrix).toContain('insert into survey_payload_receipts values(v_case||')
    expect(matrix).toContain('v_measured,null,v_expected_code,true)')
  })

  it.each([0, 1])('constructs independently measured exact4MiB +%i ASCII patch/question JSON', delta => {
    const emptyPatch = { title: '' }
    expect(Buffer.byteLength(asciiJsonbText(emptyPatch))).toBe(13)
    const patch = { title: 'x'.repeat(fourMiB + delta - Buffer.byteLength(asciiJsonbText(emptyPatch))) }
    expect(Buffer.byteLength(asciiJsonbText(patch))).toBe(fourMiB + delta)
    const emptyQuestion = { question_type: 'short_text', question_text: '', options: [], response_max_chars: 4 }
    const question = { ...emptyQuestion, question_text: 'x'.repeat(fourMiB + delta - Buffer.byteLength(asciiJsonbText(emptyQuestion))) }
    expect(Buffer.byteLength(asciiJsonbText(question))).toBe(fourMiB + delta)
    expect(matrix).toContain("repeat('x',v_limit+v_delta-octet_length(v_probe::text))")
    expect(matrix).toContain("v_measured:=octet_length(v_probe::text)")
  })

  it('uses the original public RPCs and proves positive results instead of accepting any exception', () => {
    const dispatches: Record<string, string> = {
      'owner-patch': 'update_survey_for_owner_v1', 'question-create': 'create_survey_question_for_owner_v1',
      'question-update': 'update_survey_question_for_owner_v1', 'expected-question': 'update_survey_question_for_owner_v1',
      'expected-questions': 'respond_to_survey_for_member_v1', 'detail-owner': 'get_survey_for_owner_v1', 'detail-member': 'get_survey_for_member_v1',
    }
    const invocation = matrix.slice(matrix.indexOf('case v_case'), matrix.indexOf('end case;'))
    for (const [name, rpc] of Object.entries(dispatches)) expect(invocation).toMatch(new RegExp(`when '${name}' then[\\s\\S]*?v_result:=public\\.${rpc}\\(`))
    expect(matrix).toContain("execute 'set local role service_role';\n          case v_case")
    expect(matrix).toContain("assert v_code is null,'Exact positive SQL boundary was rejected'")
    expect(matrix).toContain("assert v_result->'survey'->'title'=v_probe->'title'")
    expect(matrix).toContain("assert v_result->'question'->'question_text'=v_probe->'question_text'")
    expect(matrix).toContain("assert v_result='{" + '"success":true,"updated":false' + "}'::jsonb")
    expect(matrix).toContain("assert v_code=v_expected_code and v_message=v_expected_message,'Exact payload denial differs'")
    expect(matrix).toContain('get stacked diagnostics v_code=returned_sqlstate,v_message=message_text')
  })

  it('measures current expected-row/array snapshots and the actual detail guard expression', () => {
    expect(matrix).toContain("update public.survey_questions set question_text=repeat('x',v_limit+v_delta-v_base) where id=v_boundary_question")
    expect(matrix.match(/select to_jsonb\(r\) into v_probe from public\.survey_questions r where id=v_boundary_question/g)).toHaveLength(2)
    expect(matrix.match(/select jsonb_agg\(to_jsonb\(r\) order by position,id\) into v_probe from public\.survey_questions r where survey_id=v_foreign_survey/g)).toHaveLength(2)
    expect(matrix).toContain("select v_measured+octet_length('[]'::jsonb::text)+octet_length(to_jsonb(r)::text)")
    expect(matrix).toContain('NOT an authoring-input claim')
    expect(migration).toContain('octet_length(v_questions::text)+octet_length(v_responses::text)+octet_length(to_jsonb(v_survey)::text)>8388608')
    expect(migration).toContain('octet_length(p_patch::text)>4194304')
    expect(migration).toContain('octet_length(p_question::text)>4194304')
    expect(migration).toContain('octet_length(p_expected_question::text)>8388608')
    expect(migration).toContain('octet_length(p_expected_questions::text)>8388608')
  })

  it('keeps malformed inputs distinct from the actual byte-boundary pairs', () => {
    expect(matrix).toContain("if v_delta=2 then v_probe:='{" + '"unknown":true' + "}'::jsonb;")
    expect(matrix).toContain("if v_delta=2 then v_probe:=jsonb_set(v_question_patch,'{options}','{}'::jsonb);")
    expect(matrix).toContain("if v_delta=2 then v_probe:='{}'::jsonb;")
    for (const code of ['PT400', 'PT409', 'PT503']) expect(matrix).toContain(`'${code}'`)
    for (const message of ['survey_invalid_patch', 'survey_invalid_question', 'survey_question_changed', 'survey_questions_changed', 'survey_payload_limit']) expect(matrix).toContain(`'${message}'`)
  })

  it('authenticates complete scoped rows/revisions and rolls back both success and denial fixtures', () => {
    const state = sql.slice(sql.indexOf('create function pg_temp.survey_payload_state'), sql.indexOf('$payload_state$;') + '$payload_state$;'.length)
    for (const table of ['classrooms', 'classroom_archive_revisions', 'classroom_enrollments', 'gradebook_categories', 'surveys', 'survey_questions', 'survey_responses']) expect(state).toContain(`from public.${table}`)
    expect(state).toContain('from private.pal_membership_generations')
    expect(state).toContain("encode(sha256(convert_to(jsonb_build_object(")
    expect(state).toContain("language sql volatile set search_path = ''")
    expect(state).toContain("revisions',(select coalesce(jsonb_agg(to_jsonb(r)")
    expect(sql).toContain('revoke all on function pg_temp.survey_payload_state(uuid) from public,anon,authenticated,service_role')
    expect(matrix).toContain("pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Denied payload changed data/revisions'")
    expect(matrix).toContain("pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Boundary read changed data/revisions'")
    expect(matrix).toContain("raise exception using errcode='ZP001',message='survey_payload_case_rollback'")
    expect(matrix).toContain("exception when sqlstate 'ZP001' then null;end")
    expect(matrix).toContain("assert v_verified,'Payload case did not reach its independent assertions'")
    expect(matrix).toContain("pg_temp.survey_payload_state(v_foreign_classroom)=v_before,'Payload subtransaction restoration differs'")
    expect(matrix.indexOf("assert v_verified")).toBeLessThan(matrix.indexOf('insert into survey_payload_receipts'))
  })

  it('prepares exact original list/results byte expressions with both read projections', () => {
    expect(matrix).toContain("foreach v_case in array array['list-owner','list-member','results-owner','results-member'] loop")
    expect(matrix).toContain("v_base:=octet_length((v_probe->'surveys')::text)")
    expect(matrix).toContain('v_base:=octet_length(v_probe::text)')
    expect(matrix).toContain("assert v_result=v_probe,'Exact read payload projection differs'")
    for (const name of ['get_surveys_for_owner_v1', 'get_surveys_for_member_v1', 'get_survey_results_for_owner_v1', 'get_survey_results_for_member_v1']) expect(matrix).toContain(`public.${name}(`)
    expect(migration).toContain('octet_length(v_surveys::text)>8388608')
    expect(migration).toContain('octet_length(v_result::text)>8388608')
  })

  it('builds a valid multi-answer vector below each 5000 UTF16 cap, with exact byte assertions', () => {
    // 1700 fixed UUID keys, independent PostgreSQL ASCII JSONB-text model.
    const empty = Object.fromEntries(Array.from({ length: 1700 }, (_, i) => [i.toString(16).padStart(32, '0').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'), { question_type: 'short_text', response_text: 'x' }]))
    const base = Buffer.byteLength(asciiJsonbText(empty))
    for (const delta of [0, 1]) {
      const vector = Object.fromEntries(Object.entries(empty).map(([key, value], i) => [key, { ...value, response_text: 'x'.repeat(1 + Math.min(4999, Math.max(0, eightMiB + delta - base - i * 4999))) }]))
      expect(Buffer.byteLength(asciiJsonbText(vector))).toBe(eightMiB + delta)
      expect(Object.values(vector).every(answer => answer.response_text.length >= 1 && answer.response_text.length <= 5000)).toBe(true)
    }
    expect(matrix).toContain("assert v_measured=8388608+v_delta,'Exact response-vector measurement differs'")
    expect(matrix).toContain('least(4999,greatest(0,8388608+v_delta-v_base-(n-1)*4999))')
    expect(matrix).toContain("assert v_result='{\"success\":true,\"updated\":false}'::jsonb")
    expect(matrix).toContain("'Response-vector stored rows differ'")
    expect(matrix).toContain("'Response-vector fixture restoration differs'")
  })

  it('covers every reachable 10000/+1 count guard using shared fixed fixtures and honest joint attribution', () => {
    expect(matrix).toContain(`foreach v_case in array array[${countCases.map(name => `'${name}'`).join(',')}] loop`)
    expect(matrix).toContain("assert v_count=10000+v_delta,'Exact count measurement differs'")
    expect(matrix).toContain("'Count fixture bytes would mask the count guard'")
    expect(matrix).toContain("'Count subtransaction restoration differs'")
    expect(matrix).toContain("'Count fixture restoration differs'")
    expect(matrix).toContain("assert v_fixture_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_fixture_before")
    expect(matrix.match(/raise exception using errcode='ZP002',message='survey_payload_fixture_rollback'/g)).toHaveLength(2)
    expect(matrix.match(/exception when sqlstate 'ZP002' then null;end/g)).toHaveLength(2)
    expect(matrix.match(/insert into survey_payload_receipts select value->>0/g)).toHaveLength(2)
    for (const result of ['list', 'results', 'detail']) expect(matrix).toContain(`assert v_result=v_probe,'Count ${result} projection differs'`)
    expect(matrix).toContain("v_measured:=octet_length(v_questions::text)+octet_length(v_payload::text)+octet_length((v_probe->'survey')::text)")
    expect(matrix).toContain('response count is joint with the question count')
    expect(matrix).toContain("foreach v_case in array array['response-empty','response-keys-short','response-keys-extra'] loop")
    expect(migration).toContain('jsonb_array_length(v_questions)>10000 or jsonb_array_length(v_responses)>10000')
    expect(migration).toContain('jsonb_array_length(v_surveys)>10000')
    expect(migration).toContain('jsonb_array_length(v_results)>10000')
    expect(migration).toContain('(select count(*) from jsonb_object_keys(p_responses))<>jsonb_array_length(v_questions)')
    expect(sql).not.toContain("'nativeVerified',true")
  })

  it('retains parenthesized CASE expressions inside compound count assertions', () => {
    expect(matrix).toContain("assert jsonb_array_length(v_result->'responses')=(case when v_case='detail-questions-owner' then 0 else 10000 end)")
    expect(matrix).toContain("v_message=(case when v_case='response-questions' then 'survey_invalid_responses' else 'survey_payload_limit' end)")
    expect(matrix).not.toMatch(/assert[^;]+(?:=|<>)case\s+when/)
  })
})
