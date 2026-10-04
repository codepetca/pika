/** Inert finite source preparation: reviewed SQL/request manifests and explicit
 * parent acceptance are required before any isolated execution. */
import assert from 'node:assert/strict'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'

export { testOwnerDigest, testOwnerGuardSql }
export const TEST_OWNER_LIST_CAPS = Object.freeze({ sqlBytes: 65536, networkRequests: 256, storageRequests: 0, rpcRequests: 0, requestMs: 15000, responseBytes: 8388608 })
export const TEST_OWNER_LIST_INVENTORY = Object.freeze({ actors: 5, classes: 3, tests: 4, questions: 4, drafts: 2, attempts: 4, responses: 5, availability: 5,
  allocatedEnrollments: 5, liveEnrollments: 4, removedGenerations: 1, activeGenerations: 4, triggerCategories: 9, archiveRevisionRows: 3, cases: 8 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
export function newTestOwnerListFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `testownerlist_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const h = testOwnerDigest(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'student', 'teacher', 'student'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classes = [0, 1, 2].map(i => ({ id: id(`class${i}`), owner: actors[i === 0 ? 0 : 1].id, title: `${tag} class ${i}`, code: `${tag}_${i}` }))
  // 082/095: revision=1 + resource changes + Class updates. 112 makes
  // each Test/question/Test-draft insert update its Class blueprint revision.
  // 147 creates three category resources per Class. No maintenance bypass.
  // A: 1+3 categories+5 enrollment mutations+3 Tests+4 questions+2 drafts
  // +4 attempts+5 responses+5 availability+9 blueprint Class updates = 41.
  // B: 1+3 categories+1 enrollment+1 Test+1 blueprint update = 7; C: 1+3 = 4.
  const sideEffects = classes.map((c, i) => ({ classroomId: c.id, archiveRevision: [41, 7, 4][i], blueprintSourceRevision: [10, 2, 1][i] }))
  const tests = (['draft', 'active', 'closed', 'draft'] as const).map((status, i) => ({ id: id(`test${i}`), classroom_id: classes[i === 3 ? 1 : 0].id,
    created_by: classes[i === 3 ? 1 : 0].owner, title: `${tag} test ${i}`, status, show_results: false, position: i === 0 ? 17 : 9,
    points_possible: 100, include_in_final: i !== 2, created_at: new Date(Date.parse(original.manifest.now) - i * 1000).toISOString(), updated_at: original.manifest.now,
    artifact_id: id(`test-artifact${i}`), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
    gradebook_maximum_override: 25, gradebook_score_scale: 2, gradebook_weight: 11 + i, questions_locked_at: null,
    documents: i === 1 ? [{ id: id('text-document'), title: '  Instructions  ', source: 'text', content: 'Synthetic instructions.' }] : [] }))
  const enrollments = [[0, 0], [0, 2], [0, 3], [0, 4], [1, 1]].map(([c, a], i) => ({ id: id(`enrollment${i}`), classroomId: classes[c].id, actorId: actors[a].id }))
  const questions = [0, 1, 1, 2].map((t, i) => ({ id: id(`question${i}`), artifact_id: id(`question-artifact${i}`), test_id: tests[t].id,
    question_type: i === 1 ? 'multiple_choice' : 'open_response', question_text: `Synthetic question ${i}`, options: i === 1 ? ['Zero', 'One'] : [], correct_option: i === 1 ? 1 : null, position: i }))
  const draftQuestionIds = [questions[0].artifact_id, id('draft-extra-question')]
  const drafts = [0, 2].map((t, i) => ({ id: id(`draft${i}`), assessment_id: tests[t].id, classroom_id: classes[0].id, owner: actors[0].id, version: 7,
    content: { question_identity_version: 1, title: `${tag} overlay ${i}`, show_results: true,
      questions: i === 0 ? draftQuestionIds.map((qid, n) => ({ id: qid, question_type: 'open_response', question_text: `Synthetic overlay ${n}`, options: [], correct_option: null,
        answer_key: 'Synthetic answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false })) : [] } }))
  const attempts = [[1, 3, true], [1, 4, true], [2, 0, true], [2, 3, false]].map(([t, a, submitted], i) => ({ id: id(`attempt${i}`), test_id: tests[Number(t)].id, student_id: actors[Number(a)].id, is_submitted: Boolean(submitted) }))
  const responses = [[1, 2, 0, null], [2, 2, null, 'Meaningful synthetic answer'], [1, 4, 1, null], [3, 3, null, '   '], [3, 0, null, 'Owner excluded']].map(([qi, a, option, text], i) => {
    const question = questions[Number(qi)]
    return { id: id(`response${i}`), test_id: question.test_id, question_id: question.id, student_id: actors[Number(a)].id, selected_option: option as number | null, response_text: text as string | null }
  })
  const availability = [[1, 2, 'closed'], [2, 2, 'open'], [0, 3, 'open'], [2, 4, 'open'], [2, 0, 'open']].map(([t, a, state], i) => ({ id: id(`availability${i}`), test_id: tests[Number(t)].id, student_id: actors[Number(a)].id, state: state as 'open' | 'closed' }))
  const cases = [[0, 0, 200], [1, 1, 200], [2, 1, 200], [0, 2, 403], [0, 3, 403], [0, 4, 403], [0, 1, 403], [1, 0, 403]].map(([c, a, status], i) => ({ label: `case-${i}`, classroomId: classes[c].id, actorId: actors[a].id, status }))
  const stats = [[2, 0, 0, 0, 2, 2], [2, 2, 1, 1, 1, 2], [2, 0, 0, 1, 1, 1], [0, 0, 0, 0, 0, 0]].map(([total_students, responded, submitted, open_access, closed_access, questions_count]) => ({ total_students, responded, submitted, open_access, closed_access, questions_count }))
  const allocatedIds = [...actors.map(r => r.id), ...classes.map(r => r.id), ...tests.flatMap(r => [r.id, r.artifact_id]), ...enrollments.map(r => r.id),
    ...questions.flatMap(r => [r.id, r.artifact_id]), ...drafts.map(r => r.id), draftQuestionIds[1], id('text-document'), ...attempts.map(r => r.id), ...responses.map(r => r.id), ...availability.map(r => r.id)]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length); assert(allocatedIds.every(value => !original.allocatedIds.includes(value)))
  return freeze({ version: 1 as const, tag, now: original.manifest.now, inventory: TEST_OWNER_LIST_INVENTORY, sideEffects, actors, classes, tests, enrollments, questions, drafts, attempts, responses, availability, cases, stats, allocatedIds })
}
export type TestOwnerListFixture = ReturnType<typeof newTestOwnerListFixture>
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_LIST_CAPS.sqlBytes); return sql }
export function testOwnerListSetupSql(f: TestOwnerListFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const ids = f.allocatedIds.map(q).join(','); const removed = f.enrollments[3]
  const tables = ['users', 'classrooms', 'tests', 'test_questions', 'assessment_drafts', 'test_attempts', 'test_responses', 'test_student_availability', 'classroom_enrollments']
  const fields = Object.keys(f.tests[0])
  const literal = (value: unknown) => value === null ? 'null' : typeof value === 'string' ? q(value) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : json(value)
  return bounded(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ declare owned uuid[]:=array[${ids}]::uuid[]; begin
 if ${tables.map(t => `exists(select 1 from public.${t} where id=any(owned))`).join('\n or ')}
 or exists(select 1 from public.users where email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned))
 or exists(select 1 from public.gradebook_categories where classroom_id=any(owned))
 or exists(select 1 from public.test_questions where test_id=any(owned) or artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.test_attempts where test_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.test_responses where test_id=any(owned) or question_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.test_student_availability where test_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.classroom_enrollments where classroom_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.managed_storage_objects where classroom_id=any(owned) or resource_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Test list namespace collision';end if;
end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(r => `(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(r => `(${q(r.id)},${q(r.owner)},${q(r.title)},${q(r.code)},'{"classwork":true}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(r => `(${q(r.id)},${q(r.classroomId)},${q(r.actorId)})`).join(',')};
insert into public.tests(${fields.join(',')}) values ${f.tests.map(r => `(${fields.map(field => literal(r[field as keyof typeof r])).join(',')})`).join(',')};
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,answer_key,sample_solution,points,response_max_chars,response_monospace,position)
values ${f.questions.map(r => `(${q(r.id)},${q(r.artifact_id)},${q(r.test_id)},${q(r.question_type)},${q(r.question_text)},${json(r.options)},${literal(r.correct_option)},'Synthetic answer',null,1,5000,false,${r.position})`).join(',')};
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
values ${f.drafts.map(r => `(${q(r.id)},'test',${q(r.assessment_id)},${q(r.classroom_id)},${json(r.content)},${r.version},${q(r.owner)},${q(r.owner)})`).join(',')};
insert into public.test_attempts(id,test_id,student_id,responses,is_submitted,submitted_at) values ${f.attempts.map(r => `(${q(r.id)},${q(r.test_id)},${q(r.student_id)},'{}'::jsonb,${r.is_submitted},${r.is_submitted ? q(f.now) : 'null'})`).join(',')};
insert into public.test_responses(id,test_id,question_id,student_id,selected_option,response_text) values ${f.responses.map(r => `(${q(r.id)},${q(r.test_id)},${q(r.question_id)},${q(r.student_id)},${literal(r.selected_option)},${literal(r.response_text)})`).join(',')};
insert into public.test_student_availability(id,test_id,student_id,state) values ${f.availability.map(r => `(${q(r.id)},${q(r.test_id)},${q(r.student_id)},${q(r.state)})`).join(',')};
do $removed$ declare affected integer; begin
 delete from public.classroom_enrollments where id=${q(removed.id)} and classroom_id=${q(removed.classroomId)} and student_id=${q(removed.actorId)};
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test list removal differs';end if;
 if (select count(*) from private.pal_membership_generations where generation_id=${q(removed.id)} and state='removed' and scope_digest=private.pal_membership_scope(${q(removed.classroomId)}::uuid,${q(removed.actorId)}::uuid))<>1
 or (select count(*) from private.pal_membership_generations where generation_id in (${f.enrollments.filter(r => r !== removed).map(r => q(r.id)).join(',')}) and state='active')<>4
 then raise exception 'Test list retained generations differ';end if;
 if (select count(*) from public.gradebook_categories where classroom_id in (${f.classes.map(c => q(c.id)).join(',')}))<>9
 or exists(select 1 from unnest(array[${f.classes.map(c => q(c.id)).join(',')}]::uuid[]) c(id)
 where (select count(*) from public.gradebook_categories g where g.classroom_id=c.id)<>3)
 then raise exception 'Test list generated categories differ';end if;
end;$removed$;
do $effects$ begin
 if (select count(*) from public.classroom_archive_revisions where classroom_id in (${f.classes.map(c => q(c.id)).join(',')}))<>3
 or exists(select 1 from (values ${f.sideEffects.map(e => `(${q(e.classroomId)}::uuid,${e.archiveRevision},${e.blueprintSourceRevision})`).join(',')}) expected(classroom_id,archive_revision,blueprint_revision)
 left join public.classroom_archive_revisions a using(classroom_id)
 left join public.classrooms c on c.id=expected.classroom_id
 where a.revision is distinct from expected.archive_revision or c.blueprint_source_revision is distinct from expected.blueprint_revision)
 then raise exception 'Test list natural revision effects differ';end if;
end;$effects$;commit;`)
}
export function testOwnerListSnapshotSql(f: TestOwnerListFixture) {
  const actors = f.actors.map(r => q(r.id)).join(','); const classes = f.classes.map(r => q(r.id)).join(','); const tests = f.tests.map(r => q(r.id)).join(',')
  const scopes = [['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`], ['public.tests', `id in (${tests})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.test_questions', `test_id in (${tests})`], ['public.assessment_drafts', `classroom_id in (${classes}) or assessment_id in (${tests})`],
    ['public.test_attempts', `test_id in (${tests})`], ['public.test_responses', `test_id in (${tests})`], ['public.test_student_availability', `test_id in (${tests})`],
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_roster', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${tests})`], ['public.managed_storage_json_references', `test_id in (${tests})`],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(r => q(r.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ['private.pal_membership_settings', 'true'], ['private.pal_classroom_signal_settings', 'true']]
  return bounded(`begin read only;set local lock_timeout='3s';set local statement_timeout='30s';select jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')});rollback;`)
}
