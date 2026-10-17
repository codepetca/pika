/** Pure proof checks for the narrow vertical run. No execution or full-scope exit. */
import { isDeepStrictEqual, types } from 'node:util'
import { createContextualTestPlan, type RehearsalWitness } from '../e2e/helpers/contextual-test-rehearsal'
import type { ContextualTestRunBinding } from './contextual-test-rehearsal-binding'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const sha256 = /^[a-f0-9]{64}$/
const actors = ['ownerStudent','memberTeacher','nonmember','ownerStudent'] as const
const labels = ['vertical-owner-author','vertical-member-submitted','vertical-owner-results'] as const
type Label = typeof labels[number]
export type VerticalTestResult = Readonly<{ testId: string; questionIds: readonly [string, string]; ownerId: string; memberId: string;
  classroomId: string; submitted: true; ownerSawResponse: true;
  denials: Readonly<{ ownerLearner: 403; memberTeacher: 403; nonmemberRead: 403 }> }>
export type VerticalTestReceipt = Readonly<{ version: 1; proofScope: 'vertical-v1'; projectId: string; nonce: string; sourceSha: string;
  sourceTree: string; appOverlaySha256: string; deadline: number; endedAt: number; outcome: 'passed'; contextsClosed: true; pageErrors: 0;
  actors: typeof actors; result: VerticalTestResult; failureStage: null;
  artifacts: readonly Readonly<{ label: Label; kind: 'png'; bytes: number; sha256: string }>[] }>

function must(condition: unknown): asserts condition { if (!condition) throw Error('Invalid vertical proof') }
function data(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  must(value && typeof value === 'object' && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype)
  const ownKeys = Reflect.ownKeys(value)
  must(ownKeys.every(key => typeof key === 'string'))
  if (keys) must(isDeepStrictEqual([...ownKeys].sort(), [...keys].sort()))
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null)
  for (const key of ownKeys as string[]) {
    const descriptor = descriptors[key]
    must(descriptor && 'value' in descriptor)
    result[key] = descriptor.value
  }
  return result
}
function denseArray(value: unknown, length: number): unknown[] {
  must(value && typeof value === 'object' && !types.isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype)
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>
  must('value' in descriptors.length && descriptors.length.value === length)
  must(isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...Array.from({ length }, (_, i) => String(i)), 'length'].sort()))
  return Array.from({ length }, (_, i) => {
    const descriptor = descriptors[String(i)]
    must(descriptor && 'value' in descriptor)
    return descriptor.value
  })
}
function resultData(raw: unknown): VerticalTestResult {
  const result = data(raw, ['testId','questionIds','ownerId','memberId','classroomId','submitted','ownerSawResponse','denials'])
  for (const key of ['testId','ownerId','memberId','classroomId']) must(typeof result[key] === 'string' && uuid.test(result[key]))
  const questions = denseArray(result.questionIds, 2)
  must(questions.every(id => typeof id === 'string' && uuid.test(id)) && questions[0] !== questions[1])
  must(result.ownerId !== result.memberId && result.submitted === true && result.ownerSawResponse === true)
  const denials = data(result.denials, ['ownerLearner','memberTeacher','nonmemberRead'])
  must(Object.values(denials).every(status => status === 403))
  return Object.freeze({ testId: result.testId as string, questionIds: Object.freeze(questions) as readonly [string, string],
    ownerId: result.ownerId as string, memberId: result.memberId as string, classroomId: result.classroomId as string,
    submitted: true, ownerSawResponse: true, denials: Object.freeze({ ownerLearner: 403, memberTeacher: 403, nonmemberRead: 403 }) })
}

/** Success only. A failed/partial receipt cannot become acceptance evidence. */
export function validateContextualTestVerticalReceipt(raw: unknown, binding: ContextualTestRunBinding): VerticalTestReceipt {
  try {
    const bound = data(binding)
    must(bound.proofScope === 'vertical-v1' && !Object.hasOwn(bound, 'sqlControl'))
    must(typeof bound.projectId === 'string')
    const plan = createContextualTestPlan(bound.projectId)
    const receipt = data(raw, ['version','proofScope','projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline','endedAt',
      'outcome','contextsClosed','pageErrors','actors','result','failureStage','artifacts'])
    must(receipt.version === 1 && receipt.proofScope === 'vertical-v1' && receipt.outcome === 'passed'
      && receipt.contextsClosed === true && receipt.pageErrors === 0 && receipt.failureStage === null)
    for (const key of ['projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline']) must(receipt[key] === bound[key])
    for (const key of ['sourceSha','sourceTree','appOverlaySha256']) must(bound[key] === plan[key as keyof typeof plan])
    must(typeof bound.nonce === 'string' && /^[a-f0-9]{32}$/.test(bound.nonce) && bound.nonce.endsWith(plan.projectId.slice(-12)))
    must(Number.isSafeInteger(bound.startedAt) && Number.isSafeInteger(bound.deadline) && Number.isSafeInteger(receipt.endedAt)
      && Number(bound.startedAt) <= Number(receipt.endedAt) && Number(receipt.endedAt) < Number(bound.deadline))
    must(isDeepStrictEqual(denseArray(receipt.actors, 4), [...actors]))
    const result = resultData(receipt.result)
    must(result.classroomId === plan.classrooms.classB.id && result.ownerId === plan.actors.ownerStudent.id
      && result.memberId === plan.actors.memberTeacher.id && !plan.retiredTestIds.includes(result.testId))
    const artifacts = denseArray(receipt.artifacts, 3).map((rawArtifact, index) => {
      const artifact = data(rawArtifact, ['label','kind','bytes','sha256'])
      must(artifact.label === labels[index] && artifact.kind === 'png' && Number.isSafeInteger(artifact.bytes)
        && Number(artifact.bytes) > 0 && Number(artifact.bytes) <= 4194304 && typeof artifact.sha256 === 'string' && sha256.test(artifact.sha256))
      return Object.freeze({ label: labels[index], kind: 'png' as const, bytes: artifact.bytes as number, sha256: artifact.sha256 as string })
    })
    return Object.freeze({ version: 1, proofScope: 'vertical-v1', projectId: plan.projectId, nonce: bound.nonce as string,
      sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256,
      deadline: bound.deadline as number, endedAt: receipt.endedAt as number, outcome: 'passed', contextsClosed: true, pageErrors: 0,
      actors: Object.freeze([...actors]) as typeof actors, result, failureStage: null, artifacts: Object.freeze(artifacts) })
  } catch { throw Error('Vertical Test receipt rejected') }
}

/** Fixed read-only witness comparison. This proves only the bounded work graph. */
export function assertContextualTestVerticalDatabase(before: RehearsalWitness, after: RehearsalWitness, rawResult: VerticalTestResult): void {
  try {
    const result = resultData(rawResult)
    must(before.version === 1 && after.version === 1)
    must(before.tests.length === 2 && new Set(before.tests.map(test => test.id)).size === 2
      && before.tests.every(test => uuid.test(test.id) && test.retired === true && test.status === 'draft'))
    must(before.attempts.length === 0 && before.question_counts.length === 0 && before.response_count === 0 && before.history_count === 0 && before.objects.length === 0)
    must(after.tests.length === 3 && new Set(after.tests.map(test => test.id)).size === 3 && !before.tests.some(test => test.id === result.testId))
    for (const test of before.tests) must(isDeepStrictEqual(after.tests.find(row => row.id === test.id), test))
    const added = after.tests.find(test => test.id === result.testId)
    must(added && added.classroom_id === result.classroomId && added.status === 'closed' && added.retired === false
      && Number.isSafeInteger(added.position) && added.position >= 0)
    must(after.attempts.length === 1)
    const attempt = after.attempts[0]
    must(uuid.test(attempt.id) && attempt.test_id === result.testId && attempt.student_id === result.memberId
      && attempt.is_submitted === true && Number.isSafeInteger(attempt.draft_revision) && attempt.draft_revision > 0 && attempt.returned_at === null)
    must(after.question_counts.length === 1 && after.question_counts[0].test_id === result.testId && after.question_counts[0].count === 2)
    must(after.response_count === 2 && Number.isSafeInteger(after.history_count) && after.history_count > 0 && after.objects.length === 0)
    for (const key of ['memberships','generations','classes'] as const) must(isDeepStrictEqual(before[key], after[key]))
  } catch { throw Error('Vertical Test database proof rejected') }
}
