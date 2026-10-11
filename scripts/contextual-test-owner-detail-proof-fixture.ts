/** Pure finite extension. Importing or generating its SQL performs no operations.
 * Root must accept the reviewed generator and request manifest before execution. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { INTEGRATED_PNG, integratedGuardSql } from './contextual-assignment-learner-integrated-proof-fixture'

export const TEST_OWNER_PROOF_CAPS = Object.freeze({ actors: 4, classes: 2, tests: 4, questions: 4, drafts: 2, objects: 2,
  sqlBytes: 64 * 1024, networkRequests: 256, storageRequests: 16, requestMs: 15000, responseBytes: 8 * 1024 * 1024 })
export const testOwnerDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
export function newTestOwnerDetailFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `testownerdetail_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const hex = testOwnerDigest(`${tag}:${label}`); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'student', 'teacher'] as const).map((role, index) => ({ id: id(`actor${index}`), role, email: `${tag}_${index}@example.invalid` }))
  const classes = [0, 1].map(index => ({ id: id(`class${index}`), owner: actors[index].id, title: `${tag} class ${index}`, code: `${tag}_${index}` }))
  const tests = ['student-empty', 'teacher-empty', 'draft-overlay', 'closed-canonical'].map((label, index) => ({ id: id(`test${index}`),
    classroomId: classes[index === 1 ? 1 : 0].id, owner: actors[index === 1 ? 1 : 0].id, label,
    title: `${tag} ${label}`, status: index === 3 ? 'closed' : 'draft' }))
  const enrollments = [[0, 0], [1, 1], [0, 2], [0, 3]].map(([c, a], index) => ({ id: id(`enrollment${index}`), classroomId: classes[c].id, actorId: actors[a].id }))
  const questions = [2, 3].flatMap(index => [0, 1].map(position => ({ id: id(`question${index}:${position}`), artifactId: id(`portable${index}:${position}`),
    testId: tests[index].id, position, text: `Canonical synthetic question ${index}:${position}` })))
  const drafts = [2, 3].map(index => ({ id: id(`draft${index}`), testId: tests[index].id, classroomId: tests[index].classroomId, owner: tests[index].owner, version: 7,
    content: { question_identity_version: 1, title: `${tag} overlay ${index}`, show_results: true,
      questions: questions.filter(row => row.testId === tests[index].id).map(row => ({ id: row.artifactId, question_type: 'open_response',
        question_text: `Overlay synthetic question ${index}:${row.position}`, options: [], correct_option: null, answer_key: 'Synthetic overlay answer', sample_solution: null,
        points: 1, response_max_chars: 5000, response_monospace: false })) } }))
  const objects = [0, 1].map(index => ({ id: id(`object${index}`), documentId: id(`document${index}`), testId: tests[2].id,
    classroomId: tests[2].classroomId, owner: tests[2].owner, contentType: index === 0 ? 'image/png' : null }))
  const cases = [
    { label: 'owner-student-empty', testId: tests[0].id, actorId: actors[0].id, status: 200 },
    { label: 'owner-teacher-empty', testId: tests[1].id, actorId: actors[1].id, status: 200 },
    { label: 'owner-draft-overlay', testId: tests[2].id, actorId: actors[0].id, status: 200 },
    { label: 'owner-closed-canonical', testId: tests[3].id, actorId: actors[0].id, status: 200 },
    { label: 'member-student-denied', testId: tests[2].id, actorId: actors[2].id, status: 403 },
    { label: 'member-teacher-denied', testId: tests[2].id, actorId: actors[3].id, status: 403 },
    { label: 'other-owner-teacher-denied', testId: tests[0].id, actorId: actors[1].id, status: 403 },
    { label: 'other-owner-student-denied', testId: tests[1].id, actorId: actors[0].id, status: 403 },
  ]
  const allocatedIds = [...actors.map(row => row.id), ...classes.map(row => row.id), ...tests.map(row => row.id), ...enrollments.map(row => row.id),
    ...questions.flatMap(row => [row.id, row.artifactId]), ...drafts.map(row => row.id), ...objects.flatMap(row => [row.id, row.documentId])]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length); assert(allocatedIds.every(value => !new Set<string>(original.allocatedIds).has(value)))
  assert(INTEGRATED_PNG.length === 68)
  return freeze({ version: 1 as const, tag, now: original.manifest.now, actors, classes, tests, enrollments, questions, drafts, objects, cases, allocatedIds })
}
export type TestOwnerDetailFixture = ReturnType<typeof newTestOwnerDetailFixture>
type ObjectPlan = TestOwnerDetailFixture['objects'][number]
export function testOwnerObjectPath(f: TestOwnerDetailFixture, object: ObjectPlan) {
  assert(f.objects.includes(object))
  return `classrooms/${object.classroomId}/tests/${object.testId}/documents/${object.documentId}/images/${object.id}.png`
}
export function testOwnerReservationArgs(f: TestOwnerDetailFixture, object: ObjectPlan) {
  return { p_object_id: object.id, p_storage_bucket: 'test-documents', p_storage_path: testOwnerObjectPath(f, object), p_classroom_id: object.classroomId,
    p_course_blueprint_id: null, p_provisional_owner_id: null, p_purpose: 'teacher_test_material', p_created_by_user_id: object.owner,
    p_data_subject_user_id: null, p_resource_type: 'test', p_resource_id: object.testId, p_content_type: object.contentType, p_byte_size: INTEGRATED_PNG.length }
}
const receiptSchema = z.object({ id: z.string().uuid(), storage_bucket: z.string(), storage_path: z.string(), classroom_id: z.string().uuid(),
  course_blueprint_id: z.null(), provisional_owner_id: z.null(), purpose: z.string(), created_by_user_id: z.string().uuid(), data_subject_user_id: z.null(),
  resource_type: z.string(), resource_id: z.string().uuid(), content_type: z.string().nullable(), byte_size: z.number().int(),
  status: z.enum(['reserved', 'verified']), verified_at: z.string().datetime({ offset: true }).nullable(), ready_at: z.null(), content_sha256: z.string().nullable() }).passthrough()
export function validateTestOwnerObjectReceipt(f: TestOwnerDetailFixture, object: ObjectPlan, value: unknown, status: 'reserved' | 'verified') {
  const row = receiptSchema.parse(value); const args = testOwnerReservationArgs(f, object)
  assert.deepEqual({ id: row.id, storage_bucket: row.storage_bucket, storage_path: row.storage_path, classroom_id: row.classroom_id,
    purpose: row.purpose, created_by_user_id: row.created_by_user_id, resource_type: row.resource_type, resource_id: row.resource_id,
    content_type: row.content_type, byte_size: row.byte_size, status: row.status },
  { id: object.id, storage_bucket: args.p_storage_bucket, storage_path: args.p_storage_path, classroom_id: args.p_classroom_id,
    purpose: args.p_purpose, created_by_user_id: args.p_created_by_user_id, resource_type: args.p_resource_type, resource_id: args.p_resource_id,
    content_type: args.p_content_type, byte_size: args.p_byte_size, status })
  assert(status === 'reserved' ? row.verified_at === null && row.content_sha256 === null : row.verified_at !== null && row.content_sha256 === testOwnerDigest(INTEGRATED_PNG))
  return row
}
export function testOwnerGuardSql(projectId: string) {
  const original = integratedGuardSql(projectId)
  const terminal = "end;$guard$;select 'ok';rollback;"
  assert(original.endsWith(terminal))
  return original.slice(0, -terminal.length) + `if not exists(select 1 from storage.buckets where id='test-documents' and public=false)
 then raise exception 'Test proof bucket differs';end if;\n${terminal}`
}
function boundedSql(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_PROOF_CAPS.sqlBytes); return sql }
export function testOwnerSetupSql(f: TestOwnerDetailFixture, projectId: string) {
  const ids = f.allocatedIds.map(q).join(',')
  return boundedSql(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ begin
 if exists(select 1 from public.users where id in (${ids}) or email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where id in (${ids}) or class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where id in (${ids}) or classroom_id in (${ids}))
 or exists(select 1 from public.test_questions where id in (${ids}) or test_id in (${ids}) or artifact_id in (${ids}))
 or exists(select 1 from public.assessment_drafts where id in (${ids}) or assessment_id in (${ids}))
 or exists(select 1 from public.managed_storage_objects where id in (${ids}) or classroom_id in (${ids}) or resource_id in (${ids}))
 or exists(select 1 from public.classroom_enrollments where id in (${ids}) or classroom_id in (${ids}) or student_id in (${ids}))
 or exists(select 1 from public.managed_storage_json_references where test_id in (${ids}) or managed_object_id in (${ids}))
 or exists(select 1 from storage.objects where bucket_id='test-documents' and name in (${f.objects.map(row => q(testOwnerObjectPath(f, row))).join(',')}))
 then raise exception 'Test proof namespace collision';end if;
end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(row => `(${q(row.id)},${q(row.email)},${q(row.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(row => `(${q(row.id)},${q(row.owner)},${q(row.title)},${q(row.code)},'{"classwork":true}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(row => `(${q(row.id)},${q(row.classroomId)},${q(row.actorId)})`).join(',')};
insert into public.tests(id,classroom_id,created_by,title,status,documents) values ${f.tests.map(row => `(${q(row.id)},${q(row.classroomId)},${q(row.owner)},${q(row.title)},${q(row.status)},'[]'::jsonb)`).join(',')};
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,answer_key,sample_solution,points,response_max_chars,response_monospace,position)
values ${f.questions.map(row => `(${q(row.id)},${q(row.artifactId)},${q(row.testId)},'open_response',${q(row.text)},'[]'::jsonb,null,'Synthetic canonical answer','Synthetic canonical solution',1,5000,false,${row.position})`).join(',')};
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
values ${f.drafts.map(row => `(${q(row.id)},'test',${q(row.testId)},${q(row.classroomId)},${json(row.content)},${row.version},${q(row.owner)},${q(row.owner)})`).join(',')};
commit;`)
}
export function testOwnerBindDocumentsSql(f: TestOwnerDetailFixture, projectId: string) {
  const test = f.tests[2]
  const docs = f.objects.map(object => ({ id: object.documentId, title: 'Synthetic PNG', source: 'upload', storage_bucket: 'test-documents',
    storage_path: testOwnerObjectPath(f, object), managed_object_id: object.id }))
  return boundedSql(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $attach$ declare affected integer; begin
 if (select count(*) from public.managed_storage_objects where id in (${f.objects.map(object => q(object.id)).join(',')}) and status='verified')<>2
 then raise exception 'Test proof objects not verified';end if;
 update public.tests set documents=${json(docs)} where id=${q(test.id)} and classroom_id=${q(test.classroomId)} and status='draft' and documents='[]'::jsonb;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test proof document binding differs';end if;
 if (select count(*) from public.managed_storage_json_references where test_id=${q(test.id)} and reference_role='teacher_document')<>2
 or (select count(*) from public.managed_storage_objects where id in (${f.objects.map(object => q(object.id)).join(',')}) and status='ready')<>2
 then raise exception 'Test proof references not settled';end if;
end;$attach$;commit;`)
}
export function testOwnerSnapshotSql(f: TestOwnerDetailFixture) {
  const actors = f.actors.map(row => q(row.id)).join(','); const classes = f.classes.map(row => q(row.id)).join(',')
  const tests = f.tests.map(row => q(row.id)).join(','); const objects = f.objects.map(row => q(row.id)).join(',')
  const scopes = [['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`], ['public.tests', `id in (${tests})`],
    ['public.test_questions', `test_id in (${tests})`], ['public.assessment_drafts', `assessment_type='test' and assessment_id in (${tests})`],
    ['public.managed_storage_objects', `id in (${objects})`], ['public.managed_storage_json_references', `test_id in (${tests}) or managed_object_id in (${objects})`],
    ['storage.objects', `bucket_id='test-documents' and name in (${f.objects.map(row => q(testOwnerObjectPath(f, row))).join(',')})`],
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(row => q(row.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`]]
  return boundedSql(`begin read only;set local lock_timeout='3s';set local statement_timeout='30s';select jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')});rollback;`)
}
