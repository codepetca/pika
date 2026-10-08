/** Finite inert source preparation. Parent reviews/accepts all SQL and request
 * manifests before native execution; existing lifecycle authority is unchanged. */
import assert from 'node:assert/strict'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
export { testOwnerDigest, testOwnerGuardSql }
export const TEST_OWNER_DRAFT_SAVE_CAPS = Object.freeze({ sqlBytes: 524288, networkRequests: 64, rpcRequests: 64, storageRequests: 0,
  requestMs: 20000, contentBytes: 2097152, responseBytes: 8388608, exchangeBytes: 67108864 })
export const TEST_OWNER_DRAFT_SAVE_INVENTORY = Object.freeze({ actors: 4, classes: 3, tests: 12, questions: 1008, drafts: 8,
  enrollments: 4, triggerCategories: 9, archiveRevisionRows: 3, activeGenerations: 4, cases: 24, creates: 0, repairs: 0, managedObjects: 3 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
export function newTestOwnerDraftSaveFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `testownerdraftsave_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const h = testOwnerDigest(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'student', 'teacher'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classes = [0, 1, 2].map(i => ({ id: id(`class${i}`), owner: actors[i === 0 ? 0 : 1].id, title: `${tag} class ${i}`, code: `${tag}_${i}`, archived: i === 1 }))
  const labels = ['missing-nonempty', 'missing-zero', 'invalid-repair', 'valid-projection', 'active-invalid', 'closed-invalid', 'retired-inspection', 'retired-missing', 'retired-invalid', 'archived-class', 'teacher-owner-zero', 'complete-1001-source'] as const
  const tests = labels.map((label, i) => ({ id: id(`test${i}`), artifact_id: id(`test-artifact${i}`), classroom_id: classes[i === 9 ? 1 : i === 10 ? 2 : 0].id,
    created_by: actors[i === 9 || i === 10 ? 1 : 0].id, title: `${tag} ${label}`, show_results: false, status: i === 4 ? 'active' : i === 5 ? 'closed' : 'draft',
    blueprint_archived_at: i >= 6 && i <= 8 ? original.manifest.now : null, questions_locked_at: i === 4 ? original.manifest.now : null,
    documents: [] as Record<string,unknown>[], source_artifact_id: null, source_blueprint_version_id: null }))
  const questions = [0, 2, 3, 4, 5, 6, 8].map((ti, i) => ({ id: id(`question${i}`), artifact_id: id(`question-artifact${i}`),
    source_artifact_id: ti === 3 ? id('copied-source-question') : null, test_id: tests[ti].id, question_type: ti===4?'multiple_choice':'open_response', question_text: `Synthetic question ${i}`,
    options: ti===4?['Choice A','Choice B']:[] as string[], correct_option: ti===4?0:null, answer_key: ti===4?null:'Synthetic answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, position: 0 }))
  questions.push(...Array.from({ length: 1001 }, (_, i) => ({ id: id(`complete-question${i}`), artifact_id: id(`complete-artifact${i}`), source_artifact_id: null,
    test_id: tests[11].id, question_type: 'open_response', question_text: `Synthetic complete question ${i}`, options: [], correct_option: null,
    answer_key: 'Synthetic answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false, position: i })))
  const draftOnlyId = id('draft-only-question')
  const drafts = [2, 3, 4, 5, 6, 8, 10, 11].map((ti, i) => {
    const question = questions.find(r => r.test_id === tests[ti].id)!
    const valid = ti === 3 || ti === 6 || ti === 10 || ti === 11
    const content = valid ? { title: `${tag} overlay ${ti}`, show_results: true, source_format: 'markdown', source_markdown: 'Synthetic source\n',
      question_identity_version: 1,
      questions: (ti === 10 ? [] : ti===11?questions.filter(r=>r.test_id===tests[11].id).map(r=>({...r,id:r.artifact_id})): [{ ...question, id: question.source_artifact_id ?? question.artifact_id }, ...(ti === 3 ? [{ ...question, id: draftOnlyId, question_text: 'Synthetic draft-only question' }] : [])]).map(r => ({ id: r.id,
        question_type: r.question_type, question_text: r.question_text, options: [], correct_option: null, answer_key: r.answer_key, sample_solution: null,
        points: 1, response_max_chars: 5000, response_monospace: false })) } : { question_identity_version: 1, invalid: 'Synthetic invalid existing draft' }
    if(ti===3){const historical=content as Record<string,unknown>;historical.historical_extension='Ignored marked baseline field';const first=(historical.questions as Array<Record<string,unknown>>)[0];first.historical_question_extension=true;delete first.sample_solution;delete first.response_monospace}
    return { id: id(`draft${i}`), assessment_type: 'test', assessment_id: tests[ti].id, classroom_id: tests[ti].classroom_id,
      content, version: 7, created_by: actors[0].id, updated_by: actors[0].id }
  })
  const enrollments = [[0, 0], [0, 2], [0, 3], [2, 1]].map(([ci, ai], i) => ({ id: id(`enrollment${i}`), classroom_id: classes[ci].id, student_id: actors[ai].id }))
  const cases = tests.map((t, i) => ({ label: String(labels[i]), testId: t.id, actorId: t.created_by, classroomId: t.classroom_id,
    status: i>=6&&i<=9 ? 403 : i<=2?409:200, operation: i<=2?'inspect':'save', kind: 'content' }))
  cases.push(...[2, 3, 1].map((ai, i) => ({ label: ['member-student-denied', 'member-teacher-denied', 'other-owner-denied'][i] as typeof labels[number],
    testId: tests[3].id, actorId: actors[ai].id, classroomId: classes[0].id, status: 403, operation: 'inspect', kind:'content' })))
  cases.push(...[
    [3,'draft-json-patch','patch',200],[4,'started-one-choice','choice',200],[5,'closed-json-patch','patch',200],
    [3,'stale-version','stale',409],[4,'started-structure-denied','structure',409],
    [3,'document-title-preserves-snapshot','doc-title',200],[3,'document-url-retires-snapshot','doc-url',200],
    [3,'managed-upload-same-class','upload',200],[3,'managed-upload-foreign-class','foreign-upload',400],
  ].map(([ti,label,kind,status])=>({label:String(label),testId:tests[Number(ti)].id,actorId:tests[Number(ti)].created_by,
    classroomId:tests[Number(ti)].classroom_id,status:Number(status),operation:'save',kind:String(kind)})))
  const managedObjects=[0,1,2].map(i=>({id:id(`managed${i}`),storage_bucket:'test-documents',storage_path:i===0?`link-docs/${tests[3].id}/snapshots/${id('doc')}.html`:`${tests[3].id}/${id(`upload${i}`)}.pdf`,
    classroom_id:classes[i===2?2:0].id,purpose:i===0?'test_execution_snapshot':'teacher_test_material',status:'verified',created_by_user_id:actors[i===2?1:0].id,
    resource_type:'test',resource_id:tests[3].id,content_type:i===0?'text/html':'application/pdf',byte_size:4,verified_at:original.manifest.now}))
  tests[3].documents=[{id:id('doc'),title:'Synthetic link',source:'link',url:'https://example.invalid/proof',snapshot_path:managedObjects[0].storage_path,
    snapshot_managed_object_id:managedObjects[0].id,snapshot_content_type:'text/html',synced_at:original.manifest.now}]
  const allocatedIds = [...actors.map(r => r.id), ...classes.map(r => r.id), ...tests.flatMap(r => [r.id, r.artifact_id]),
    ...questions.flatMap(r => [r.id, r.artifact_id, ...(r.source_artifact_id ? [r.source_artifact_id] : [])]), ...drafts.map(r => r.id), ...enrollments.map(r => r.id), ...managedObjects.map(r=>r.id),id('doc'),draftOnlyId]
  const originalIds = new Set(original.allocatedIds)
  assert.equal(new Set(allocatedIds).size, allocatedIds.length); assert(allocatedIds.every(value => !originalIds.has(value)))
  // Natural 082/095/112/147 effects: Class A starts at1, categories+3,
  // enrollments+3, Tests+10/questions+1008/drafts+7 and1025 Class updates.
  // The lock-only Test update adds one archive revision, no blueprint touch:
  // migration112's UPDATE OF list excludes questions_locked_at. B archives once; C has one
  // enrollment and one Test. No counter is overwritten by setup.
  const sideEffects = classes.map((c, i) => ({ classroomId: c.id, archiveRevision: [2058, 7, 9][i], blueprintSourceRevision: [1026, 2, 3][i] }))
  return freeze({ version: 1 as const, tag, now: original.manifest.now, inventory: TEST_OWNER_DRAFT_SAVE_INVENTORY, actors, classes, tests, questions, drafts, enrollments, cases, managedObjects,allocatedIds, sideEffects })
}
export type TestOwnerDraftSaveFixture = ReturnType<typeof newTestOwnerDraftSaveFixture>
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_DRAFT_SAVE_CAPS.sqlBytes); return sql }
export function testOwnerDraftSaveSetupSql(f: TestOwnerDraftSaveFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const ids = f.allocatedIds.map(q).join(','); const fields = Object.keys(f.tests[0])
  const literal = (v: unknown): string => v === null ? 'null' : typeof v === 'string' ? q(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : json(v)
  const completeDraft=f.drafts.find(d=>d.assessment_id===f.tests[11].id)!
  const completeContent=`jsonb_set(${json({...completeDraft.content,questions:[]})},'{questions}',(select jsonb_agg(jsonb_build_object('id',artifact_id,'question_type',question_type,'question_text',question_text,'options',options,'correct_option',correct_option,'answer_key',answer_key,'sample_solution',sample_solution,'points',points,'response_max_chars',response_max_chars,'response_monospace',response_monospace) order by position,id) from public.test_questions where test_id=${q(f.tests[11].id)}))`
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
 then raise exception 'Test draft save namespace collision';end if;end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(r => `(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(r => `(${q(r.id)},${q(r.owner)},${q(r.title)},${q(r.code)},'{"classwork":false}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(r => `(${q(r.id)},${q(r.classroom_id)},${q(r.student_id)})`).join(',')};
insert into public.managed_storage_objects(${Object.keys(f.managedObjects[0]).join(',')}) values ${f.managedObjects.map(r=>`(${Object.values(r).map(literal).join(',')})`).join(',')};
insert into public.tests(${fields.join(',')}) values ${f.tests.map(r => `(${fields.map(field => literal(field === 'questions_locked_at' ? null : r[field as keyof typeof r])).join(',')})`).join(',')};
insert into public.test_questions(${Object.keys(f.questions[0]).join(',')}) values ${f.questions.map(r => `(${Object.values(r).map(literal).join(',')})`).join(',')};
insert into public.assessment_drafts(${Object.keys(f.drafts[0]).join(',')}) values ${f.drafts.map(r => `(${Object.entries(r).map(([key,value])=>r===completeDraft&&key==='content'?completeContent:literal(value)).join(',')})`).join(',')};
do $lock$ declare affected integer;begin
 update public.tests set questions_locked_at=${q(f.now)} where id=${q(f.tests[4].id)} and classroom_id=${q(f.classes[0].id)} and status='active' and questions_locked_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test draft save question lock differs';end if;end;$lock$;
do $archive$ declare affected integer;begin
 update public.classrooms set archived_at=${q(f.now)} where id=${q(f.classes[1].id)} and teacher_id=${q(f.classes[1].owner)} and archived_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test draft save archive differs';end if;end;$archive$;
do $effects$ begin
 if (select count(*) from public.classroom_archive_revisions where classroom_id in (${f.classes.map(c => q(c.id)).join(',')}))<>3
 or exists(select 1 from (values ${f.sideEffects.map(e => `(${q(e.classroomId)}::uuid,${e.archiveRevision},${e.blueprintSourceRevision})`).join(',')}) expected(classroom_id,archive_revision,blueprint_revision)
 left join public.classroom_archive_revisions a using(classroom_id) left join public.classrooms c on c.id=expected.classroom_id
 where a.revision is distinct from expected.archive_revision or c.blueprint_source_revision is distinct from expected.blueprint_revision)
 then raise exception 'Test draft save natural revision effects differ';end if;end;$effects$;commit;`)
}
export function testOwnerDraftSaveSnapshotSql(f: TestOwnerDraftSaveFixture) {
  const actors = f.actors.map(r => q(r.id)).join(','); const classes = f.classes.map(r => q(r.id)).join(','); const tests = f.tests.map(r => q(r.id)).join(',')
  const scopes = [['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`], ['public.tests', `id in (${tests})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.test_questions', `test_id in (${tests})`], ['public.assessment_drafts', `classroom_id in (${classes}) or assessment_id in (${tests})`],
    ...['test_attempts', 'test_responses', 'test_student_availability'].map(t => [`public.${t}`, `test_id in (${tests})`]),
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_roster', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${tests})`], ['public.managed_storage_json_references', `test_id in (${tests})`],
    ['public.test_document_snapshot_storage_cleanup',`storage_path=${q(f.managedObjects[0].storage_path)}`],
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
      when n.nspname='public' and c.relname='tests' then ${q(`where r.id not in (${tests})`)}
      when n.nspname='public' and c.relname in ('test_questions','managed_storage_json_references') then ${q(`where r.test_id not in (${tests}) or r.test_id is null`)}
      when n.nspname='public' and c.relname='test_document_snapshot_storage_cleanup' then ${q(`where r.storage_path<>${q(f.managedObjects[0].storage_path)}`)}
      when n.nspname='public' and c.relname='managed_storage_objects' then ${q(`where not (coalesce(r.classroom_id in (${classes}),false) or coalesce(r.resource_id in (${tests}),false))`)}
      else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  return bounded(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';select jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')},'__nontarget_fingerprints',${nonTarget});rollback;`)
}
