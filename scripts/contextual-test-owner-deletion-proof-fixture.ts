/** Fixed small synthetic work graph. Generation is inert; never execution authority. */
import assert from 'node:assert/strict'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { freezeOwnerGrading as freeze,ownerGradingDigest as hash } from './contextual-test-owner-grading-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'

export const TEST_OWNER_DELETION_PROOF_CAPS=freeze({sqlBytes:524288,responseBytes:8388608,requestMs:12000,closeMs:12000,totalMs:180000,dispatches:40,rows:10000})
export const TEST_OWNER_DELETION_PROOF_CHECKS=freeze(['raw-service-acl','legacy-exact-closure','teacher-owner-closure','student-self-owner-closure',
  'full-source-absence-ack','authority-parent-fences','suppression-reinsertion-rollback','late-fault-full-restoration'] as const)
const q=(s:string)=>`'${s.replaceAll("'","''")}'`
const j=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
const bounded=(sql:string)=>{assert(Buffer.byteLength(sql)<=TEST_OWNER_DELETION_PROOF_CAPS.sqlBytes);return sql}
export function newTestOwnerDeletionFixture(original:AssignmentListProofFixture){
  assert.match(original.manifest.syntheticTag,/^assignmentlist_[a-f0-9]{12}$/)
  const tag=`testownerdeletion_${original.manifest.syntheticTag.slice(-12)}`,now=original.manifest.now
  const id=(s:string)=>{const h=hash(`${tag}:${s}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['teacher','student','student','student','teacher'] as const).map((role,i)=>({id:id(`actor${i}`),role,email:`${tag}_${i}@example.invalid`}))
  const classes=[0,1,4].map((actor,i)=>({id:id(`class${i}`),owner:actors[actor].id,title:`${tag} Class${i}`,code:`${tag}_${i}`,archived:false}))
  const labels=['teacher-work','student-work','active-work','draft-work','material-witness','race-work','boundary-cancellation','unrelated'] as const
  const tests=labels.map((label,i)=>({id:id(`test${i}`),classroom_id:classes[i===1?1:i===7?2:0].id,created_by:actors[4].id,
    title:`${tag} ${label}`,status:i===2?'active' as const:i===3?'draft' as const:'closed' as const,show_results:false,documents:[] as unknown[],
    points_possible:2,position:i,created_at:now,updated_at:now}))
  const enrollments=[0,1,2].map(i=>({id:id(`enrollment${i}`),classroom_id:classes[i].id,student_id:actors[2].id}))
  enrollments.push({id:id('self-enrollment'),classroom_id:classes[1].id,student_id:actors[1].id})
  const questions=tests.flatMap((t,i)=>[0,1].map(n=>({id:id(`question${i}:${n}`),artifact_id:id(`artifact${i}:${n}`),test_id:t.id,
    question_type:n===0?'open_response' as const:'multiple_choice' as const,question_text:`Synthetic question${n}`,options:n===0?[]:['A','B'],
    correct_option:n===0?null:0,answer_key:n===0?'Synthetic answer':null,sample_solution:null,points:1,response_max_chars:5000,response_monospace:false,position:n})))
  const attempts=tests.filter((_,i)=>i!==4).flatMap(t=>[2,3].map(actor=>({id:id(`attempt:${t.id}:${actor}`),test_id:t.id,student_id:actors[actor].id,
    responses:{},is_submitted:true,submitted_at:now,returned_at:actor===3?now:null,created_at:now,updated_at:now})))
  const responses=attempts.map(a=>({id:id(`response:${a.id}`),test_id:a.test_id,student_id:a.student_id,
    question_id:questions.find(x=>x.test_id===a.test_id&&x.position===0)!.id,response_text:'Synthetic saved response',selected_option:null,score:1,
    feedback:'Synthetic grade',graded_at:now,submitted_at:now}))
  const history=attempts.map(a=>({id:id(`history:${a.id}`),test_id:a.test_id,test_attempt_id:a.id,snapshot:{},word_count:0,char_count:0,paste_word_count:0,keystroke_count:0,trigger:'baseline'}))
  const availability=attempts.map(a=>({id:id(`availability:${a.id}`),test_id:a.test_id,student_id:a.student_id,state:'open',updated_by:classes.find(c=>c.id===tests.find(t=>t.id===a.test_id)!.classroom_id)!.owner}))
  const focus=attempts.map(a=>({id:id(`focus:${a.id}`),test_id:a.test_id,student_id:a.student_id,session_id:tag,event_type:'away_start'}))
  const drafts=tests.map(t=>({id:id(`draft:${t.id}`),assessment_type:'test',assessment_id:t.id,classroom_id:t.classroom_id,content:{title:'Retained Draft',show_results:false,question_identity_version:1,questions:[]},version:3,created_by:actors[4].id,updated_by:actors[4].id}))
  const objects=[0,1,2,3].map(n=>({id:id(`object${n}`),storage_bucket:'test-documents',storage_path:n===2?`link-docs/${actors[0].id}/${tests[0].id}/${id('link-document')}/snapshots/${id('object2')}`:
    `classrooms/${classes[0].id}/tests/${tests[n===3?5:0].id}/documents/${id(`document${n}`)}/${id(`object${n}`)}.pdf`,classroom_id:classes[0].id,
    purpose:n===2?'test_execution_snapshot':'teacher_test_material',status:'ready',created_by_user_id:actors[0].id,resource_type:'test',resource_id:tests[n===3?5:0].id,
    content_type:'application/pdf',byte_size:1,content_sha256:'a'.repeat(64),verified_at:now,ready_at:now,created_at:now,updated_at:now}))
  const docs=objects.slice(0,2).map((o,n)=>({id:id(`document${n}`),source:'upload',title:n===0?'Shared material':'Unshared material',storage_bucket:o.storage_bucket,storage_path:o.storage_path,managed_object_id:o.id}))
  tests[0].documents=[...docs,{id:id('link-document'),source:'link',title:'Snapshot',url:'https://example.invalid/source',snapshot_path:objects[2].storage_path,snapshot_managed_object_id:objects[2].id,snapshot_content_type:'application/pdf',synced_at:now}]
  tests[4].documents=[docs[0]]
  tests[5].documents=[{id:id('document3'),source:'upload',title:'Race material',storage_bucket:objects[3].storage_bucket,storage_path:objects[3].storage_path,managed_object_id:objects[3].id}]
  const queues=[{id:id('snapshot-queue'),storage_path:objects[2].storage_path,managed_object_id:objects[2].id,status:'pending',attempt_count:0,next_attempt_at:now,created_at:now,updated_at:now}]
  const overrides=[{id:id('own-override'),classroom_id:classes[0].id,student_id:actors[2].id,assessment_type:'test',assessment_id:tests[0].id,earned:1,created_by:actors[0].id},
    {id:id('foreign-override'),classroom_id:classes[2].id,student_id:actors[2].id,assessment_type:'test',assessment_id:tests[0].id,earned:1,created_by:actors[4].id}]
  const provenance=[{id:id('provenance'),draft_id:drafts[0].id,classroom_id:classes[0].id,test_id:tests[0].id,source_blueprint_version_id:id('version'),source_blueprint_version_number:1,
    source_draft_revision:1,rules_markdown:'Synthetic provenance',seed_sha256:'b'.repeat(64),created_content_sha256:'c'.repeat(64),created_by:actors[0].id}]
  const rollbackIds=Object.fromEntries(Array.from({length:256},(_,i)=>[String(5000+i),id(`rollback${5000+i}`)]))
  const allocatedIds=[...actors,...classes,...tests,...enrollments,...questions,...attempts,...responses,...history,...availability,...focus,...drafts,...objects,...queues,...overrides,...provenance].map(x=>x.id)
  allocatedIds.push(...questions.map(x=>x.artifact_id),...Object.values(rollbackIds),id('version'),id('document0'),id('document1'),id('document3'),id('link-document'))
  assert.equal(new Set(allocatedIds).size,allocatedIds.length);assert(allocatedIds.every(x=>!(original.allocatedIds as readonly string[]).includes(x)))
  return freeze({version:1,tag,now,actors,classes,tests,enrollments,questions,attempts,responses,history,availability,focus,drafts,objects,queues,overrides,provenance,rollbackIds,allocatedIds,
    testId:tests[5].id,classroomId:classes[0].id,boundaryTestId:tests[6].id,wrongClassroomId:classes[2].id,nativeVerified:false as const})
}
export type TestOwnerDeletionFixture=ReturnType<typeof newTestOwnerDeletionFixture>
function insert(table:string,rows:readonly object[]){assert(rows.length>0);const columns=Object.keys(rows[0]);return `insert into public.${table}(${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_recordset(null::public.${table},${j(rows)});`}
export function testOwnerDeletionSetupSql(f:TestOwnerDeletionFixture,projectId:string){
  assert(Object.isFrozen(f));const ids=f.allocatedIds.map(q).join(',')
  const payloads=f.tests.map(t=>({...t,documents:[]}))
  const sql=`${testOwnerGuardSql(projectId)}\nbegin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ begin if exists(select 1 from public.users where id in (${ids}) or email like ${q(f.tag+'%')})
or exists(select 1 from public.classrooms where id in (${ids}) or class_code like ${q(f.tag+'%')})
or exists(select 1 from public.tests where id in (${ids})) or exists(select 1 from public.managed_storage_objects where id in (${ids}) or storage_path in (${f.objects.map(o=>q(o.storage_path)).join(',')}))
then raise exception 'Deletion fixture namespace collision';end if;end;$collision$;
${insert('users',f.actors)}
insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map(c=>`(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)})`).join(',')};
${insert('classroom_enrollments',f.enrollments)}${insert('tests',payloads)}${insert('test_questions',f.questions)}${insert('assessment_drafts',f.drafts)}
${insert('test_student_availability',f.availability)}${insert('test_attempts',f.attempts)}${insert('test_responses',f.responses)}
${insert('test_attempt_history',f.history.map(({test_id:_test,...h})=>h))}${insert('test_focus_events',f.focus)}
${insert('managed_storage_objects',f.objects)}${insert('test_document_snapshot_storage_cleanup',f.queues)}${insert('gradebook_score_overrides',f.overrides)}${insert('classroom_guided_draft_provenance',f.provenance)}
${f.tests.filter(t=>t.documents.length).map(t=>`update public.tests set documents=${j(t.documents)} where id=${q(t.id)};`).join('\n')}commit;`
  assert(Buffer.byteLength(sql)<=256*1024);return bounded(sql)
}
export function testOwnerDeletionGraphSql(f:TestOwnerDeletionFixture){
  const ids=(rows:readonly{id:string}[])=>rows.map(r=>q(r.id)).join(','),tests=ids(f.tests),classes=ids(f.classes)
  const tables=[['public.users',`id in(${ids(f.actors)})`],['public.classrooms',`id in(${classes})`],['public.tests',`id in(${tests})`],
    ...['test_questions','test_attempts','test_responses','test_focus_events','test_student_availability','test_ai_grading_runs','test_ai_grading_run_items'].map(t=>[`public.${t}`,`test_id in(${tests})`]),
    ['public.test_attempt_history',`id in(${ids(f.history)})`],['public.assessment_drafts',`assessment_type='test' and assessment_id in(${tests})`],
    ['public.classroom_enrollments',`classroom_id in(${classes})`],['public.classroom_archive_revisions',`classroom_id in(${classes})`],['public.gradebook_categories',`classroom_id in(${classes})`],
    ['public.gradebook_score_overrides',`assessment_type='test' and assessment_id in(${tests})`],['public.classroom_guided_draft_provenance',`classroom_id in(${classes})`],
    ['public.managed_storage_json_references',`test_id in(${tests})`],['public.managed_storage_objects',`id in(${ids(f.objects)})`],['public.test_document_snapshot_storage_cleanup',`storage_path in(${f.objects.map(o=>q(o.storage_path)).join(',')})`],['public.managed_storage_settings','true']]
  const fingerprints=`(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r',n.nspname,c.relname),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and n.nspname in('public','private','storage'))`
  const exclusions=tables.map(([t,p])=>`when ${q(t)} then ${q(`not (${p})`)}`).join(' ')
  const nontarget=`(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r where %s',n.nspname,c.relname,case n.nspname||'.'||c.relname ${exclusions} else 'true' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and n.nspname in('public','private','storage'))`
  return `jsonb_build_object(${tables.map(([t,p])=>`${q(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${t} r where ${p})`).join(',')},'__whole_catalog',${fingerprints},'__nontarget_catalog',${nontarget})`
}
export function testOwnerDeletionSnapshotSql(f:TestOwnerDeletionFixture){return bounded(`begin read only;set local lock_timeout='3s';set local statement_timeout='12s';select ${testOwnerDeletionGraphSql(f)};rollback;`)}
