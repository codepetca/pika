/** One ordinary UI workflow against the frozen app; importing never starts a run.
 * The caller owns authentication, request limits, deadlines and browser disposal.
 * CPU contracts validate these assertions, not the real UI or database outcome.
 */
import { expect, type Page, type Response } from '@playwright/test'
import { types } from 'node:util'
import type { RehearsalPlan } from './contextual-test-rehearsal'

export type VerticalTestRuntime = {
  plan: RehearsalPlan
  withActor(actor: 'ownerStudent' | 'memberTeacher' | 'nonmember', callback: (page: Page) => Promise<void>): Promise<void>
  api<T>(page: Page, method: string, path: string, body?: unknown, expectedStatus?: number): Promise<T>
  response<T>(page: Page, response: Response): Promise<T>
  navigate(page: Page, url: string): Promise<void>
  check(): void
  snapshot(label: string, page: Page): Promise<void>
}

export const contextualTestVerticalContract = Object.freeze({ createdTests: 1, questions: 2, uploadObjects: 0,
  screenshots: 3, automaticRetries: 0, actors: Object.freeze(['ownerStudent', 'memberTeacher', 'nonmember'] as const) })
export const contextualTestVerticalStages = Object.freeze(['admission', 'owner-create', 'owner-author', 'owner-reload-readback',
  'owner-publish', 'published-readback', 'owner-open-member', 'owner-self-enrollment-denial', 'member-owner-api-denial',
  'member-start', 'member-answer', 'member-submit', 'nonmember-read-denial', 'owner-response-inspector', 'owner-results-readback'] as const)
type VerticalStage = typeof contextualTestVerticalStages[number]
const failurePrefix = 'Contextual Test vertical failed: '
/** Never invoke user accessors or Proxy traps while reducing an error to a label. */
export function verticalWorkflowFailureStage(error: unknown): VerticalStage | null {
  if (!error || typeof error !== 'object' || types.isProxy(error)) return null
  const message = Object.getOwnPropertyDescriptor(error, 'message')
  if (!message || !('value' in message) || typeof message.value !== 'string' || !message.value.startsWith(failurePrefix)) return null
  const suffix = message.value.slice(failurePrefix.length)
  return contextualTestVerticalStages.find(stage => stage === suffix) ?? null
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
function requireThat(condition: unknown, stage: string): asserts condition {
  if (!condition) throw new Error(`Contextual Test vertical failed: ${stage}`)
}
type Questions = { id: string; question_type: string }[]
type TestDetail = { test: { id: string; classroom_id: string; title: string; status: string; documents: unknown[] }; questions: Questions }
type QuestionIds = { mcId: string; openId: string }
type Answer = { response_id: string; response_revision: number; selected_option: number | null; response_text: string | null; is_draft?: boolean }
type Results = { questions: Questions; students: { student_id: string; status: string; returned_at: string | null; answers: Record<string, Answer> }[] }
type Attempt = { id: string; test_id: string; student_id: string; is_submitted: boolean; draft_revision: number;
  responses: Record<string, { question_type: string; selected_option?: number; response_text?: string }> }

export function assertVerticalPublishedGraph(detail: TestDetail, testId: string, classroomId: string, title: string, resultQuestions: Questions = detail.questions): QuestionIds {
  const stage = 'published-readback'
  requireThat(detail?.test?.id === testId && detail.test.classroom_id === classroomId && detail.test.title === title
    && detail.test.status === 'closed' && Array.isArray(detail.test.documents) && detail.test.documents.length === 0, stage)
  for (const questions of [detail.questions, resultQuestions]) {
    requireThat(Array.isArray(questions) && questions.length === 2 && new Set(questions.map(q => q.id)).size === 2
      && questions.every(q => uuid.test(q.id)) && questions.some(q => q.question_type === 'multiple_choice')
      && questions.some(q => q.question_type === 'open_response'), stage)
  }
  // Detail uses portable authoring identities; results uses actual learner row IDs.
  const mc = resultQuestions.find(q => q.question_type === 'multiple_choice')!, open = resultQuestions.find(q => q.question_type === 'open_response')!
  return { mcId: mc.id, openId: open.id }
}

export function assertVerticalSubmittedGraph(results: Results, memberId: string, questions: QuestionIds, text: string): void {
  const stage = 'owner-results-readback'
  requireThat(Array.isArray(results?.questions) && results.questions.length === 2
    && results.questions.some(q => q.id === questions.mcId && q.question_type === 'multiple_choice')
    && results.questions.some(q => q.id === questions.openId && q.question_type === 'open_response'), stage)
  const members = results.students.filter(row => row.student_id === memberId)
  requireThat(members.length === 1, stage)
  const row = members[0], mc = row.answers[questions.mcId], open = row.answers[questions.openId]
  requireThat(row.status === 'submitted' && row.returned_at === null && Object.keys(row.answers).length === 2
    && mc && open && uuid.test(mc.response_id) && uuid.test(open.response_id) && mc.response_id !== open.response_id
    && Number.isSafeInteger(mc.response_revision) && mc.response_revision > 0 && Number.isSafeInteger(open.response_revision) && open.response_revision > 0
    && mc.is_draft !== true && open.is_draft !== true && mc.selected_option === 1 && mc.response_text === null
    && open.selected_option === null && open.response_text === text, stage)
}

function markdown(title: string): string {
  return `# Test\nTitle: ${title}\nShow Results: false\n\n## Questions\n### Question 1\nType: multiple_choice\nPoints: 5\nPrompt:\nChoose the second option.\nOptions:\n- Alpha\n- Beta\nCorrect Option: 2\n\n### Question 2\nType: open_response\nPoints: 5\nMax Chars: 2000\nPrompt:\nExplain your reasoning.\nAnswer Key:\nA reasoned response\nSample Solution:\nA private solution\n`
}

function waitFor(page: Page, method: string, path: string): Promise<Response> {
  const pending = page.waitForResponse(res => new URL(res.url()).pathname === path && res.request().method() === method)
  // A failed click still closes the context; retain the original rejection for
  // its awaiting caller without a detached unhandled rejection during cleanup.
  void pending.catch(() => {})
  return pending
}

/** Exactly one new Test; every successful mutation is an ordinary app UI action.
 * No grading, upload, provider, reorder, archive, purge, or recovery operations.
 * Errors expose a fixed stage, never response bodies or credentials.
 */
export async function runContextualTestVerticalWorkflow(r: VerticalTestRuntime) {
  let stage: VerticalStage = 'admission'
  try {
    r.check()
    const classroomId = r.plan.classrooms.classB.id, ownerId = r.plan.actors.ownerStudent.id, memberId = r.plan.actors.memberTeacher.id
    requireThat(r.plan.classrooms.classB.owner === 'ownerStudent' && r.plan.actors.ownerStudent.role === 'student'
      && r.plan.actors.memberTeacher.role === 'teacher' && [classroomId, ownerId, memberId].every(id => uuid.test(id)), stage)
    const title = 'Contextual vertical Test', text = 'Synthetic reasoning: Beta is the second option.'
    const classUrl = `${r.plan.appOrigin}/classrooms/${classroomId}?tab=tests`
    let testId = '', questionIds: QuestionIds = { mcId: '', openId: '' }
    await r.withActor('ownerStudent', async page => {
      stage = 'owner-create'; r.check(); await r.navigate(page, classUrl); r.check()
      const createdAck = waitFor(page, 'POST', '/api/teacher/tests')
      await page.getByRole('button', { name: 'Create test', exact: true }).click()
      const createdResponse = await createdAck
      requireThat(createdResponse.status() === 201, stage)
      const created = await r.response<{ test: { id: string; classroom_id: string } }>(page, createdResponse)
      requireThat(created?.test?.classroom_id === classroomId && uuid.test(created.test.id) && !r.plan.retiredTestIds.includes(created.test.id), stage)
      testId = created.test.id
      stage = 'owner-author'; r.check()
      const editor = page.getByRole('dialog', { name: 'Edit test', exact: true })
      await expect(editor).toBeVisible()
      await editor.getByRole('button', { name: 'Markdown', exact: true }).click()
      await editor.getByTestId('test-markdown-editor').fill(markdown(title))
      await editor.getByRole('button', { name: 'Apply Markdown', exact: true }).click()
      await expect(editor.getByTestId('teacher-test-authoring-save-status')).toHaveText('Test saved', { timeout: 30_000 })
      await editor.getByRole('button', { name: 'Close test editor', exact: true }).click()
      stage = 'owner-reload-readback'; r.check()
      // navigate performs a real document navigation; the runtime owns its mechanics.
      await r.navigate(page, classUrl)
      await page.getByRole('button', { name: title, exact: true }).click()
      await page.getByTestId('test-workspace-trailing-actions').getByRole('button', { name: 'More actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Edit Markdown', exact: true }).click()
      await expect(editor).toBeVisible()
      const readback = await editor.getByTestId('test-markdown-editor').inputValue()
      requireThat(readback.includes(`Title: ${title}`) && readback.includes('A private solution') && readback.includes('Explain your reasoning.'), stage)
      const draft = await r.api<{ draft: { version: number; content: { title: string; questions: unknown[]; documents: unknown[] } } }>(page, 'GET', `/api/teacher/tests/${testId}/draft`)
      requireThat(draft.draft.version > 0 && draft.draft.content.title === title && draft.draft.content.questions.length === 2 && draft.draft.content.documents.length === 0, stage)
      await r.snapshot('vertical-owner-author', page)
      stage = 'owner-publish'; r.check()
      const publishAck = waitFor(page, 'POST', `/api/teacher/tests/${testId}/publish`)
      await editor.getByRole('button', { name: 'Publish', exact: true }).click()
      await page.getByRole('dialog', { name: 'Publish test?', exact: true }).getByRole('button', { name: 'Publish', exact: true }).click()
      requireThat((await publishAck).status() === 200, stage)
      stage = 'published-readback'
      const detail = await r.api<TestDetail>(page, 'GET', `/api/teacher/tests/${testId}`)
      const results = await r.api<Results>(page, 'GET', `/api/teacher/tests/${testId}/results`)
      questionIds = assertVerticalPublishedGraph(detail, testId, classroomId, title, results.questions)
      stage = 'owner-open-member'; r.check()
      // Reopen the saved row so the published grading table is freshly mounted.
      await r.navigate(page, classUrl)
      await page.getByRole('button', { name: title, exact: true }).click()
      const member = page.getByTestId(`test-grading-student-row-${memberId}`)
      await expect(member).toBeVisible()
      const accessAck = waitFor(page, 'POST', `/api/teacher/tests/${testId}/student-access`)
      await member.getByRole('switch', { name: /Open access for/ }).click()
      await page.getByRole('dialog', { name: 'Open access for 1 student(s)?', exact: true }).getByRole('button', { name: 'Open Access', exact: true }).click()
      const accessResponse = await accessAck
      requireThat(accessResponse.status() === 200, stage)
      const access = await r.response<{ updated_count: number; skipped_count: number; state: string }>(page, accessResponse)
      requireThat(access.updated_count === 1 && access.skipped_count === 0 && access.state === 'open', stage)
      stage = 'owner-self-enrollment-denial'; r.check()
      await r.api(page, 'POST', `/api/student/tests/${testId}/start`, {}, 403)
    })

    await r.withActor('memberTeacher', async page => {
      stage = 'member-owner-api-denial'; r.check()
      await r.api(page, 'GET', `/api/teacher/tests/${testId}/results`, undefined, 403)
      stage = 'member-start'; await r.navigate(page, classUrl); r.check()
      await page.getByRole('button', { name: new RegExp(title) }).first().click()
      await page.getByRole('button', { name: 'Start the Test', exact: true }).click()
      await page.getByRole('dialog', { name: 'Start this test?', exact: true }).getByRole('button', { name: 'Start test', exact: true }).click()
      await expect(page.getByTestId('student-test-split-container')).toBeVisible()
      await expect(page.getByTestId('exam-interaction-blocker')).toBeHidden()
      stage = 'member-answer'; r.check()
      await page.getByRole('textbox', { name: /Response for question/ }).fill(text)
      await page.getByRole('radio', { name: 'Beta', exact: true }).check()
      await expect(page.getByTestId('student-test-autosave-status')).toHaveText('Saved', { timeout: 30_000 })
      const verifyAttempt = (attempt: Attempt, submitted: boolean) => {
        requireThat(attempt && uuid.test(attempt.id) && attempt.test_id === testId && attempt.student_id === memberId
          && attempt.is_submitted === submitted && attempt.draft_revision > 0 && Object.keys(attempt.responses).length === 2
          && attempt.responses[questionIds.openId]?.question_type === 'open_response' && attempt.responses[questionIds.openId]?.response_text === text
          && attempt.responses[questionIds.mcId]?.question_type === 'multiple_choice' && attempt.responses[questionIds.mcId]?.selected_option === 1, stage)
      }
      verifyAttempt((await r.api<{ attempt: Attempt }>(page, 'GET', `/api/student/tests/${testId}/attempt`)).attempt, false)
      stage = 'member-submit'; r.check()
      const submitAck = waitFor(page, 'POST', `/api/student/tests/${testId}/respond`)
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await page.getByRole('dialog', { name: 'Submit your answers?', exact: true }).getByRole('button', { name: 'Submit', exact: true }).click()
      const response = await submitAck
      requireThat(response.status() === 201, stage)
      const acknowledgement = await r.response<{ success: boolean; draft_revision: number }>(page, response)
      requireThat(acknowledgement.success === true && acknowledgement.draft_revision > 0, stage)
      verifyAttempt((await r.api<{ attempt: Attempt }>(page, 'GET', `/api/student/tests/${testId}/attempt`)).attempt, true)
      await expect(page.getByRole('textbox', { name: /Response for question/ })).toBeHidden()
      await r.snapshot('vertical-member-submitted', page)
    })

    await r.withActor('nonmember', async page => {
      stage = 'nonmember-read-denial'; r.check()
      // Frozen migration257 checks membership before payload disclosure: PT403.
      await r.api(page, 'GET', `/api/student/tests/${testId}`, undefined, 403)
    })

    await r.withActor('ownerStudent', async page => {
      stage = 'owner-response-inspector'; r.check(); await r.navigate(page, classUrl)
      await page.getByRole('button', { name: title, exact: true }).click()
      await page.getByTestId(`test-grading-student-row-${memberId}`).click()
      await expect(page.getByTestId('test-grading-inspector-scroll-pane').getByText(text, { exact: true })).toBeVisible()
      stage = 'owner-results-readback'; r.check()
      assertVerticalSubmittedGraph(await r.api<Results>(page, 'GET', `/api/teacher/tests/${testId}/results`), memberId, questionIds, text)
      await r.snapshot('vertical-owner-results', page)
    })
    r.check()
    return { testId, questionIds: [questionIds.mcId, questionIds.openId] as const, ownerId, memberId, classroomId,
      submitted: true as const, ownerSawResponse: true as const, denials: { ownerLearner: 403, memberTeacher: 403, nonmemberRead: 403 } as const }
  } catch {
    throw new Error(`Contextual Test vertical failed: ${stage}`)
  }
}
