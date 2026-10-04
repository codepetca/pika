// Pure coordinator-reviewed fixture source. Importing/generating SQL executes nothing.
// Committed generations remain in the THROWAWAY project; guard168 stays enabled.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AssignmentListProofManifest } from './check-contextual-assignment-list-reads'

const q = (value: string) => `'${value.replaceAll("'", "''")}'`
export function newAssignmentListProofFixture(now = new Date()) {
  assert(Number.isFinite(now.getTime()))
  const tag = `assignmentlist_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const roles = ['student', 'teacher', 'student', 'teacher', 'teacher'] as const
  const actors = roles.map((role, n) => ({ id: randomUUID(), email: `${tag}_${n}@example.invalid`, role }))
  const fillers = Array.from({ length: 998 }, (_, n) => ({ id: randomUUID(), email: `${tag}_filler_${n}@example.invalid`, role: 'student' as const }))
  const people = [...actors, ...fillers]
  const classes = ['A', 'B', 'archived', 'hidden'].map((label, n) => ({ id: randomUUID(), title: `${tag} ${label}`,
    owner: actors[n === 0 ? 0 : 1].id, code: `${tag}_${label}` }))
  const students = [actors[1], actors[2], actors[3], ...fillers]
  const enrollment = (classroom: string, student: string) => ({ id: randomUUID(), classroom, student })
  const enrollments = [...students.map(s => enrollment(classes[0].id, s.id)), enrollment(classes[0].id, actors[0].id),
    enrollment(classes[1].id, actors[0].id), enrollment(classes[1].id, actors[3].id), enrollment(classes[1].id, actors[1].id),
    enrollment(classes[2].id, actors[3].id), enrollment(classes[3].id, actors[2].id)]
  const replacementEnrollments = Array.from({ length: 3 }, () => enrollment(classes[0].id, actors[2].id))
  const visible = Array.from({ length: 1001 }, (_, n) => ({ id: randomUUID(), classroom: classes[0].id, owner: actors[0].id,
    title: `${tag} Assignment ${n}`, position: n, isDraft: false, releasedAt: null as string | null }))
  const assignments = [...visible,
    { ...visible[0], id: randomUUID(), title: `${tag} Draft`, position: 1001, isDraft: true },
    { ...visible[0], id: randomUUID(), title: `${tag} Scheduled`, position: 1002, releasedAt: new Date(now.getTime() + 86400000).toISOString() },
    { ...visible[0], id: randomUUID(), classroom: classes[1].id, owner: actors[1].id, title: `${tag} B`, position: 0 }]
  const requirements = Array.from({ length: 1001 }, (_, position) => ({ id: randomUUID(), artifactId: randomUUID(), assignment: visible[0].id, position }))
  const docs = [...students.map(s => ({ id: randomUUID(), assignment: visible[0].id, student: s.id, returned: false })),
    { id: randomUUID(), assignment: visible[1].id, student: actors[2].id, returned: true }]
  const ownerIds = assignments.filter(a => a.classroom === classes[0].id).map(a => a.id)
  const memberIds = visible.map(a => a.id).sort()
  const caseFor = (label: AssignmentListProofManifest['cases'][number]['label'], actor: number, classroom: number,
    permission: 'owner' | 'member', status: '200' | '403', assignmentIds: string[]) => ({ label, actorId: actors[actor].id,
      classroomId: classes[classroom].id, permission, expectedStatus: status, assignmentIds })
  const manifest: AssignmentListProofManifest = { version: 1, syntheticTag: tag, now: now.toISOString(), actors,
    classrooms: classes.map(({ id, title }) => ({ id, title })), cases: [
      { ...caseFor('owner_student', 0, 0, 'owner', '200', ownerIds), stats: [{ id: visible[0].id, totalStudents: 1001, submitted: 1001, requirementIds: requirements.map(r => r.id) }] },
      caseFor('owner_teacher', 1, 1, 'owner', '200', [assignments.at(-1)!.id]),
      caseFor('member_student', 2, 0, 'member', '200', memberIds), caseFor('member_teacher', 3, 1, 'member', '200', [assignments.at(-1)!.id]),
      caseFor('outsider', 4, 0, 'member', '403', []), caseFor('self_owner', 0, 0, 'member', '403', []),
      caseFor('archived_member', 3, 2, 'member', '403', []), caseFor('hidden_member', 2, 3, 'member', '403', []),
      caseFor('member_student', 0, 1, 'member', '200', [assignments.at(-1)!.id]),
    ] }
  const allocatedIds = [...people.map(p => p.id), ...classes.map(c => c.id), ...enrollments.map(e => e.id), ...replacementEnrollments.map(e => e.id),
    ...assignments.map(a => a.id), ...requirements.flatMap(r => [r.id, r.artifactId]), ...docs.map(d => d.id)]
  return { manifest, people, students, classes, enrollments, replacementEnrollments, assignments, requirements, docs, allocatedIds }
}
export type AssignmentListProofFixture = ReturnType<typeof newAssignmentListProofFixture>

export function assignmentListFixtureSetupSql(f: AssignmentListProofFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.manifest.syntheticTag.slice(-12)}`)
  const stamp = f.manifest.now
  const due = new Date(Date.parse(stamp) + 10 * 86400000).toISOString()
  const all = f.allocatedIds.map(id => q(id)).join(',')
  return `begin;
set local statement_timeout='45s';set local lock_timeout='4s';
-- The root must separately prove this connection's exact fresh Docker project.
do $target$ begin
  if current_setting('application_name')<>${q(projectId + '_fixture')} then raise exception 'Isolated fixture session rejected';end if;
end;$target$;
select 1 from private.pal_classroom_signal_settings where singleton for share nowait;
select 1 from private.pal_membership_settings where singleton for share nowait;
select 1 from private.student_provider_cleanup_settings where singleton for share nowait;
select 1 from private.classroom_creation_entitlement_settings where singleton for share nowait;
do $guards$ begin
  if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal) is distinct from 'O'
    or coalesce((select enabled from private.pal_classroom_signal_settings where singleton),true)
    or coalesce((select enabled from private.pal_membership_settings where singleton),true)
    or coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),true)
    or coalesce((select strict_enforcement_enabled from private.classroom_creation_entitlement_settings where singleton),true)
    then raise exception 'Isolated fixture gates differ';end if;
  if exists(select 1 from public.users where id in (${all}))
    or exists(select 1 from public.classrooms where id in (${all}))
    or exists(select 1 from private.pal_membership_generations where generation_id in (${all}))
    then raise exception 'Preallocated fixture identity exists';end if;
end;$guards$;
insert into public.users(id,email,role) values ${f.people.map(p => `(${q(p.id)},${q(p.email)},${q(p.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map(c => `(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)})`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e => `(${q(e.id)},${q(e.classroom)},${q(e.student)})`).join(',')};
insert into public.assignments(id,classroom_id,created_by,title,description,instructions_markdown,due_at,position,is_draft,released_at)
values ${f.assignments.map(a => `(${q(a.id)},${q(a.classroom)},${q(a.owner)},${q(a.title)},'',${q('Synthetic read instructions')},${q(due)},${a.position},${a.isDraft},${a.releasedAt ? q(a.releasedAt) : 'null'})`).join(',')};
insert into public.assignment_submission_requirements(id,artifact_id,assignment_id,type,label,instructions,required,position,validation_policy_json)
values ${f.requirements.map(r => `(${q(r.id)},${q(r.artifactId)},${q(r.assignment)},'link','Synthetic evidence','',false,${r.position},'{}'::jsonb)`).join(',')};
insert into public.assignment_docs(id,assignment_id,student_id,content,is_submitted,submitted_at,score_completion,score_thinking,score_workflow,graded_at,graded_by,returned_at,feedback,feedback_returned_at)
values ${f.docs.map(d => `(${q(d.id)},${q(d.assignment)},${q(d.student)},'{"type":"doc","content":[]}'::jsonb,true,${q(stamp)},${d.returned ? '0,0,0' : '8,9,10'},${q(stamp)},${q(f.classes[0].owner)},${d.returned ? q(stamp) : 'null'},'Synthetic feedback',${d.returned ? q(stamp) : 'null'})`).join(',')};
update public.classrooms set archived_at=${q(stamp)} where id=${q(f.classes[2].id)};
update public.classrooms set feature_visibility=jsonb_set(feature_visibility,'{classwork}','false'::jsonb) where id=${q(f.classes[3].id)};
commit;`
}
