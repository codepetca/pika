/** Successor of the create/submit/inspect carrier. Every write uses real UI. */
import { expect, type Page } from '@playwright/test'
import { isDeepStrictEqual } from 'node:util'
import { runContextualTestVerticalWorkflow, selectVerticalMemberResponse, type VerticalTestRuntime } from './contextual-test-vertical-workflow'
import { gradeReturnStages, verticalGradeComment, verticalResponseText, type GradeReturnIdentity } from './contextual-test-grade-return-contract'
export { gradeReturnActors, gradeReturnLabels, gradeReturnStages, verticalGradeComment, verticalResponseText, type GradeReturnIdentity } from './contextual-test-grade-return-contract'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
function must(value: unknown): asserts value { if (!value) throw Error('Invalid grade/return graph') }
type Answer = { response_id: string; response_revision: number; score: number | null; feedback: string | null;
  selected_option?: number | null; response_text?: string | null; is_draft?: boolean }
type OwnerResults = { test: { id: string }; questions: { id: string }[]; students: { student_id: string; status: string;
  returned_at: string | null; returned_by: string | null; effective_access: string; answers: Record<string, Answer> }[] }
export function assertVerticalGradeSave(raw: unknown, original: Pick<Answer, 'response_id' | 'response_revision' | 'score' | 'feedback'>): void {
  const saved = raw as { saved_count: number; responses: { id: string; revision: number; score: number; feedback: string }[] }
  must(uuid.test(original.response_id) && Number.isSafeInteger(original.response_revision) && original.response_revision > 0
    && original.score === null && original.feedback === null && saved?.saved_count === 1 && saved.responses?.length === 1)
  const row = saved.responses[0]
  must(row.id === original.response_id && row.revision === original.response_revision + 1 && row.score === 4 && row.feedback === verticalGradeComment)
}
export function assertVerticalGradeReadback(raw: unknown, identity: GradeReturnIdentity, returned: boolean): void {
  const g = raw as OwnerResults
  must(g?.test?.id === identity.testId && g.questions?.length === 2 && new Set(g.questions.map(q => q.id)).size === 2
    && identity.questionIds.every(id => g.questions.some(q => q.id === id)))
  const rows = g.students.filter(row => row.student_id === identity.memberId); must(rows.length === 1)
  const row = rows[0], mc = row.answers[identity.questionIds[0]], open = row.answers[identity.questionIds[1]]
  must(row.status === (returned ? 'returned' : 'submitted') && row.effective_access === 'closed'
    && (returned ? typeof row.returned_at === 'string' && Number.isFinite(Date.parse(row.returned_at)) && row.returned_by === identity.ownerId
      : row.returned_at === null && row.returned_by === null))
  must(Object.keys(row.answers).length === 2 && mc && open && mc.response_id === identity.mcResponseId && mc.response_revision === identity.mcRevision
    && mc.score === 5 && mc.feedback === null && mc.selected_option === 1 && mc.response_text === null && mc.is_draft === false
    && open.response_id === identity.responseId && open.response_revision === identity.revision && open.score === 4 && open.feedback === verticalGradeComment
    && open.selected_option === null && open.response_text === verticalResponseText && open.is_draft === false)
  must(g.students.filter(s => s.student_id !== identity.memberId).every(s => s.returned_at === null && Object.keys(s.answers).length === 0))
}
/** Both fresh detail bytes and the rendered learner surface are checked. */
export function assertVerticalLearnerDisclosure(raw: unknown, returned: boolean, testId: string, questions?: readonly [string, string]): void {
  const g = raw as { test: { id: string; returned_at: string | null; effective_access?: string }; question_results?: {
    question_id: string; score: number; feedback: string | null; selected_option: number | null; response_text: string | null; correct_option: number | null }[];
    summary?: { earned_points: number; possible_points: number } }
  must(g?.test?.id === testId)
  if (!returned) {
    must(g.test.returned_at === null)
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        must(!['score','feedback','correct_option','answer_key','sample_solution','question_results','summary'].includes(key) || nested === null)
        walk(nested)
      }
    }
    walk(g); return
  }
  must(typeof g.test.returned_at === 'string' && Number.isFinite(Date.parse(g.test.returned_at)) && g.test.effective_access === 'closed'
    && questions && g.question_results?.length === 2 && new Set(g.question_results.map(q => q.question_id)).size === 2
    && g.summary?.earned_points === 9 && g.summary.possible_points === 10)
  const mc = g.question_results.find(q => q.question_id === questions[0]), open = g.question_results.find(q => q.question_id === questions[1])
  must(mc && open && mc.score === 5 && mc.selected_option === 1 && mc.correct_option === 1 && mc.feedback === null
    && open.score === 4 && open.feedback === verticalGradeComment && open.response_text === verticalResponseText)
}
function waitFor(page: Page, method: string, path: string) {
  const pending = page.waitForResponse(res => new URL(res.url()).pathname === path && res.request().method() === method)
  void pending.catch(() => {}); return pending
}
export async function runContextualTestGradeReturnWorkflow(r: VerticalTestRuntime) {
  const base = await runContextualTestVerticalWorkflow(r)
  let stage: typeof gradeReturnStages[number] = 'owner-grade'
  let identity: GradeReturnIdentity | undefined, returnedAt = ''
  const classUrl = `${r.plan.appOrigin}/classrooms/${base.classroomId}?tab=tests`
  const openOwner = async (page: Page) => {
    r.check(); await r.navigate(page, classUrl)
    await page.getByRole('button', { name: 'Contextual vertical Test', exact: true }).click()
    const member = page.getByTestId(`test-grading-student-row-${base.memberId}`)
    await selectVerticalMemberResponse(member); await expect(member).toHaveAttribute('aria-selected', 'true')
    return member
  }
  try {
    await r.withActor('ownerStudent', async page => {
      const original = await r.api<OwnerResults>(page, 'GET', `/api/teacher/tests/${base.testId}/results`)
      must(original.test.id === base.testId)
      const members = original.students.filter(s => s.student_id === base.memberId); must(members.length === 1)
      const mc = members[0].answers[base.questionIds[0]], open = members[0].answers[base.questionIds[1]]
      must(mc && open && uuid.test(mc.response_id) && uuid.test(open.response_id) && mc.response_id !== open.response_id)
      identity = { testId: base.testId, ownerId: base.ownerId, memberId: base.memberId, questionIds: base.questionIds,
        mcResponseId: mc.response_id, mcRevision: mc.response_revision, responseId: open.response_id, revision: open.response_revision + 1 }
      const member = await openOwner(page)
      const score = page.getByRole('spinbutton', { name: 'Q2 score', exact: true }), feedback = page.getByPlaceholder('Leave a comment...', { exact: true })
      await expect(score).toHaveValue(''); await expect(feedback).toHaveValue('')
      const ack = waitFor(page, 'PATCH', `/api/teacher/tests/${base.testId}/students/${base.memberId}/grades`)
      await feedback.fill(verticalGradeComment); await score.fill('4'); await score.press('Tab')
      const response = await ack; must(response.status() === 200)
      const request = response.request().postDataJSON() as { grades: unknown[] }
      must(isDeepStrictEqual(request, { grades: [{ question_id: base.questionIds[1], response_id: open.response_id,
        expected_response_revision: open.response_revision, score: 4, feedback: verticalGradeComment }] }))
      assertVerticalGradeSave(await r.response(page, response), open)
      await expect(page.getByTestId('teacher-test-grading-save-status')).toHaveText('Grades saved')
      stage = 'owner-close-member'
      const closedAck = waitFor(page, 'POST', `/api/teacher/tests/${base.testId}/student-access`)
      await member.getByRole('switch', { name: /Close access for/ }).click()
      const closedResponse = await closedAck; must(closedResponse.status() === 200)
      const closed = await r.response<{ updated_count: number; skipped_count: number; state: string }>(page, closedResponse)
      must(closed.updated_count === 1 && closed.skipped_count === 0 && closed.state === 'closed')
      stage = 'owner-grade-readback'
      assertVerticalGradeReadback(await r.api(page, 'GET', `/api/teacher/tests/${base.testId}/results`), identity, false)
      await expect(score).toHaveValue('4'); await expect(feedback).toHaveValue(verticalGradeComment)
      await r.snapshot('vertical-owner-graded', page)
    })
    await r.withActor('memberTeacher', async page => {
      stage = 'member-hidden-before-return'; r.check()
      const denied = await r.api<{ error: string }>(page, 'GET', `/api/student/tests/${base.testId}/results`, undefined, 403)
      must(Object.keys(denied).length === 1 && typeof denied.error === 'string')
      assertVerticalLearnerDisclosure(await r.api(page, 'GET', `/api/student/tests/${base.testId}`), false, base.testId)
      await r.navigate(page, classUrl); await page.getByRole('button', { name: /Contextual vertical Test/ }).first().click()
      await expect(page.getByText('Results will be available after your teacher returns this test.', { exact: true })).toBeVisible()
      await expect(page.getByText(verticalGradeComment, { exact: true })).toBeHidden()
      await expect(page.getByText('A private solution', { exact: true })).toBeHidden()
      await expect(page.getByText('A reasoned response', { exact: true })).toBeHidden()
      await expect(page.getByText('Score: 4 / 5', { exact: true })).toBeHidden()
    })
    await r.withActor('ownerStudent', async page => {
      stage = 'owner-return'; const member = await openOwner(page)
      await member.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Student actions for 1 selected', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Return', exact: true }).click()
      const ack = waitFor(page, 'POST', `/api/teacher/tests/${base.testId}/return`)
      await page.getByRole('dialog', { name: 'Return test work to 1 selected student(s)?', exact: true }).getByRole('button', { name: 'Return', exact: true }).click()
      const response = await ack; must(response.status() === 200)
      const body = response.request().postDataJSON() as { student_ids: string[] }
      must(body.student_ids?.length === 1 && body.student_ids[0] === base.memberId)
      const returned = await r.response<{ returned_count: number; already_returned_count: number; skipped_count: number }>(page, response)
      must(returned.returned_count === 1 && returned.already_returned_count === 0 && returned.skipped_count === 0)
      stage = 'owner-return-readback'
      const fresh = await r.api<OwnerResults>(page, 'GET', `/api/teacher/tests/${base.testId}/results`)
      assertVerticalGradeReadback(fresh, identity!, true)
      returnedAt = fresh.students.find(s => s.student_id === base.memberId)!.returned_at!
      await expect(member.getByLabel('Status Returned', { exact: true })).toBeVisible()
      await r.snapshot('vertical-owner-returned', page)
    })
    await r.withActor('memberTeacher', async page => {
      stage = 'member-returned-disclosure'; r.check()
      const fresh = await r.api<{ test: { returned_at: string } }>(page, 'GET', `/api/student/tests/${base.testId}/results`)
      assertVerticalLearnerDisclosure(fresh, true, base.testId, base.questionIds); must(fresh.test.returned_at === returnedAt)
      await r.navigate(page, classUrl); await page.getByRole('button', { name: /Contextual vertical Test/ }).first().click()
      await expect(page.getByText(verticalGradeComment, { exact: true })).toBeVisible()
      await expect(page.getByText('Score: 4 / 5', { exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: /Response for question/ })).toBeHidden()
      await r.snapshot('vertical-member-returned', page)
    })
    r.check(); must(identity)
    return { ...base, gradeReturn: { ...identity, initialRevision: identity.revision - 1, score: 4 as const, feedback: verticalGradeComment,
      returnedAt, hiddenBeforeReturn: true as const, memberSawReturned: true as const } }
  } catch { throw Error(`Contextual Test vertical failed: ${stage}`) }
}
