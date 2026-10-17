/** Separate successor proof. Historical vertical-v1 acceptance is unchanged. */
import { isDeepStrictEqual } from 'node:util'
import { createContextualTestPlan, contextualTestWitnessSql, type RehearsalPlan, type RehearsalWitness } from '../e2e/helpers/contextual-test-rehearsal'
import { gradeReturnActors, gradeReturnLabels, verticalGradeComment, verticalResponseText, type GradeReturnIdentity } from '../e2e/helpers/contextual-test-grade-return-contract'
import { data, denseArray, resultData, type VerticalTestResult } from './contextual-test-vertical-proof'
import type { ContextualTestRunBinding } from './contextual-test-rehearsal-binding'

const scope = 'vertical-grade-return-v1' as const
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hex = /^[a-f0-9]{64}$/
const baseKeys = ['testId','questionIds','ownerId','memberId','classroomId','submitted','ownerSawResponse','denials']
function must(value: unknown): asserts value { if (!value) throw Error('Invalid grade/return proof') }
export type GradeReturnResult = VerticalTestResult & { gradeReturn: GradeReturnIdentity & { initialRevision: number; score: 4; feedback: string;
  returnedAt: string; hiddenBeforeReturn: true; memberSawReturned: true } }
function result(raw: unknown, binding: Pick<ContextualTestRunBinding, 'projectId' | 'startedAt' | 'deadline'>): GradeReturnResult {
  const row = data(raw, [...baseKeys, 'gradeReturn'])
  const base = resultData(Object.fromEntries(baseKeys.map(key => [key, row[key]])))
  const plan = createContextualTestPlan(binding.projectId, scope)
  must(base.ownerId === plan.actors.ownerStudent.id && base.memberId === plan.actors.memberTeacher.id
    && base.classroomId === plan.classrooms.classB.id && !plan.retiredTestIds.includes(base.testId))
  const grade = data(row.gradeReturn, ['testId','ownerId','memberId','questionIds','mcResponseId','mcRevision','responseId','revision',
    'initialRevision','score','feedback','returnedAt','hiddenBeforeReturn','memberSawReturned'])
  for (const key of ['testId','ownerId','memberId'] as const) must(grade[key] === base[key])
  must(isDeepStrictEqual(denseArray(grade.questionIds, 2), [...base.questionIds]))
  for (const key of ['responseId','mcResponseId']) must(typeof grade[key] === 'string' && uuid.test(grade[key]))
  must(grade.responseId !== grade.mcResponseId)
  for (const key of ['revision','initialRevision','mcRevision']) must(Number.isSafeInteger(grade[key]) && Number(grade[key]) > 0)
  must(grade.revision === Number(grade.initialRevision) + 1 && grade.score === 4 && grade.feedback === verticalGradeComment
    && grade.hiddenBeforeReturn === true && grade.memberSawReturned === true && typeof grade.returnedAt === 'string')
  const time = Date.parse(grade.returnedAt as string)
  must(Number.isSafeInteger(binding.startedAt) && Number.isSafeInteger(binding.deadline) && binding.startedAt <= time && time < binding.deadline)
  return Object.freeze({ ...base, gradeReturn: Object.freeze({ ...grade, questionIds: base.questionIds }) as GradeReturnResult['gradeReturn'] })
}
export function validateContextualTestGradeReturnReceipt(raw: unknown, binding: ContextualTestRunBinding) {
  try {
    const bound = data(binding); must(bound.proofScope === scope && !Object.hasOwn(bound, 'sqlControl'))
    const plan = createContextualTestPlan(binding.projectId, scope)
    for (const key of ['sourceSha','sourceTree','migrationChainSha256','appOverlaySha256'] as const) must(binding[key] === plan[key])
    const row = data(raw, ['version','proofScope','projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline','endedAt',
      'outcome','contextsClosed','pageErrors','actors','result','failureStage','artifacts'])
    must(row.version === 1 && row.proofScope === scope && row.outcome === 'passed' && row.contextsClosed === true && row.pageErrors === 0 && row.failureStage === null)
    for (const key of ['projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline'] as const) must(row[key] === binding[key])
    must(typeof binding.nonce === 'string' && /^[a-f0-9]{32}$/.test(binding.nonce) && binding.nonce.endsWith(plan.projectId.slice(-12)))
    must(Number.isSafeInteger(row.endedAt) && binding.startedAt <= Number(row.endedAt) && Number(row.endedAt) < binding.deadline)
    must(isDeepStrictEqual(denseArray(row.actors, gradeReturnActors.length), [...gradeReturnActors]))
    const validatedResult = result(row.result, binding)
    must(Date.parse(validatedResult.gradeReturn.returnedAt) <= Number(row.endedAt))
    const artifacts = denseArray(row.artifacts, gradeReturnLabels.length).map((rawArtifact, index) => {
      const artifact = data(rawArtifact, ['label','kind','bytes','sha256'])
      must(artifact.label === gradeReturnLabels[index] && artifact.kind === 'png' && Number.isSafeInteger(artifact.bytes)
        && Number(artifact.bytes) > 0 && Number(artifact.bytes) <= 4194304 && typeof artifact.sha256 === 'string' && hex.test(artifact.sha256))
      return Object.freeze({ label: gradeReturnLabels[index], kind: 'png' as const, bytes: artifact.bytes as number, sha256: artifact.sha256 as string })
    })
    return Object.freeze({ ...row, result: validatedResult, actors: gradeReturnActors, artifacts: Object.freeze(artifacts) })
  } catch { throw Error('Grade/return Test receipt rejected') }
}

export type GradeReturnWitness = RehearsalWitness & { grade_return: {
  protected_graph_sha256: string
  responses: { id: string; test_id: string; question_id: string; student_id: string; revision: number; score: number | null;
    feedback: string | null; selected_option: number | null; response_text: string | null; graded_at: string | null; graded_by: string | null }[]
  attempt_actors: { id: string; returned_by: string | null }[]
  access: { test_id: string; student_id: string; state: string }[]
} }

/** Minimal additional read projection on the original transaction-consistent
 * witness. No SQL mutation or caller-provided selector is introduced. */
export function contextualTestGradeReturnWitnessSql(plan: RehearsalPlan): string {
  const expected = createContextualTestPlan(plan.projectId, scope)
  must(plan.sourceSha === expected.sourceSha && plan.migrationChainSha256 === expected.migrationChainSha256)
  const retired = plan.retiredTestIds.map(id => { must(uuid.test(id)); return `'${id}'` }).join(',')
  const projection = `'grade_return',jsonb_build_object(
'protected_graph_sha256',encode(extensions.digest(jsonb_build_object(
  'retired_tests',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM t WHERE id IN (${retired})),'[]'::jsonb),
  'retired_questions',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM public.test_questions q WHERE test_id IN (${retired})),'[]'::jsonb),
  'retired_drafts',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.assessment_drafts d WHERE assessment_type='test' AND assessment_id IN (${retired})),'[]'::jsonb)
)::text,'sha256'),'hex'),
'responses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'test_id',r.test_id,'question_id',r.question_id,'student_id',r.student_id,
  'revision',r.revision,'score',r.score,'feedback',r.feedback,'selected_option',r.selected_option,'response_text',r.response_text,
  'graded_at',r.graded_at,'graded_by',r.graded_by) ORDER BY r.id) FROM public.test_responses r WHERE r.test_id IN (SELECT id FROM t)),'[]'::jsonb),
'attempt_actors',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'returned_by',returned_by) ORDER BY id) FROM a),'[]'::jsonb),
'access',COALESCE((SELECT jsonb_agg(jsonb_build_object('test_id',test_id,'student_id',student_id,'state',state) ORDER BY test_id,student_id)
 FROM public.test_student_availability WHERE test_id IN (SELECT id FROM t)),'[]'::jsonb)),`
  const sql = contextualTestWitnessSql(plan), marker = "'version',1,'work_graph_sha256'"
  must(sql.split(marker).length === 2)
  return sql.replace(marker, `'version',1,${projection}'work_graph_sha256'`)
}
export function assertContextualTestGradeReturnDatabase(before: GradeReturnWitness, after: GradeReturnWitness, rawResult: GradeReturnResult,
  binding: Pick<ContextualTestRunBinding, 'projectId' | 'startedAt' | 'deadline' | 'proofScope'>): void {
  try {
    must(binding.proofScope === scope); const r = result(rawResult, binding), g = r.gradeReturn, plan = createContextualTestPlan(binding.projectId, scope)
    must(before.version === 1 && after.version === 1 && before.tests.length === 2 && after.tests.length === 3)
    must(new Set(before.tests.map(t => t.id)).size === 2 && before.tests.every(t => plan.retiredTestIds.includes(t.id) && t.retired && t.status === 'draft'))
    for (const test of before.tests) must(isDeepStrictEqual(after.tests.find(t => t.id === test.id), test))
    const added = after.tests.filter(t => t.id === r.testId); must(added.length === 1 && added[0].classroom_id === r.classroomId
      && added[0].status === 'closed' && !added[0].retired && Number.isSafeInteger(added[0].position) && added[0].position >= 0)
    must(before.attempts.length === 0 && before.question_counts.length === 0 && before.response_count === 0 && before.history_count === 0
      && before.objects.length === 0 && before.grade_return.responses.length === 0 && before.grade_return.access.length === 0 && before.grade_return.attempt_actors.length === 0)
    must(after.attempts.length === 1); const attempt = after.attempts[0]
    must(uuid.test(attempt.id) && attempt.test_id === r.testId && attempt.student_id === r.memberId && attempt.is_submitted
      && Number.isSafeInteger(attempt.draft_revision) && attempt.draft_revision > 0 && attempt.returned_at === g.returnedAt)
    must(isDeepStrictEqual(after.grade_return.attempt_actors, [{ id: attempt.id, returned_by: r.ownerId }]))
    must(isDeepStrictEqual(after.grade_return.access, [{ test_id: r.testId, student_id: r.memberId, state: 'closed' }]))
    must(isDeepStrictEqual(after.question_counts, [{ test_id: r.testId, count: 2 }]) && after.response_count === 2
      && Number.isSafeInteger(after.history_count) && after.history_count > 0 && after.objects.length === 0)
    must(after.grade_return.responses.length === 2)
    for (const [index, responseId, revision, score, feedback] of [[0,g.mcResponseId,g.mcRevision,5,null],[1,g.responseId,g.revision,4,verticalGradeComment]] as const) {
      const rows = after.grade_return.responses.filter(row => row.id === responseId); must(rows.length === 1); const row = rows[0]
      must(row.test_id === r.testId && row.question_id === r.questionIds[index] && row.student_id === r.memberId && row.revision === revision
        && row.score === score && row.feedback === feedback && row.selected_option === (index === 0 ? 1 : null)
        && row.response_text === (index === 0 ? null : verticalResponseText))
      if (index === 1) must(row.graded_by === r.ownerId && typeof row.graded_at === 'string'
        && Date.parse(row.graded_at) >= binding.startedAt && Date.parse(row.graded_at) <= Date.parse(g.returnedAt))
    }
    must(hex.test(before.grade_return.protected_graph_sha256) && before.grade_return.protected_graph_sha256 === after.grade_return.protected_graph_sha256)
    for (const key of ['memberships','generations'] as const) must(isDeepStrictEqual(before[key], after[key]))
    must(before.classes.length === 2 && after.classes.length === 2)
    for (const classroom of Object.values(plan.classrooms)) {
      const old = before.classes.filter(c => c.id === classroom.id), fresh = after.classes.filter(c => c.id === classroom.id)
      must(old.length === 1 && fresh.length === 1 && old[0].archived_at === null && fresh[0].archived_at === null)
      if (classroom.id === plan.classrooms.classA.id) must(isDeepStrictEqual(old[0], fresh[0]))
      else must(Date.parse(fresh[0].updated_at) > Date.parse(old[0].updated_at)
        && Date.parse(fresh[0].updated_at) >= binding.startedAt && Date.parse(fresh[0].updated_at) < binding.deadline)
    }
  } catch { throw Error('Grade/return Test database proof rejected') }
}
