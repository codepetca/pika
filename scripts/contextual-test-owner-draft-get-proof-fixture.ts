/** Finite inert source preparation. Parent reviews/accepts all SQL and request
 * manifests before native execution; existing lifecycle authority is unchanged. */
import assert from 'node:assert/strict'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
export { testOwnerDigest, testOwnerGuardSql }
export const TEST_OWNER_DRAFT_GET_CAPS = Object.freeze({ sqlBytes: 524288, networkRequests: 30, rpcRequests: 30, storageRequests: 0,
  requestMs: 20000, contentBytes: 2097152, responseBytes: 8388608, exchangeBytes: 67108864 })
export const TEST_OWNER_DRAFT_GET_INVENTORY = Object.freeze({ actors: 4, classes: 3, tests: 12, questions: 1008, drafts: 7,
  enrollments: 4, triggerCategories: 9, archiveRevisionRows: 3, activeGenerations: 4, cases: 15, creates: 3, repairs: 1 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
export function newTestOwnerDraftGetFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `testownerdraftget_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const h = testOwnerDigest(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'student', 'teacher'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classes = [0, 1, 2].map(i => ({ id: id(`class${i}`), owner: actors[i === 0 ? 0 : 1].id, title: `${tag} class ${i}`, code: `${tag}_${i}`, archived: i === 1 }))
  const labels = ['missing-nonempty', 'missing-zero', 'invalid-repair', 'valid-projection', 'active-invalid', 'closed-invalid', 'retired-inspection', 'retired-missing', 'retired-invalid', 'archived-class', 'teacher-owner-zero', 'complete-1001-source'] as const
  const tests = labels.map((label, i) => ({ id: id(`test${i}`), artifact_id: id(`test-artifact${i}`), classroom_id: classes[i === 9 ? 1 : i === 10 ? 2 : 0].id,
    created_by: actors[i === 9 || i === 10 ? 1 : 0].id, title: `${tag} ${label}`, show_results: false, status: i === 4 ? 'active' : i === 5 ? 'closed' : 'draft',
    blueprint_archived_at: i >= 6 && i <= 8 ? original.manifest.now : null, questions_locked_at: i === 4 ? original.manifest.now : null,
    documents: [], source_artifact_id: null, source_blueprint_version_id: null }))
  const questions = [0, 2, 3, 4, 5, 6, 8].map((ti, i) => ({ id: id(`question${i}`), artifact_id: id(`question-artifact${i}`),
    source_artifact_id: ti === 3 ? id('copied-source-question') : null, test_id: tests[ti].id, question_type: 'open_response', question_text: `Synthetic question ${i}`,
    options: [], correct_option: null, answer_key: 'Synthetic answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, position: 0 }))
  questions.push(...Array.from({ length: 1001 }, (_, i) => ({ id: id(`complete-question${i}`), artifact_id: id(`complete-artifact${i}`), source_artifact_id: null,
    test_id: tests[11].id, question_type: 'open_response', question_text: `Synthetic complete question ${i}`, options: [], correct_option: null,
    answer_key: 'Synthetic answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, position: i })))
  const draftOnlyId = id('draft-only-question')
  const drafts = [2, 3, 4, 5, 6, 8, 11].map((ti, i) => {
    const question = questions.find(r => r.test_id === tests[ti].id)!
    const valid = ti === 3 || ti === 6 || ti === 11
    const content = valid ? { title: `${tag} overlay ${ti}`, show_results: true, source_format: 'markdown', source_markdown: 'Synthetic source\r\n',
      question_identity_version: 1,
      questions: (ti === 11 ? [] : [{ ...question, id: question.source_artifact_id ?? question.artifact_id }, ...(ti === 3 ? [{ ...question, id: draftOnlyId, question_text: 'Synthetic draft-only question' }] : [])]).map(r => ({ id: r.id,
        question_type: r.question_type, question_text: r.question_text, options: [], correct_option: null, answer_key: r.answer_key, sample_solution: null,
        points: 1, response_max_chars: 5000, response_monospace: false })) } : { question_identity_version: 1, invalid: 'Synthetic invalid existing draft' }
    return { id: id(`draft${i}`), assessment_type: 'test', assessment_id: tests[ti].id, classroom_id: tests[ti].classroom_id,
      content, version: 7, created_by: actors[0].id, updated_by: actors[0].id }
  })
  const enrollments = [[0, 0], [0, 2], [0, 3], [2, 1]].map(([ci, ai], i) => ({ id: id(`enrollment${i}`), classroom_id: classes[ci].id, student_id: actors[ai].id }))
  const cases = tests.map((t, i) => ({ label: labels[i], testId: t.id, actorId: t.created_by, classroomId: t.classroom_id,
    status: i === 7 || i === 8 || i === 9 ? 403 : 200, operation: i <= 1 || i === 10 ? 'create' : i === 2 ? 'repair' : 'inspect' }))
  cases.push(...[2, 3, 1].map((ai, i) => ({ label: ['member-student-denied', 'member-teacher-denied', 'other-owner-denied'][i] as typeof labels[number],
    testId: tests[3].id, actorId: actors[ai].id, classroomId: classes[0].id, status: 403, operation: 'inspect' })))
  const allocatedIds = [...actors.map(r => r.id), ...classes.map(r => r.id), ...tests.flatMap(r => [r.id, r.artifact_id]),
    ...questions.flatMap(r => [r.id, r.artifact_id, ...(r.source_artifact_id ? [r.source_artifact_id] : [])]), ...drafts.map(r => r.id), ...enrollments.map(r => r.id), draftOnlyId]
  const originalIds = new Set(original.allocatedIds)
  assert.equal(new Set(allocatedIds).size, allocatedIds.length); assert(allocatedIds.every(value => !originalIds.has(value)))
  // Natural 082/095/112/147 effects: Class A starts at1, categories+3,
  // enrollments+3, Tests+10/questions+1008/drafts+7 and1025 Class updates.
  // The lock-only Test update adds one archive revision, no blueprint touch:
  // migration112's UPDATE OF list excludes questions_locked_at. B archives once; C has one
  // enrollment and one Test. No counter is overwritten by setup.
  const sideEffects = classes.map((c, i) => ({ classroomId: c.id, archiveRevision: [2058, 7, 7][i], blueprintSourceRevision: [1026, 2, 2][i] }))
  return freeze({ version: 1 as const, tag, now: original.manifest.now, inventory: TEST_OWNER_DRAFT_GET_INVENTORY, actors, classes, tests, questions, drafts, enrollments, cases, allocatedIds, sideEffects })
}
export type TestOwnerDraftGetFixture = ReturnType<typeof newTestOwnerDraftGetFixture>
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_DRAFT_GET_CAPS.sqlBytes); return sql }
export function testOwnerDraftGetSetupSql(f: TestOwnerDraftGetFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const ids = f.allocatedIds.map(q).join(','); const fields = Object.keys(f.tests[0])
  const literal = (v: unknown): string => v === null ? 'null' : typeof v === 'string' ? q(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : json(v)
  return bounded(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ declare owned uuid[]:=array[${ids}]::uuid[];begin
 if ${['users', 'classrooms', 'tests', 'test_questions', 'assessment_drafts', 'classroom_enrollments', 'test_attempts', 'test_responses', 'test_student_availability', 'managed_storage_objects'].map(t => `exists(select 1 from public.${t} where id=any(owned))`).join('\n or ')}
 or exists(select 1 from public.users where email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.test_questions where test_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.gradebook_categories where classroom_id=any(owned))
 or exists(select 1 from public.classroom_enrollments where classroom_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.managed_storage_objects where classroom_id=any(owned) or resource_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned) or managed_object_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Test draft GET namespace collision';end if;end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(r => `(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(r => `(${q(r.id)},${q(r.owner)},${q(r.title)},${q(r.code)},'{"classwork":false}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(r => `(${q(r.id)},${q(r.classroom_id)},${q(r.student_id)})`).join(',')};
insert into public.tests(${fields.join(',')}) values ${f.tests.map(r => `(${fields.map(field => literal(field === 'questions_locked_at' ? null : r[field as keyof typeof r])).join(',')})`).join(',')};
insert into public.test_questions(${Object.keys(f.questions[0]).join(',')}) values ${f.questions.map(r => `(${Object.values(r).map(literal).join(',')})`).join(',')};
insert into public.assessment_drafts(${Object.keys(f.drafts[0]).join(',')}) values ${f.drafts.map(r => `(${Object.values(r).map(literal).join(',')})`).join(',')};
do $lock$ declare affected integer;begin
 update public.tests set questions_locked_at=${q(f.now)} where id=${q(f.tests[4].id)} and classroom_id=${q(f.classes[0].id)} and status='active' and questions_locked_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test draft GET question lock differs';end if;end;$lock$;
do $archive$ declare affected integer;begin
 update public.classrooms set archived_at=${q(f.now)} where id=${q(f.classes[1].id)} and teacher_id=${q(f.classes[1].owner)} and archived_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test draft GET archive differs';end if;end;$archive$;
do $effects$ begin
 if (select count(*) from public.classroom_archive_revisions where classroom_id in (${f.classes.map(c => q(c.id)).join(',')}))<>3
 or exists(select 1 from (values ${f.sideEffects.map(e => `(${q(e.classroomId)}::uuid,${e.archiveRevision},${e.blueprintSourceRevision})`).join(',')}) expected(classroom_id,archive_revision,blueprint_revision)
 left join public.classroom_archive_revisions a using(classroom_id) left join public.classrooms c on c.id=expected.classroom_id
 where a.revision is distinct from expected.archive_revision or c.blueprint_source_revision is distinct from expected.blueprint_revision)
 then raise exception 'Test draft GET natural revision effects differ';end if;end;$effects$;commit;`)
}
export function testOwnerDraftGetSnapshotSql(f: TestOwnerDraftGetFixture) {
  const actors = f.actors.map(r => q(r.id)).join(','); const classes = f.classes.map(r => q(r.id)).join(','); const tests = f.tests.map(r => q(r.id)).join(',')
  const scopes = [['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`], ['public.tests', `id in (${tests})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.test_questions', `test_id in (${tests})`], ['public.assessment_drafts', `classroom_id in (${classes}) or assessment_id in (${tests})`],
    ...['test_attempts', 'test_responses', 'test_student_availability'].map(t => [`public.${t}`, `test_id in (${tests})`]),
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_roster', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${tests})`], ['public.managed_storage_json_references', `test_id in (${tests})`],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(r => q(r.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ['private.pal_membership_settings', 'true'], ['private.pal_classroom_signal_settings', 'true']]
  // Complete public/private/storage graph fingerprints exclude only the rows
  // whose exact permitted effects are checked from full rows by the matrix.
  // This includes original fixture rows and every unrelated table/row.
  const nonTarget = `(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',
    query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r %s',n.nspname,c.relname,
      case when n.nspname='public' and c.relname='classrooms' then ${q(`where r.id not in (${classes})`)}
      when n.nspname='public' and c.relname='classroom_archive_revisions' then ${q(`where r.classroom_id not in (${classes})`)}
      when n.nspname='public' and c.relname='assessment_drafts' then ${q(`where not (r.classroom_id in (${classes}) or r.assessment_id in (${tests}))`)}
      else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  return bounded(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';select jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')},'__nontarget_fingerprints',${nonTarget});rollback;`)
}
