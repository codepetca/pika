/** Import-safe fixture and interface for the owner-approved Playwright rehearsal.
 * Adapted from preserved historical fixture source; not an old executable binding.
 * No environment, credentials, process, network or database access at collection.
 */
import assert from 'node:assert/strict'
import type { Page, Response } from '@playwright/test'
import { contextualTestFontOverlaySha256 } from './contextual-test-font-overlay'
import type { createContextualTestAuthoringProgress } from './contextual-test-authoring-progress'

const uuid = (suffix: string) => `50000000-0000-4000-8000-0000000000${suffix}`
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

export const contextualTestNarrowScopes = Object.freeze(['vertical-v1', 'vertical-grade-return-v1', 'lifecycle-permissions-v1', 'survey-workflow-v1'] as const)
export type ContextualTestProofScope = typeof contextualTestNarrowScopes[number]
export function isContextualTestNarrowScope(value: unknown): value is ContextualTestProofScope {
  return typeof value === 'string' && (contextualTestNarrowScopes as readonly string[]).includes(value)
}
export function createContextualTestPlan(projectId: string, proofScope?: ContextualTestProofScope) {
  assert.match(projectId, /^pika_assignment_list_[a-f0-9]{12}$/)
  assert(proofScope === undefined || isContextualTestNarrowScope(proofScope))
  const successor = proofScope === 'vertical-grade-return-v1'
  const lifecycle = proofScope === 'lifecycle-permissions-v1'
  const survey = proofScope === 'survey-workflow-v1'
  const sourceBinding = Object.freeze({ projectId,
    sourceSha: survey ? 'db1fb5f12d2b45fda345735e30d9e4fdb18215cd' : lifecycle ? '4e9c809d1c905a0482fb67880e056e5b8bc5f786' : successor ? 'eb4fa32b237d45f500ea4a67ade9a9e5290ea1c0' : '050699bb0f889a533a349b6af415b821ac56d0e3',
    sourceTree: survey ? 'aac63aefbe7d5adbf01819087ef2fdb857e74ab3' : lifecycle ? '4d225a92b8d9dcfb8cc7118e989c63a46a3c5fbb' : successor ? 'ffec2cc82fd88e9819c147b2ab6246f95c28798e' : 'f44d726966f322e4e3eb0ef637c6f2c711544d77',
    appOverlaySha256: contextualTestFontOverlaySha256,
    migrationChainSha256: survey ? '8f04596017722989202df72acd5cc38f9b705b09b941da4c32d3315070808baf' : lifecycle ? '16dfffc916b245a55e7f6750ff26ae274b5f76b696404c6c9995401b38a1c2e0' : successor ? '9f08b2db28b413c6f00b3021597d5cd0271600b0d8039abf46f84b50c318b4bd' : 'ecd31cace5f9dbc892570ebcdb79617b5b7a5bf8a02b98e7283d769a9da840ac',
    appOrigin: 'http://localhost:3117' as const, apiOrigin: 'http://127.0.0.1:54331' as const,
  })
  const actors = Object.freeze({
    ownerTeacher: { id: uuid('11'), role: 'teacher', email: 'rehearsal-owner-teacher@example.test' },
    ownerStudent: { id: uuid('12'), role: 'student', email: 'rehearsal-owner-student@example.test' },
    memberTeacher: { id: uuid('13'), role: 'teacher', email: 'rehearsal-member-teacher@example.test' },
    memberStudent: { id: uuid('14'), role: 'student', email: 'rehearsal-member-student@example.test' },
    nonmember: { id: uuid('15'), role: 'student', email: 'rehearsal-nonmember@example.test' },
  })
  const classrooms = Object.freeze({
    classA: { id: uuid('21'), owner: 'ownerTeacher', title: 'Private Tests rehearsal A', classCode: `R${projectId.slice(-12, -6).toUpperCase()}A` },
    classB: { id: uuid('22'), owner: 'ownerStudent', title: 'Private Tests rehearsal B', classCode: `R${projectId.slice(-12, -6).toUpperCase()}B` },
  })
  const limits = Object.freeze({ tests: 8, questionsPerTest: 2, uploadObjects: 2,
    uploadBytes: 32768, appRequests: 1000, storageRequests: 40, responseBytes: 1048576,
    operationMs: 30000, totalMs: 2700000, launches: 1, automaticRetries: 0 })

  function setupFixturePlan() {
    // Every planned identity/class pair is explicit: owners cross-enrolled,
    // self-enrollment rows retained, two nonowner members in each class; nonmember absent.
    const pairs = Object.values(actors).flatMap(actor => Object.values(classrooms).map(c => ({ userId: actor.id, classroomId: c.id })))
    return { ...sourceBinding, actors, classrooms, limits, retiredTestIds: [uuid('31'), uuid('32')],
      ...(survey ? { proofScope: 'survey-workflow-v1' as const,
        surveyLimits: Object.freeze({ surveys: 4, questionsPerSurvey: 2, uploads: 0, screenshots: 16 }),
        lifecycleRoster: { id: uuid('41'), classroomId: classrooms.classA.id, studentId: actors.memberStudent.id } } : {}),
      ...(lifecycle ? { proofScope: 'lifecycle-permissions-v1' as const,
        lifecycleRoster: { id: uuid('41'), classroomId: classrooms.classA.id, studentId: actors.memberStudent.id } } : {}),
      admission: { version: 1, admittedUserIds: Object.values(actors).map(actor => actor.id) },
      pageAccessPairs: pairs,
      mutations: {
        revokeMemberTeacherA: `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
  DELETE FROM public.classroom_enrollments WHERE classroom_id='${classrooms.classA.id}' AND student_id='${actors.memberTeacher.id}'; COMMIT;`,
        restoreMemberTeacherA: `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
  DO $fixture$ BEGIN
  IF EXISTS (SELECT 1 FROM public.classroom_enrollments WHERE classroom_id='${classrooms.classA.id}' AND student_id='${actors.memberTeacher.id}') THEN RAISE EXCEPTION 'fixture_membership_restore_collision'; END IF;
  END $fixture$;
  INSERT INTO public.classroom_enrollments(classroom_id,student_id) VALUES('${classrooms.classA.id}','${actors.memberTeacher.id}'); COMMIT;`,
        archiveA: `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; UPDATE public.classrooms SET archived_at=now() WHERE id='${classrooms.classA.id}' AND teacher_id='${actors.ownerTeacher.id}' AND archived_at IS NULL; COMMIT;`,
        restoreArchiveA: `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; UPDATE public.classrooms SET archived_at=NULL WHERE id='${classrooms.classA.id}' AND teacher_id='${actors.ownerTeacher.id}' AND archived_at IS NOT NULL; COMMIT;`,
      },
      restoration: { membership: 'fresh default UUID; old generation retained as removed; new generation active',
        classroom: 'archived_at restored null; updated_at and revision triggers may advance',
        forbiddenWork: 'compare work_graph_sha256 immediately around each denial block, excluding auth/telemetry' },
    }
  }

  return setupFixturePlan()
}

export type RehearsalPlan = ReturnType<typeof createContextualTestPlan>
export type ActorLabel = keyof RehearsalPlan['actors']
export type ContextualTestActor = ActorLabel | 'ownerTeacherPeer' | 'ownerStudentPeer'
function sqlBindings(plan: RehearsalPlan) {
  return { classIdsSql: Object.values(plan.classrooms).map(c => quote(c.id)).join(','),
    actorIdsSql: Object.values(plan.actors).map(a => quote(a.id)).join(','),
    retiredIdsSql: plan.retiredTestIds.map(quote).join(',') }
}

export function bootstrapContextualTestFixtureSql(plan: RehearsalPlan, passwordHash: string): string {
  const { actors, classrooms } = plan
  const { classIdsSql, actorIdsSql, retiredIdsSql } = sqlBindings(plan)
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw new Error('Expected private bcrypt hash')
  const userValues = Object.values(actors).map(actor => `('${actor.id}',${quote(actor.email)},'${actor.role}',${quote(passwordHash)})`).join(',\n')
  const classValues = Object.values(classrooms).map(c => `('${c.id}','${actors[c.owner as keyof typeof actors].id}',${quote(c.title)},'${c.classCode}','{"attendance":false,"classwork":${plan.proofScope === 'survey-workflow-v1'},"tests":true,"gradebook":false,"student_grades":false,"calendar":false,"syllabus":false,"announcements":false,"achievements":false}'::jsonb)`).join(',\n')
  const enrollmentValues = Object.values(classrooms).flatMap(c => ['ownerTeacher','ownerStudent','memberTeacher','memberStudent'].map(label => `('${c.id}','${actors[label as keyof typeof actors].id}')`)).join(',\n')
  return `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $fixture$ BEGIN
IF EXISTS (SELECT 1 FROM public.users WHERE id IN (${actorIdsSql}) OR email IN (${Object.values(actors).map(a => quote(a.email)).join(',')}))
 OR EXISTS (SELECT 1 FROM public.classrooms WHERE id IN (${classIdsSql}) OR class_code IN (${quote(classrooms.classA.classCode)},${quote(classrooms.classB.classCode)}))
 OR EXISTS (SELECT 1 FROM public.tests WHERE id IN (${retiredIdsSql})) THEN RAISE EXCEPTION 'fixture_identity_collision'; END IF;
IF COALESCE((SELECT enabled FROM private.pal_membership_settings WHERE singleton),true) THEN RAISE EXCEPTION 'fixture_pal_enabled'; END IF;
END $fixture$;
INSERT INTO public.users(id,email,role,password_hash) VALUES ${userValues};
INSERT INTO public.classrooms(id,teacher_id,title,class_code,feature_visibility) VALUES ${classValues};
-- Defaults and migration168 triggers generate real enrollment IDs/immutable ledger evidence.
INSERT INTO public.classroom_enrollments(classroom_id,student_id) VALUES ${enrollmentValues};
-- Two retired rows make complete-list reorder include nonvisible records.
INSERT INTO public.tests(id,classroom_id,created_by,title,status,blueprint_archived_at) VALUES
('${uuid('31')}','${classrooms.classA.id}','${actors.ownerTeacher.id}','Retired fixture A','draft',now()),
('${uuid('32')}','${classrooms.classB.id}','${actors.ownerStudent.id}','Retired fixture B','draft',now());
${(plan.proofScope === 'lifecycle-permissions-v1' || plan.proofScope === 'survey-workflow-v1') && plan.lifecycleRoster ? `INSERT INTO public.classroom_roster(id,classroom_id,email,first_name,last_name) VALUES ('${uuid('41')}','${classrooms.classA.id}',${quote(actors.memberStudent.email)},'Synthetic','Learner');
-- The real AFTER INSERT roster trigger creates stable identity; never duplicate it.
DO $fixture$ BEGIN
IF NOT EXISTS (SELECT 1 FROM public.classroom_roster_student_bindings WHERE roster_id='${uuid('41')}' AND classroom_id='${classrooms.classA.id}' AND student_id='${actors.memberStudent.id}') THEN RAISE EXCEPTION 'fixture_roster_binding_missing'; END IF;
END $fixture$;` : ''}
COMMIT;`
}

// Read-only, transaction-consistent actual-record witness; credentials never projected.
export function contextualTestWitnessSql(plan: RehearsalPlan): string {
  const { classIdsSql, actorIdsSql } = sqlBindings(plan)
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
WITH t AS (SELECT * FROM public.tests WHERE classroom_id IN (${classIdsSql})),
a AS (SELECT * FROM public.test_attempts WHERE test_id IN (SELECT id FROM t)),
graph AS (SELECT jsonb_build_object(
'tests',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM t),'[]'::jsonb),
'questions',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.test_questions q WHERE q.test_id IN (SELECT id FROM t)),'[]'::jsonb),
'drafts',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.assessment_drafts d WHERE d.assessment_type='test' AND d.assessment_id IN (SELECT id FROM t)),'[]'::jsonb),
'attempts',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM a),'[]'::jsonb),
'responses',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.test_responses r WHERE r.test_id IN (SELECT id FROM t)),'[]'::jsonb),
'history',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.test_attempt_history h WHERE h.test_attempt_id IN (SELECT id FROM a)),'[]'::jsonb),
'focus_events',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.test_focus_events f WHERE f.test_id IN (SELECT id FROM t)),'[]'::jsonb),
'availability',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.test_id,v.student_id) FROM public.test_student_availability v WHERE v.test_id IN (SELECT id FROM t)),'[]'::jsonb),
'objects',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.managed_storage_objects m WHERE m.classroom_id IN (${classIdsSql})),'[]'::jsonb)
) AS value)
SELECT jsonb_build_object('version',1,'work_graph_sha256',encode(extensions.digest((SELECT value::text FROM graph),'sha256'),'hex'),
'tests',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'classroom_id',classroom_id,'status',status,'position',position,'retired',blueprint_archived_at IS NOT NULL) ORDER BY classroom_id,position,id) FROM t),'[]'::jsonb),
'attempts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'test_id',test_id,'student_id',student_id,'draft_revision',draft_revision,'is_submitted',is_submitted,'returned_at',returned_at) ORDER BY test_id,student_id) FROM a),'[]'::jsonb),
'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('classroom_id',e.classroom_id,'student_id',e.student_id,'generation_id',e.id,'ledger_state',g.state) ORDER BY e.classroom_id,e.student_id) FROM public.classroom_enrollments e JOIN private.pal_membership_generations g ON g.generation_id=e.id WHERE e.classroom_id IN (${classIdsSql})),'[]'::jsonb),
'generations',COALESCE((SELECT jsonb_agg(jsonb_build_object('generation_id',g.generation_id,'state',g.state) ORDER BY g.generation_id) FROM private.pal_membership_generations g WHERE g.scope_digest IN (SELECT private.pal_membership_scope(c.id,u.id) FROM public.classrooms c CROSS JOIN public.users u WHERE c.id IN (${classIdsSql}) AND u.id IN (${actorIdsSql}))),'[]'::jsonb),
'question_counts',COALESCE((SELECT jsonb_agg(jsonb_build_object('test_id',test_id,'count',n) ORDER BY test_id) FROM (SELECT test_id,count(*) AS n FROM public.test_questions WHERE test_id IN (SELECT id FROM t) GROUP BY test_id) counts),'[]'::jsonb),
'classes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'archived_at',archived_at,'updated_at',updated_at) ORDER BY id) FROM public.classrooms WHERE id IN (${classIdsSql})),'[]'::jsonb),
'response_count',(SELECT count(*) FROM public.test_responses WHERE test_id IN (SELECT id FROM t)),
'history_count',(SELECT count(*) FROM public.test_attempt_history WHERE test_attempt_id IN (SELECT id FROM a)),
'objects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'resource_id',resource_id,'purpose',purpose,'status',status,'byte_size',byte_size,'content_sha256',content_sha256) ORDER BY id) FROM public.managed_storage_objects WHERE classroom_id IN (${classIdsSql})),'[]'::jsonb)) AS witness;
COMMIT;`

}

export type RehearsalWitness = {
  version: 1; work_graph_sha256: string
  tests: Array<{ id: string; classroom_id: string; status: string; position: number; retired: boolean }>
  attempts: Array<{ id: string; test_id: string; student_id: string; draft_revision: number; is_submitted: boolean; returned_at: string | null }>
  memberships: Array<{ classroom_id: string; student_id: string; generation_id: string; ledger_state: string }>
  generations: Array<{ generation_id: string; state: string }>
  question_counts: Array<{ test_id: string; count: number }>
  classes: Array<{ id: string; archived_at: string | null; updated_at: string }>
  response_count: number; history_count: number
  objects: Array<{ id: string; resource_id: string; purpose: string; status: string; byte_size: number; content_sha256: string | null }>
}
export type ContextualTestRuntime = {
  plan: RehearsalPlan; password: string; deadline: number; check(): void
  authoring: ReturnType<typeof createContextualTestAuthoringProgress>
  withActor(label: ContextualTestActor, callback: (page: Page) => Promise<void>): Promise<void>
  api<T>(page: Page, method: string, path: string, body?: unknown, expectedStatus?: number): Promise<T>
  response<T>(page: Page, response: Response): Promise<T>
  settle(page: Page): Promise<void>
  navigate(page: Page, url: string, waitUntil?: 'load' | 'domcontentloaded'): Promise<void>
  reload(page: Page): Promise<void>
  witness(label: string): Promise<RehearsalWitness>
  mutate(cell: keyof RehearsalPlan['mutations']): Promise<void>
  snapshot(label: string, page: Page): Promise<void>
  capture(label: string, page: Page): Promise<void>
  captureFont(label: string, page: Page): Promise<void>
}
