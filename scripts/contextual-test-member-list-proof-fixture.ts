/** Inert finite member-list source. Review and coordinator manifest acceptance
 * precede execution; all data belongs to one disposable inherited project. */
import assert from 'node:assert/strict'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
export { testOwnerDigest }

export const TEST_MEMBER_LIST_CAPS = Object.freeze({ sqlBytes: 65536, networkRequests: 256, storageRequests: 0, rpcRequests: 0,
  requestMs: 15000, responseBytes: 8388608, totalBytes: 67108864, actions: 200, controls: 4000, totalMs: 900000,
  controlMs: 45000, tables: 1024, rowsPerTable: 10000, snapshotRows: 100000 })
export const TEST_MEMBER_LIST_INVENTORY = Object.freeze({ actors: 5, classes: 5, tests: 8, questions: 4, attempts: 4,
  responses: 5, availability: 3, allocatedEnrollments: 8, liveEnrollments: 7, removedGenerations: 1, activeGenerations: 7,
  triggerCategories: 15, archiveRevisionRows: 5, cases: 9 })
export const TEST_MEMBER_LIST_TEST_FIELDS = 'id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,gradebook_weight,created_by,created_at,updated_at'
const fullTestFields = `${TEST_MEMBER_LIST_TEST_FIELDS},artifact_id,source_artifact_id,source_blueprint_version_id,blueprint_archived_at,gradebook_category_id,gradebook_maximum_override,gradebook_score_scale,questions_locked_at`
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
const literal = (value: unknown): string => value === null ? 'null' : typeof value === 'string' ? q(value) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : json(value)
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_MEMBER_LIST_CAPS.sqlBytes); return sql }
export function newTestMemberListFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `testmemberlist_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const h = testOwnerDigest(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const now = original.manifest.now
  const actors = (['student', 'teacher', 'student', 'teacher', 'student'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classes = ['visible', 'empty', 'archived', 'hidden', 'foreign'].map((label, i) => ({ id: id(`class${i}`), label,
    owner: actors[i === 4 ? 1 : 0].id, title: `${tag} ${label}`, code: `${tag}_${i}`, archived_at: i === 2 ? now : null,
    feature_visibility: { tests: i !== 3, classwork: true } }))
  const tests = (['active', 'active', 'closed', 'active', 'closed', 'closed', 'draft', 'active'] as const).map((status, i) => ({
    id: id(`test${i}`), classroom_id: classes[i === 7 ? 4 : 0].id, title: `${tag} test ${i}`, status, show_results: i === 2,
    documents: [{ id: id(`document${i}`), title: '  Instructions  ', source: 'text' as const, content: 'Synthetic instructions.' }],
    position: i === 0 ? 17 : 9, points_possible: 100, include_in_final: i !== 2, gradebook_weight: 10 + i,
    created_by: classes[i === 7 ? 4 : 0].owner, created_at: new Date(Date.parse(now) - i * 1000).toISOString(), updated_at: now,
    artifact_id: id(`artifact${i}`), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: i === 4 ? now : null,
    gradebook_maximum_override: 25, gradebook_score_scale: 2, questions_locked_at: null }))
  const enrollments = [[0, 0], [0, 2], [0, 3], [0, 4], [1, 2], [2, 2], [3, 2], [4, 1]].map(([c, a], i) => ({ id: id(`enrollment${i}`), classroomId: classes[c].id, actorId: actors[a].id }))
  const removed = enrollments[3]
  const questions = [4, 4, 5, 7].map((t, i) => ({ id: id(`question${i}`), artifact_id: id(`question-artifact${i}`), test_id: tests[t].id,
    question_type: i === 0 ? 'multiple_choice' : 'open_response', question_text: `Synthetic question ${i}`,
    options: i === 0 ? ['Zero', 'One'] : [], correct_option: i === 0 ? 1 : null, position: i }))
  const attempts = [[2, 2, true, true, false], [3, 2, false, false, true], [0, 3, true, false, false], [5, 3, false, true, true]]
    .map(([t, a, submitted, returned, locked], i) => ({ id: id(`attempt${i}`), test_id: tests[Number(t)].id, student_id: actors[Number(a)].id,
      is_submitted: Boolean(submitted), returned_at: returned ? now : null, closed_for_grading_at: locked ? now : null }))
  const responses = [[0, 2, 0, null], [1, 2, null, 'Meaningful synthetic answer'], [2, 2, null, '   '], [1, 4, null, 'Removed member noise'], [3, 2, null, 'Foreign Class noise']]
    .map(([qi, a, option, text], i) => ({ id: id(`response${i}`), test_id: questions[Number(qi)].test_id, question_id: questions[Number(qi)].id,
      student_id: actors[Number(a)].id, selected_option: option as number | null, response_text: text as string | null }))
  const availability = [[1, 2, 'closed'], [4, 2, 'open'], [1, 3, 'open']].map(([t, a, state], i) => ({ id: id(`availability${i}`),
    test_id: tests[Number(t)].id, student_id: actors[Number(a)].id, state: state as 'open' | 'closed' }))
  const cases = [[0, 2, 200], [0, 3, 200], [1, 2, 200], [2, 2, 403], [3, 2, 403], [0, 4, 403], [0, 1, 403], [0, 0, 403], [4, 2, 403]]
    .map(([c, a, status], i) => ({ label: `case-${i}`, classroomId: classes[c].id, actorId: actors[a].id, status }))
  //082/095: initial1 + categories3 + enrollments(4 insert,1 delete) +
  // Tests7 + questions3 + attempts4 + responses4 + availability3 +
  //112's ten blueprint Class updates =40. Foreign:1+3+1+1+1+1+2=10.
  //112: initial1 + Test/question inserts; no reset or maintenance bypass.
  const sideEffects = classes.map((c, i) => ({ classroomId: c.id, archiveRevision: [40, 5, 5, 5, 10][i], blueprintSourceRevision: [11, 1, 1, 1, 3][i] }))
  const allocatedIds = [...actors.map(a => a.id), ...classes.map(c => c.id), ...tests.flatMap(t => [t.id, t.artifact_id, t.documents[0].id]),
    ...enrollments.map(e => e.id), ...questions.flatMap(r => [r.id, r.artifact_id]), ...attempts.map(r => r.id), ...responses.map(r => r.id), ...availability.map(r => r.id)]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length); assert(allocatedIds.every(value => !original.allocatedIds.includes(value)))
  return freeze({ version: 1 as const, tag, now, inventory: TEST_MEMBER_LIST_INVENTORY, actors, classes, tests, enrollments, removed, questions, attempts, responses, availability, cases, sideEffects, allocatedIds })
}
export type TestMemberListFixture = ReturnType<typeof newTestMemberListFixture>

/** Additive read-only check for the independently source-bound253 namespace.
 * Original inherited guard text remains present and unchanged. */
export function testMemberListGuardSql(projectId: string) {
  const original = testOwnerGuardSql(projectId), terminal = "end;$guard$;select 'ok';rollback;"
  assert(original.endsWith(terminal))
  return bounded(original.slice(0, -terminal.length) + `declare
 quota_proc pg_catalog.pg_proc;settings_table pg_catalog.pg_class;begin
 select quota_catalog_proc.* into strict quota_proc from pg_catalog.pg_proc quota_catalog_proc where quota_catalog_proc.oid='private.enforce_classroom_test_quota_v1()'::regprocedure;
 select c.* into strict settings_table from pg_catalog.pg_class c where c.oid='private.classroom_test_quota_settings'::regclass;
 if quota_proc.proowner::regrole::text<>'postgres' or not quota_proc.prosecdef
 or quota_proc.prorettype::regtype::text<>'trigger' or quota_proc.provolatile<>'v'
 or quota_proc.proretset or quota_proc.pronargs<>0 or quota_proc.proargtypes::text<>''
 or quota_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or quota_proc.proconfig is distinct from array['search_path=""']::text[]
 or pg_catalog.md5(quota_proc.prosrc)<>'8e21004e27de5796420497e475ab808b'
 or exists(select 1 from pg_catalog.aclexplode(coalesce(quota_proc.proacl,pg_catalog.acldefault('f',quota_proc.proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>quota_proc.proowner)
 or not settings_table.relrowsecurity or settings_table.relforcerowsecurity or settings_table.relowner::regrole::text<>'postgres'
 or settings_table.relkind<>'r' or settings_table.relpersistence<>'p'
 or exists(select 1 from pg_catalog.aclexplode(coalesce(settings_table.relacl,pg_catalog.acldefault('r',settings_table.relowner))) a where a.grantee<>settings_table.relowner)
 or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=settings_table.oid and acl.grantee<>settings_table.relowner)
 or (select count(*) from private.classroom_test_quota_settings)<>1
 or not exists(select 1 from private.classroom_test_quota_settings where singleton and not enabled)
 or (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=settings_table.oid and a.attnum>0 and not a.attisdropped) is distinct from array['singleton','enabled']::text[]
 or not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=settings_table.oid and a.attname='singleton' and a.attnotnull and a.atttypid='boolean'::regtype and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='true')
 or (select count(*) from pg_catalog.pg_constraint c where c.conrelid=settings_table.oid)<>2
 or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=settings_table.oid and c.contype='p' and c.conkey=array[(select a.attnum from pg_catalog.pg_attribute a where a.attrelid=settings_table.oid and a.attname='singleton')]::smallint[])
 or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid=settings_table.oid and c.contype='c' and pg_catalog.pg_get_expr(c.conbin,c.conrelid)='singleton')
 or not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=settings_table.oid and a.attname='enabled' and a.attnotnull and a.atttypid='boolean'::regtype and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='false')
 or not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass and t.tgname='enforce_classroom_test_quota' and not t.tgisinternal
   and t.tgenabled='O' and t.tgfoid=quota_proc.oid and t.tgtype=23 and t.tgnargs=0 and t.tgqual is null
   and t.tgattr::text=(select a.attnum::text from pg_catalog.pg_attribute a where a.attrelid='public.tests'::regclass and a.attname='classroom_id'))
 then raise exception 'Dormant source-bound quota253 metadata differs';end if;end;
${terminal}`)
}
export function testMemberListSetupSql(f: TestMemberListFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const ids = f.allocatedIds.map(q).join(','), fields = Object.keys(f.tests[0]), removed = f.removed
  const tables = ['users', 'classrooms', 'tests', 'test_questions', 'assessment_drafts', 'test_attempts', 'test_responses', 'test_student_availability', 'classroom_enrollments']
  return bounded(`${testMemberListGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ declare owned uuid[]:=array[${ids}]::uuid[];begin
 if ${tables.map(t => `exists(select 1 from public.${t} where id=any(owned))`).join('\n or ')}
 or exists(select 1 from public.users where email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned))
 or exists(select 1 from public.gradebook_categories where classroom_id=any(owned))
 or exists(select 1 from public.test_questions where test_id=any(owned) or artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.test_attempts where test_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.test_responses where test_id=any(owned) or student_id=any(owned) or question_id=any(owned))
 or exists(select 1 from public.test_student_availability where test_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.classroom_enrollments where classroom_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.managed_storage_objects where classroom_id=any(owned) or resource_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Member list namespace collision';end if;end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(r => `(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,archived_at,feature_visibility) values ${f.classes.map(c => `(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},${literal(c.archived_at)},${json(c.feature_visibility)})`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e => `(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};
insert into public.tests(${fields.join(',')}) values ${f.tests.map(t => `(${fields.map(field => literal(t[field as keyof typeof t])).join(',')})`).join(',')};
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,answer_key,sample_solution,points,response_max_chars,response_monospace,position)
values ${f.questions.map(r => `(${q(r.id)},${q(r.artifact_id)},${q(r.test_id)},${q(r.question_type)},${q(r.question_text)},${json(r.options)},${literal(r.correct_option)},${literal(r.question_type === 'open_response' ? 'Synthetic answer' : null)},null,1,5000,false,${r.position})`).join(',')};
insert into public.test_attempts(id,test_id,student_id,responses,is_submitted,submitted_at,returned_at,closed_for_grading_at) values ${f.attempts.map(r => `(${q(r.id)},${q(r.test_id)},${q(r.student_id)},'{}'::jsonb,${r.is_submitted},${r.is_submitted ? q(f.now) : 'null'},${literal(r.returned_at)},${literal(r.closed_for_grading_at)})`).join(',')};
insert into public.test_responses(id,test_id,question_id,student_id,selected_option,response_text) values ${f.responses.map(r => `(${q(r.id)},${q(r.test_id)},${q(r.question_id)},${q(r.student_id)},${literal(r.selected_option)},${literal(r.response_text)})`).join(',')};
insert into public.test_student_availability(id,test_id,student_id,state) values ${f.availability.map(r => `(${q(r.id)},${q(r.test_id)},${q(r.student_id)},${q(r.state)})`).join(',')};
do $removed$ declare affected integer;begin
 delete from public.classroom_enrollments where id=${q(removed.id)} and classroom_id=${q(removed.classroomId)} and student_id=${q(removed.actorId)};
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Member list removal differs';end if;
 if (select count(*) from private.pal_membership_generations where generation_id=${q(removed.id)} and state='removed' and scope_digest=private.pal_membership_scope(${q(removed.classroomId)}::uuid,${q(removed.actorId)}::uuid))<>1
 or (select count(*) from private.pal_membership_generations where generation_id in (${f.enrollments.filter(e => e !== removed).map(e => q(e.id)).join(',')}) and state='active')<>7
 then raise exception 'Member list generations differ';end if;end;$removed$;
do $effects$ begin
 if (select count(*) from public.gradebook_categories where classroom_id in (${f.classes.map(c => q(c.id)).join(',')}))<>15
 or (select count(*) from public.classroom_archive_revisions where classroom_id in (${f.classes.map(c => q(c.id)).join(',')}))<>5
 or exists(select 1 from (values ${f.sideEffects.map(e => `(${q(e.classroomId)}::uuid,${e.archiveRevision},${e.blueprintSourceRevision})`).join(',')}) e(classroom_id,archive_revision,blueprint_revision)
 left join public.classrooms c on c.id=e.classroom_id left join public.classroom_archive_revisions a on a.classroom_id=e.classroom_id
 where a.revision is distinct from e.archive_revision or c.blueprint_source_revision is distinct from e.blueprint_revision)
 then raise exception 'Natural member list revision effects differ';end if;end;$effects$;commit;`)
}
export function testMemberListSnapshotSql(f: TestMemberListFixture) {
  const actors = f.actors.map(a => q(a.id)).join(','), classes = f.classes.map(c => q(c.id)).join(',')
  const tests = `select id from public.tests where classroom_id in (${classes})`
  const scopes: Array<[string, string]> = [['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`],
    ['public.tests', `classroom_id in (${classes})`], ['public.gradebook_categories', `classroom_id in (${classes})`],
    ...['test_questions', 'test_attempts', 'test_responses', 'test_student_availability'].map(t => [`public.${t}`, `test_id in (${tests})`] as [string, string]),
    ['public.assessment_drafts', `classroom_id in (${classes}) or assessment_id in (${tests})`], ['public.classroom_enrollments', `classroom_id in (${classes})`],
    ['public.classroom_roster', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${tests})`], ['public.managed_storage_json_references', `test_id in (${tests})`],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(e => q(e.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ...['pal_membership_settings', 'pal_classroom_signal_settings', 'classroom_test_quota_settings'].map(t => [`private.${t}`, 'true'] as [string, string])]
  const fingerprints = `(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',
 query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r',n.nspname,c.relname),true,false,'')::text)
 order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  return bounded(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';
select jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')},'__all_fingerprints',${fingerprints});rollback;`)
}
export type TestMemberListSnapshot = Record<string, Array<Record<string, unknown>>>
export function validateTestMemberListSetupSnapshot(f: TestMemberListFixture, input: unknown, expectedTables: readonly string[]): TestMemberListSnapshot {
  assert(Buffer.byteLength(JSON.stringify(input)) <= TEST_MEMBER_LIST_CAPS.responseBytes)
  assert(input && typeof input === 'object' && !Array.isArray(input)); const s = input as TestMemberListSnapshot
  const counts: Record<string, number> = { 'public.users': 5, 'public.classrooms': 5, 'public.tests': 8, 'public.gradebook_categories': 15, 'public.test_questions': 4,
    'public.test_attempts': 4, 'public.test_responses': 5, 'public.test_student_availability': 3, 'public.classroom_enrollments': 7,
    'public.classroom_archive_revisions': 5, 'public.assessment_drafts': 0, 'public.classroom_roster': 0, 'public.managed_storage_objects': 0,
    'public.managed_storage_json_references': 0, 'public.pal_event_outbox': 0, 'private.pal_membership_outbox': 0, 'private.pal_membership_generations': 8,
    'private.pal_membership_settings': 1, 'private.pal_classroom_signal_settings': 1, 'private.classroom_test_quota_settings': 1 }
  assert.deepEqual(Object.keys(s).sort(), [...Object.keys(counts), '__all_fingerprints'].sort())
  assert(Object.values(s).every(rows => Array.isArray(rows) && rows.length <= TEST_MEMBER_LIST_CAPS.rowsPerTable && rows.every(r => r && typeof r === 'object' && !Array.isArray(r))))
  assert(Object.values(s).reduce((n, rows) => n + rows.length, 0) <= TEST_MEMBER_LIST_CAPS.snapshotRows)
  assert(expectedTables.length > 0 && expectedTables.length <= TEST_MEMBER_LIST_CAPS.tables && new Set(expectedTables).size === expectedTables.length)
  assert(expectedTables.every(t => /^(public|private|storage)\.[a-z_0-9]+$/.test(t)))
  for (const [table, count] of Object.entries(counts)) assert.equal(s[table].length, count)
  for (const row of s.__all_fingerprints) { assert.deepEqual(Object.keys(row).sort(), ['fingerprint', 'table']); assert(typeof row.fingerprint === 'string' && row.fingerprint.length > 0 && row.fingerprint.length <= 4096) }
  assert.deepEqual(s.__all_fingerprints.map(r => r.table).sort(), [...expectedTables].sort())
  function subset(table: string, plans: Array<{ id: string }>) {
    assert.equal(new Set(s[table].map(r => r.id)).size, plans.length)
    for (const plan of plans) { const row = s[table].find(r => r.id === plan.id); assert(row)
      for (const [key, value] of Object.entries(plan)) {
        if (key.endsWith('_at') && value !== null) { assert(typeof row[key] === 'string'); assert.equal(new Date(row[key]).toISOString(), value) }
        else assert.deepEqual(row[key], value)
      }
    }
  }
  subset('public.users', f.actors); subset('public.classrooms', f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code, archived_at: c.archived_at, feature_visibility: c.feature_visibility })))
  subset('public.tests', f.tests); subset('public.test_questions', f.questions); subset('public.test_attempts', f.attempts)
  subset('public.test_responses', f.responses); subset('public.test_student_availability', f.availability)
  subset('public.classroom_enrollments', f.enrollments.filter(e => e !== f.removed).map(e => ({ id: e.id, classroom_id: e.classroomId, student_id: e.actorId })))
  assert.equal(new Set(s['public.gradebook_categories'].map(r => r.id)).size, 15)
  for (const c of f.classes) {
    const rows = s['public.gradebook_categories'].filter(r => r.classroom_id === c.id); assert.equal(rows.length, 3)
    for (const [i, name] of ['Attendance', 'Term', 'Final'].entries()) { const r = rows.find(r => r.name === name); assert(r)
      assert.equal(r.percentage, [10, 65, 25][i]); assert.equal(r.position, i); assert.equal(r.is_default, i === 1); assert.equal(r.default_assessment_weight, 10)
      assert(typeof r.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.id) && !f.allocatedIds.includes(r.id))
    }
  }
  for (const row of s['public.tests']) { assert.deepEqual(Object.keys(row).sort(), fullTestFields.split(',').sort()); assert(s['public.gradebook_categories'].some(c => c.id === row.gradebook_category_id && c.classroom_id === row.classroom_id && c.is_default === true)) }
  assert.equal(new Set(s['public.classroom_archive_revisions'].map(r => r.classroom_id)).size, 5)
  for (const effect of f.sideEffects) {
    assert.equal(s['public.classrooms'].find(r => r.id === effect.classroomId)!.blueprint_source_revision, effect.blueprintSourceRevision)
    const r = s['public.classroom_archive_revisions'].find(r => r.classroom_id === effect.classroomId); assert(r)
    assert.deepEqual(Object.keys(r).sort(), ['classroom_id', 'revision', 'updated_at']); assert.equal(r.revision, effect.archiveRevision)
    assert(typeof r.updated_at === 'string' && Number.isFinite(Date.parse(r.updated_at)))
  }
  assert.equal(new Set(s['private.pal_membership_generations'].map(r => r.generation_id)).size, 8)
  assert.equal(new Set(s['private.pal_membership_generations'].map(r => r.pal_reference)).size, 8)
  for (const e of f.enrollments) {
    const r = s['private.pal_membership_generations'].find(r => r.generation_id === e.id); assert(r)
    assert.equal(r.state, e === f.removed ? 'removed' : 'active'); assert.equal(r.scope_digest, testOwnerDigest(`pika-membership-scope-v1:${e.classroomId}:${e.actorId}`))
    assert(typeof r.pal_reference === 'string' && /^pika-membership-v1-[a-f0-9]{32}$/.test(r.pal_reference))
  }
  assert.equal(s['private.pal_membership_settings'][0].enabled, false); assert.equal(s['private.pal_classroom_signal_settings'][0].enabled, false)
  assert.deepEqual(s['private.classroom_test_quota_settings'], [{ singleton: true, enabled: false }])
  return s
}
/** Independently enumerated compatibility expectations, not app helper output. */
export function testMemberListExpectedResult(f: TestMemberListFixture, c: TestMemberListFixture['cases'][number], s: TestMemberListSnapshot) {
  assert.equal(c.status, 200)
  const student = c.actorId === f.actors[2].id
  const statuses = student ? ['not_started', 'not_started', 'can_view_results', 'responded', 'responded', 'not_started'] : ['responded', 'not_started', 'not_started', 'not_started', 'not_started', 'can_view_results']
  const effective = student ? ['open', 'closed', 'closed', 'open', 'open', 'closed'] : ['open', 'open', 'closed', 'open', 'closed', 'closed']
  const visibleDocs = student ? [true, false, true, true, true, false] : [true, true, false, true, false, true]
  const tests = f.tests.slice(0, 6).filter(t => t.classroom_id === c.classroomId).map((t, i) => {
    const persisted = s['public.tests'].find(r => r.id === t.id)!; assert(persisted)
    const projected = Object.fromEntries(TEST_MEMBER_LIST_TEST_FIELDS.split(',').map(k => [k, persisted[k]]))
    return { ...projected, id: t.id, status: t.status, position: t.position, created_at: persisted.created_at as string,
      assessment_type: 'test', documents: visibleDocs[i] ? [{ ...t.documents[0], title: 'Instructions' }] : [], student_status: statuses[i],
      access_state: f.availability.find(r => r.test_id === t.id && r.student_id === c.actorId)?.state ?? null, effective_access: effective[i] }
  })
  tests.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || b.position - a.position || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
  return { tests }
}
