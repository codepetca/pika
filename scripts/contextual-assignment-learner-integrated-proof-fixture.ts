/** Pure finite sibling manifest. Importing creates no resources or credentials. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'

export const INTEGRATED_CAPS = Object.freeze({ actors: 4, classes: 3, assignments: 8, images: 8,
  sqlBytes: 256 * 1024, networkRequests: 512, storageRequests: 64, requestMs: 15000, responseBytes: 8 * 1024 * 1024 })
export const INTEGRATED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64')
assert(INTEGRATED_PNG.length <= 1024)
export const integratedDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const receiptSchema = z.object({ id: uuid, actorId: uuid, assignmentId: uuid, classroomId: uuid }).strict()

export function newIntegratedLearnerFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `assignmentintegrated_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => {
    const hex = integratedDigest(`${tag}:${label}`)
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`
  }
  const actors = ['student','student','teacher','teacher'].map((role, index) => ({ id: id(`actor${index}`), role,
    email: `${tag}_${index}@example.invalid` }))
  const classes = ['visible','hidden','archived'].map((label, index) => ({ id: id(`class${index}`), label,
    title: `${tag} ${label}`, code: `${tag}_${index}`, owner: actors[0].id }))
  const assignments = Array.from({ length: 8 }, (_, index) => ({ id: id(`assignment${index}`),
    classroomId: classes[index === 4 || index === 6 ? 1 : index === 5 ? 2 : 0].id,
    actorId: actors[index === 1 ? 2 : 1].id, label: `${tag} assignment ${index}`,
    draft: index === 6, scheduled: index === 7,
    docId: index < 2 ? null : id(`doc${index}`) }))
  const enrollments = classes.flatMap(c => actors.slice(0,3).map(a => ({ id: id(`enrollment:${c.id}:${a.id}`), classroomId:c.id, actorId:a.id })))
  const requirements = [0,1,2,3].map(index => ({ id: id(`requirement${index}`), artifactId: id(`requirementArtifact${index}`),
    assignmentId: assignments[index].id, type: index === 1 || index === 2 ? 'image' : 'link' }))
  const objects = [
    { index: 1, bucket: 'assignment-artifacts', ready: true },
    { index: 2, bucket: 'assignment-artifacts', ready: true },
    ...[1,2,3,4,5,6].map(index => ({ index, bucket: 'submission-images', ready: index > 2 })),
  ].map((row, n) => ({ ...row, id: id(`object${n}`) }))
  const feedback = [1,2,3].map(index => ({ id:id(`feedback${index}`), assignmentId:assignments[index].id, actorId:assignments[index].actorId }))
  const identities = actors.slice(1,3).map((a,index) => ({ id:id(`github${index}`), actorId:a.id, login:`synthetic-learner-${index}` }))
  const history = [2,3].map(index => ({ id:id(`history${index}`), docId:assignments[index].docId! }))
  const allocatedIds = [...actors.map(r=>r.id),...classes.map(r=>r.id),...assignments.map(r=>r.id),...assignments.flatMap(r=>r.docId?[r.docId]:[]),
    ...enrollments.map(r=>r.id),...requirements.flatMap(r=>[r.id,r.artifactId]),...objects.map(r=>r.id),...feedback.map(r=>r.id),...identities.map(r=>r.id),...history.map(r=>r.id)]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  assert(allocatedIds.every(value=>!original.allocatedIds.includes(value)))
  assert(actors.length<=INTEGRATED_CAPS.actors&&classes.length<=INTEGRATED_CAPS.classes&&assignments.length<=INTEGRATED_CAPS.assignments&&objects.length<=INTEGRATED_CAPS.images)
  for(const collection of [actors,classes,assignments,enrollments,requirements,objects,feedback,identities,history]) {
    collection.forEach(row=>Object.freeze(row));Object.freeze(collection)
  }
  Object.freeze(allocatedIds)
  return Object.freeze({ tag, now:original.manifest.now, actors, classes, assignments, enrollments, requirements, objects, feedback, identities, history, allocatedIds,
    originalAllocatedIds:Object.freeze([...original.allocatedIds]) })
}
export type IntegratedLearnerFixture = ReturnType<typeof newIntegratedLearnerFixture>
export type CreatedDocuments = Map<string,string>
export function acceptCreatedDocument(f: IntegratedLearnerFixture, documents: CreatedDocuments, input: unknown) {
  const receipt = receiptSchema.parse(input)
  const assignment = f.assignments.find(a=>a.id===receipt.assignmentId && a.docId===null)
  assert(assignment && assignment.actorId===receipt.actorId && assignment.classroomId===receipt.classroomId)
  assert(!documents.has(assignment.id) && !f.allocatedIds.includes(receipt.id) && !f.originalAllocatedIds.includes(receipt.id) && ![...documents.values()].includes(receipt.id))
  documents.set(assignment.id, receipt.id)
  return receipt.id
}
export function integratedDocId(f:IntegratedLearnerFixture, documents:CreatedDocuments, index:number) {
  const assignment = f.assignments[index]; assert(assignment)
  const value = assignment.docId ?? documents.get(assignment.id); assert(value)
  return value
}
export function integratedObjectPath(f:IntegratedLearnerFixture, documents:CreatedDocuments, object:IntegratedLearnerFixture['objects'][number]) {
  assert(f.objects.includes(object))
  const a = f.assignments[object.index]; const docId=integratedDocId(f,documents,object.index)
  return `classrooms/${a.classroomId}/students/${a.actorId}/assignment-docs/${docId}/${object.bucket==='assignment-artifacts'?'artifacts/':''}${object.id}.png`
}
/** Repeated before every extension SQL/network dispatch; never changes settings. */
export function integratedGuardSql(projectId:string) {
  assert.match(projectId,/^pika_assignment_list_[a-f0-9]{12}$/)
  return `begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if current_setting('application_name')<>${q(projectId+'_fixture')} then raise exception 'Integrated session mismatch';end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and tgenabled='O')
 or not exists(select 1 from pg_trigger where tgrelid='private.pal_classroom_signal_settings'::regclass and tgname='guard_pal_signal_activation' and tgenabled='O')
 or coalesce((select enabled from private.pal_classroom_signal_settings where singleton),true)
 or coalesce((select enabled from private.pal_membership_settings where singleton),true)
 or coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),true)
 or exists(select 1 from storage.buckets where id in ('submission-images','assignment-artifacts') and public)
 or (select count(*) from storage.buckets where id in ('submission-images','assignment-artifacts'))<>2
 then raise exception 'Integrated guards or buckets differ';end if;
end;$guard$;rollback;`
}
export function integratedSetupSql(f:IntegratedLearnerFixture,projectId:string) {
  const ids = f.allocatedIds.map(q).join(','); const stamp=q(f.now); const content=`'{"type":"doc","content":[]}'::jsonb`
  const due=q(new Date(Date.parse(f.now)+10*86400000).toISOString())
  const sql = `${integratedGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ begin
 if exists(select 1 from public.users where id in (${ids}) or email like ${q(f.tag+'%')})
 or exists(select 1 from public.classrooms where id in (${ids}) or class_code like ${q(f.tag+'%')})
 or exists(select 1 from public.assignments where id in (${ids}))
 or exists(select 1 from public.assignment_docs where id in (${ids}) or assignment_id in (${ids}))
 or exists(select 1 from public.managed_storage_objects where id in (${ids}) or classroom_id in (${ids}) or resource_id in (${ids}))
 or exists(select 1 from public.classroom_enrollments where id in (${ids}) or classroom_id in (${ids}) or student_id in (${ids}))
 or exists(select 1 from public.assignment_submission_requirements where id in (${ids}) or assignment_id in (${ids}))
 or exists(select 1 from public.assignment_feedback_entries where id in (${ids}) or assignment_id in (${ids}) or student_id in (${ids}))
 or exists(select 1 from public.user_github_identities where id in (${ids}) or user_id in (${ids}))
 or exists(select 1 from public.assignment_doc_history where id in (${ids}) or assignment_doc_id in (${ids}))
 or exists(select 1 from public.assignment_submission_artifacts where id in (${ids}) or assignment_doc_id in (${ids}) or student_id in (${ids}))
 or exists(select 1 from private.pal_membership_generations where generation_id in (${ids}) or scope_digest in (${f.classes.flatMap(c=>f.actors.map(a=>`private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')}))
 or exists(select 1 from storage.objects where name like ${q('classrooms/'+f.classes[0].id+'/%')} or name like ${q('classrooms/'+f.classes[1].id+'/%')} or name like ${q('classrooms/'+f.classes[2].id+'/%')})
 then raise exception 'Integrated namespace collision';end if;
end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,archived_at,feature_visibility) values ${f.classes.map(c=>`(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},${c.label==='archived'?stamp:'null'},${c.label==='hidden'?`'{"classwork":false}'::jsonb`:`'{"classwork":true}'::jsonb`})`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};
insert into public.assignments(id,classroom_id,created_by,title,description,instructions_markdown,due_at,is_draft,released_at) values ${f.assignments.map(a=>`(${q(a.id)},${q(a.classroomId)},${q(f.actors[0].id)},${q(a.label)},'','Synthetic instructions',${due},${a.draft},${a.scheduled?due:'null'})`).join(',')};
insert into public.assignment_submission_requirements(id,artifact_id,assignment_id,type,label,instructions,required,position,validation_policy_json) values ${f.requirements.map(r=>`(${q(r.id)},${q(r.artifactId)},${q(r.assignmentId)},${q(r.type)},'Synthetic evidence','',false,0,'{}'::jsonb)`).join(',')};
insert into public.assignment_docs(id,assignment_id,student_id,content,is_submitted,submitted_at,returned_at,feedback_returned_at,viewed_at,score_completion,score_thinking,score_workflow,feedback) values ${f.assignments.slice(2).map((a,n)=>`(${q(a.docId!)},${q(a.id)},${q(a.actorId)},${content},false,null,null,null,null,${n===1?'0,1,2':'8,9,10'},'Synthetic released feedback')`).join(',')};
-- Guard099 forbids artifacts after submission; build only this new synthetic draft first.
insert into public.assignment_submission_artifacts(id,assignment_doc_id,requirement_id,student_id,type,url,metadata_json,validation_status,validated_at)
values (${q(f.requirements[3].artifactId)},${q(f.assignments[3].docId!)},${q(f.requirements[3].id)},${q(f.assignments[3].actorId)},'link','https://example.invalid/synthetic','{}'::jsonb,'valid',${stamp});
update public.assignment_docs set is_submitted=true,submitted_at=${stamp},returned_at=${stamp},feedback_returned_at=${stamp}
where id=${q(f.assignments[3].docId!)} and is_submitted=false;
-- Exact179 submit snapshot before deferred099 commit checks; no weakening or history repair.
insert into public.assignment_doc_history(id,assignment_doc_id,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger,created_at) values ${f.history.map((h,n)=>`(${q(h.id)},${q(h.docId)},${content},0,0,0,0,${q(n===1?'submit':'autosave')},${stamp})`).join(',')};
insert into public.assignment_feedback_entries(id,assignment_id,student_id,entry_kind,author_type,body,returned_at,created_by) values ${f.feedback.map(r=>`(${q(r.id)},${q(r.assignmentId)},${q(r.actorId)},'teacher_feedback','teacher','Synthetic returned entry',${stamp},${q(f.actors[0].id)})`).join(',')};
insert into public.user_github_identities(id,user_id,github_login,commit_emails,validation_status,validated_at) values ${f.identities.map(r=>`(${q(r.id)},${q(r.actorId)},${q(r.login)},array[]::text[],'unvalidated',null)`).join(',')};
commit;`
  assert(Buffer.byteLength(sql)<=INTEGRATED_CAPS.sqlBytes)
  return sql
}
