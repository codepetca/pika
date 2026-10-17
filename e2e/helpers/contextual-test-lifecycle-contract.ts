/** Distinct remaining-lifecycle scope. No historical acceptance is widened. */
import assert from 'node:assert/strict'
import { isDeepStrictEqual,types } from 'node:util'
export const lifecycleScope = 'lifecycle-permissions-v1' as const
export const lifecycleActors = ['ownerTeacher','memberStudent','memberTeacher','ownerTeacherPeer','nonmember','memberStudent','memberTeacher'] as const
export const lifecycleLabels = ['lifecycle-embedded-preview','lifecycle-standalone-preview','lifecycle-learner-recovery',
  'lifecycle-learner-submitted','lifecycle-learner-returned','lifecycle-learner-retracted','lifecycle-reset','lifecycle-permissions'] as const
export const lifecycleScreens = lifecycleLabels.map((label,index)=>({label,
  actor: index===2||index===3||index===4||index===5 ? 'memberStudent' as const : 'ownerTeacher' as const,
  viewport: [2,4,6,7].includes(index) ? 'mobile' as const : 'desktop' as const,
  theme: [1,4,5,7].includes(index) ? 'dark' as const : 'light' as const }))
export const lifecycleReference = 'Synthetic reference: Beta is the second option.'
export const lifecycleStages = ['admission','owner-create','owner-author','owner-reference','owner-save-readback','owner-publish','previews','reorder','recovery','grade-conflict','return-and-clear','unpublish-refusal','resets','permissions'] as const
export function lifecycleFailureStage(error:unknown):typeof lifecycleStages[number]|null {
  if(!error||typeof error!=='object'||types.isProxy(error))return null
  const message=Object.getOwnPropertyDescriptor(error,'message'),prefix='Contextual Test lifecycle failed: '
  if(!message||!('value'in message)||typeof message.value!=='string'||!message.value.startsWith(prefix))return null
  const suffix=message.value.slice(prefix.length);return lifecycleStages.find(stage=>stage===suffix)??null
}
export const lifecycleText = (actor: string) => `Synthetic lifecycle reasoning: ${actor}.`
export type LifecycleActor = typeof lifecycleActors[number]
export type LifecycleAttempt = { id: string; test_id: string; student_id: string; draft_revision: number; is_submitted: boolean;
  submitted_at: string | null; created_at: string; updated_at: string;
  responses: Record<string, { question_type: string; response_text?: string | null; selected_option?: number | null }> }
export type LifecycleAnswer = { response_id: string; response_revision: number; score: number | null; feedback: string | null;
  response_text: string | null; selected_option: number | null; graded_at: string | null; is_draft?: boolean }
export type LifecycleResults = { test: { id: string }; questions: { id: string; question_type: string }[];
  students: { student_id: string; returned_at: string | null; returned_by: string | null; status: string; answers: Record<string,LifecycleAnswer> }[] }
export type LifecycleExchange = { label: string; actor: LifecycleActor; via: 'screen' | 'conflict-perturbation' | 'permission-fixture' | 'denied-probe';
  method: string; path: string; status: number; request: unknown; response: unknown }
export type LifecycleResult = { classroomId: string; ownerId: string; testIds: [string,string]; questionIds: [string,string];
  recovery: { before: LifecycleAttempt; after: LifecycleAttempt }; retained: { attempts: LifecycleAttempt[]; results: LifecycleResults; history: {attemptId:string;history:Record<string,unknown>[]}[] };
  disclosure: { returned: unknown; retracted: unknown }; archive: { before: LifecycleResults; after: LifecycleResults }; exchanges: LifecycleExchange[] }
export const lifecycleExchangeLabels = ['publish-main','publish-scratch','unpublish-scratch','republish-scratch','reorder','submit-memberStudent','submit-memberTeacher',
  'grade-perturbation','grade-conflict','grade-retry','return','clear-grade','unpublish-refused',
  'scratch-single-submit','unsubmit','reset-one','scratch-submit-memberStudent','scratch-submit-memberTeacher','reset-many','delete-scratch',
  'self-owner','foreign-parent','foreign-reorder','member-owner','nonmember-read','nonmember-start',
  'remove-member','revoked-cached-read','revoked-cached-save','revoked-cached-submit','revoked-fresh-read','revoked-fresh-start','rejoin-refused',
  'archive','archived-cached-read','archived-cached-save','archived-owner-save','archived-fresh-read','archived-fresh-start','unarchive'] as const
export function assertLifecycleAttempt(attempt: LifecycleAttempt, testId: string, studentId: string, questions: readonly [string,string], text: string, submitted: boolean) {
  assert(attempt && /^[a-f0-9-]{36}$/.test(attempt.id) && attempt.test_id === testId && attempt.student_id === studentId
    && attempt.is_submitted === submitted && Number.isSafeInteger(attempt.draft_revision) && attempt.draft_revision > 0)
  assert(Number.isFinite(Date.parse(attempt.created_at)) && Number.isFinite(Date.parse(attempt.updated_at))
    && (submitted ? typeof attempt.submitted_at==='string'&&Number.isFinite(Date.parse(attempt.submitted_at)) : attempt.submitted_at===null))
  assert.deepEqual(Object.keys(attempt.responses).sort(), [...questions].sort())
  assert.deepEqual(attempt.responses[questions[0]], { question_type: 'multiple_choice', selected_option: 1 })
  assert.deepEqual(attempt.responses[questions[1]], { question_type: 'open_response', response_text: text })
}
export function assertLifecycleRecovery(before: LifecycleAttempt, after: LifecycleAttempt) {
  assert(before.id === after.id && before.test_id === after.test_id && before.student_id === after.student_id
    && !before.is_submitted && !after.is_submitted && after.draft_revision >= before.draft_revision
    && isDeepStrictEqual(before.responses, after.responses))
}
/** Preserve complete owner graph across archive and its rejected writes. */
export function assertLifecycleGraphEquality(before: LifecycleResults, after: LifecycleResults) { assert.deepEqual(after, before) }
