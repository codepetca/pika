/** Real existing screens, under the caller's isolated session/network controls. */
import assert from 'node:assert/strict'
import { expect, type Locator, type Page, type Response } from '@playwright/test'
import type { ActorLabel } from './contextual-test-rehearsal'
import { assertSurveyResults, assertSurveySubmissionPreserved, surveyExchangeLabels, surveyPrompt, surveyScreens, surveyScope,
  surveyText, surveyTitles, type SurveyIdentity, type SurveyResults, type SurveyRuntime, type SurveyStage, type SurveyTextResult,
  type SurveyWorkflowResult, type SurveyExchange } from './contextual-survey-contract'
export type { SurveyRuntime, SurveyWorkflowResult } from './contextual-survey-contract'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
type Detail = { survey: { id: string; classroom_id: string; title: string; status: string; created_by: string; show_results: boolean;
  dynamic_responses: boolean }; questions: Array<{ id: string; survey_id: string; question_type: string; question_text: string; options: string[] }> }
export function surveyMarkdown(title: string, scratch: boolean): string {
  return `# Survey\nTitle: ${title}\nShow Results: true\nDynamic Responses: false\n\n## Questions\n### Question 1\nType: ${scratch ? 'link' : 'multiple_choice'}\nPrompt:\n${scratch ? surveyPrompt.link : surveyPrompt.mc}\n${scratch ? 'Max Chars: 500' : 'Options:\n- Alpha\n- Beta'}\n\n### Question 2\nType: short_text\nPrompt:\n${surveyPrompt.text}\nMax Chars: 500\n`
}
/** Use the selected Survey's explicit menu, not generic actionbar button order. */
export async function openContextualSurveyEditor(page: Page): Promise<Locator> {
  await page.getByTestId('survey-workspace-actionbar-center').getByRole('button', { name: 'More survey actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit survey', exact: true }).click()
  return page.getByRole('dialog', { name: 'Edit survey', exact: true })
}
/** Select through the real option surface, then independently assert its state. */
export async function chooseContextualSurveyOption(page: Page): Promise<void> {
  const group = page.getByRole('radiogroup', { name: surveyPrompt.mc, exact: true })
  await group.getByText('Beta', { exact: true }).click()
  await expect(group.getByRole('radio', { name: 'Beta', exact: true })).toBeChecked()
}
/** The frozen Classwork link retains surveyId and is hidden in the closed mobile
 * drawer. Only a controlled exact-summary navigation deselects a Survey. */
export async function openContextualSurveyClasswork(r: Pick<SurveyRuntime, 'navigate'>, page: Page, classroomUrl: string, freshDocument = false): Promise<void> {
  const current = new URL(page.url()), target = new URL(classroomUrl)
  assert(target.search === '?tab=assignments' && target.hash === '')
  if (freshDocument || current.href !== target.href) {
    await r.navigate(page, classroomUrl)
  }
}
/** Viewport-only/settings actions can retain the actual selected surface. Every
 * other selection passes through the real summary card; no URL/history injection. */
export async function selectContextualSurvey(r: Pick<SurveyRuntime, 'plan' | 'navigate'>, page: Page, identity: SurveyIdentity,
  owner: boolean, freshDocument = false): Promise<void> {
  assert([r.plan.classrooms.classA.id, r.plan.classrooms.classB.id].includes(identity.classroomId))
  const classroomUrl = `${r.plan.appOrigin}/classrooms/${identity.classroomId}?tab=assignments`
  const current = new URL(page.url()), target = new URL(classroomUrl)
  const sameSelection = current.origin === target.origin && current.pathname === target.pathname && current.hash === ''
    && current.searchParams.size === 2 && current.searchParams.get('tab') === 'assignments'
    && current.searchParams.getAll('surveyId').length === 1 && current.searchParams.get('surveyId') === identity.surveyId
  if (sameSelection && !freshDocument) return
  await openContextualSurveyClasswork(r, page, classroomUrl, freshDocument)
  await page.getByRole('button', { name: owner ? identity.title : new RegExp(identity.title), exact: owner }).first().click()
}
/** Another owner enabled updates; the member's mounted detail has no external
 * refresh. Its own earlier submit refreshed the previous dynamic=false state. */
export async function selectContextualSurveyForResponse(r: Pick<SurveyRuntime, 'plan' | 'navigate'>, page: Page,
  identity: SurveyIdentity, updated: boolean): Promise<void> {
  await selectContextualSurvey(r, page, identity, false, updated)
}
/** Use the existing application control: it updates theme state and persistence
 * immediately, without injecting DOM/storage state or reloading dev bundles. */
export async function setContextualSurveyTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  if (await page.evaluate(value => document.documentElement.classList.contains('dark') === (value === 'dark'), theme)) return
  await page.getByRole('button', { name: 'User menu', exact: true }).click()
  await page.getByRole('menuitem', { name: theme === 'dark' ? 'Dark mode' : 'Light mode', exact: true }).click()
  assert(await page.evaluate(value => document.documentElement.classList.contains('dark') === (value === 'dark')
    && localStorage.getItem('theme') === value, theme))
  await page.getByRole('button', { name: 'User menu', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'User menu', exact: true }).getAttribute('aria-expanded'), 'false')
}
/** API readback does not refresh mounted owner results when counts are equal.
 * Establish freshness on each actor's first capture. Theme/viewport changes do
 * not change the server data; the real theme control updates the mounted view. */
export async function selectContextualSurveyForCapture(r: Pick<SurveyRuntime, 'plan' | 'navigate'>, page: Page,
  identity: SurveyIdentity, owner: boolean, firstCapture: boolean): Promise<void> {
  await selectContextualSurvey(r, page, identity, owner, firstCapture)
}
function waitFor(page: Page, method: string, path: string): Promise<Response> {
  const pending = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path)
  void pending.catch(() => {}); return pending
}
function textRow(results: SurveyResults, actorId: string): SurveyTextResult {
  const rows = results.results[1].responses.filter(row => row.student_id === actorId)
  assert.equal(rows.length, 1)
  const { response_id, response_text, submitted_at, updated_at } = rows[0]
  return { response_id, response_text, submitted_at, updated_at }
}

/** Observe the existing checks in their original order; never retain raw errors,
 * response content or arbitrary status text in failure diagnostics. */
export async function readContextualSurveyScreenExchange(r: Pick<SurveyRuntime, 'response'>, page: Page, response: Response,
  method: SurveyExchange['method'], expectedStatus: number, setStage: (stage: SurveyStage) => void): Promise<{ body: unknown; request: unknown }> {
  setStage('response-body-read')
  const body = await r.response(page, response)
  const status = response.status()
  const statusStages: Readonly<Record<number, SurveyStage>> = {
    200: 'response-status-200', 201: 'response-status-201', 400: 'response-status-400', 401: 'response-status-401',
    403: 'response-status-403', 404: 'response-status-404', 409: 'response-status-409', 413: 'response-status-413',
    429: 'response-status-429', 500: 'response-status-500', 503: 'response-status-503',
  }
  setStage(statusStages[status] ?? 'response-status-other')
  assert.equal(status, expectedStatus)
  setStage('response-request')
  const request = method === 'GET' || method === 'DELETE' ? null : response.request().postDataJSON()
  return { body, request }
}

export async function runContextualSurveyWorkflow(r: SurveyRuntime): Promise<SurveyWorkflowResult> {
  let stage: SurveyStage = 'admission'
  const exchanges: SurveyExchange[] = [], submissions: SurveyWorkflowResult['submissions'] = []
  const deleted: SurveyWorkflowResult['deleted'] = []
  const p = r.plan
  const url = (classroomId: string) => `${p.appOrigin}/classrooms/${classroomId}?tab=assignments`
  const record = async (label: string, actor: ActorLabel, via: SurveyExchange['via'], method: SurveyExchange['method'], path: string,
    page: Page, expectedStatus: number, request: unknown, response?: Response) => {
    r.check()
    const previousStage = stage
    const observed = response ? await readContextualSurveyScreenExchange(r, page, response, method, expectedStatus, next => { stage = next })
      : { body: await r.api(page, method, path, request === null ? undefined : request, expectedStatus), request }
    exchanges.push({ label, actor, via, method, path, status: expectedStatus,
      request: observed.request, response: observed.body })
    stage = previousStage
    return observed.body
  }
  const selected = async (page: Page, identity: SurveyIdentity, owner: boolean, freshDocument = false) => {
    await selectContextualSurvey(r, page, identity, owner, freshDocument)
  }
  const ownerResults = async (page: Page, identity: SurveyIdentity) => {
    const results = await r.api<SurveyResults>(page, 'GET', `/api/teacher/surveys/${identity.surveyId}/results`)
    assertSurveyResults(results, identity); return results
  }
  const create = async (page: Page, actor: 'ownerTeacher' | 'ownerStudent', letter: 'A' | 'B', scratch: boolean): Promise<SurveyIdentity> => {
    stage = scratch ? 'owner-scratch' : 'owner-create'
    const classroom = letter === 'A' ? p.classrooms.classA : p.classrooms.classB
    await openContextualSurveyClasswork(r, page, url(classroom.id))
    const createdAck = waitFor(page, 'POST', '/api/teacher/surveys')
    await page.getByRole('button', { name: 'New classwork', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Survey', exact: true }).click()
    const created = await record(`create-${scratch ? 'scratch-' : ''}${letter}`, actor, 'screen', 'POST', '/api/teacher/surveys', page, 201, null, await createdAck) as { survey: Detail['survey'] }
    assert(uuid.test(created.survey.id) && created.survey.classroom_id === classroom.id && created.survey.created_by === p.actors[actor].id)
    const identity: SurveyIdentity = { surveyId: created.survey.id, classroomId: classroom.id, ownerId: p.actors[actor].id,
      title: scratch ? `Scratch Survey ${letter}` : surveyTitles[letter === 'A' ? 0 : 1], questionIds: ['', ''] }
    const editor = page.getByRole('dialog', { name: 'Edit survey', exact: true })
    stage = 'owner-author'; await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Markdown', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Survey markdown editor', exact: true }).fill(surveyMarkdown(identity.title, scratch))
    await editor.getByRole('button', { name: 'Apply Markdown', exact: true }).click()
    await expect(editor.getByRole('status')).toHaveText('Saved')
    await editor.getByRole('button', { name: 'Close survey editor', exact: true }).click()
    stage = 'owner-reload'; await selected(page, identity, true, true)
    const reopened = await openContextualSurveyEditor(page)
    await expect(reopened.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(identity.title)
    const detail = await r.api<Detail>(page, 'GET', `/api/teacher/surveys/${identity.surveyId}`)
    assert(detail.survey.id === identity.surveyId && detail.survey.classroom_id === classroom.id && detail.survey.created_by === identity.ownerId
      && detail.survey.status === 'draft' && detail.questions.length === 2)
    assert.deepEqual(detail.questions.map(q => q.question_type), [scratch ? 'link' : 'multiple_choice', 'short_text'])
    assert(detail.questions.every(q => uuid.test(q.id) && q.survey_id === identity.surveyId) && detail.questions[0].id !== detail.questions[1].id)
    identity.questionIds = [detail.questions[0].id, detail.questions[1].id]
    stage = 'owner-preview'; await reopened.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(reopened.getByText('Student preview', { exact: true })).toBeVisible()
    await expect(reopened.getByText(scratch ? surveyPrompt.link : surveyPrompt.mc, { exact: true })).toBeVisible()
    await reopened.getByRole('button', { name: 'Back to editor', exact: true }).click()
    stage = 'owner-publish'
    const publishAck = waitFor(page, 'PATCH', `/api/teacher/surveys/${identity.surveyId}`)
    await reopened.getByRole('button', { name: 'Publish', exact: true }).click()
    const publication = await record(`publish-${scratch ? 'scratch-' : ''}${letter}`, actor, 'screen', 'PATCH', `/api/teacher/surveys/${identity.surveyId}`, page, 200, null, await publishAck) as { survey: Detail['survey'] }
    assert(publication.survey.id === identity.surveyId && publication.survey.status === 'active')
    await expect(reopened.getByRole('button', { name: 'Close survey editor', exact: true })).toBeEnabled()
    await reopened.getByRole('button', { name: 'Close survey editor', exact: true }).click()
    return identity
  }
  const respond = async (page: Page, actor: ActorLabel, identity: SurveyIdentity, label: string, scratch = false, updated = false) => {
    stage = 'response-select'
    await selectContextualSurveyForResponse(r, page, identity, updated)
    stage = 'response-form'
    const respondAction = page.getByRole('button', { name: updated ? 'Edit response' : 'Respond', exact: true })
    await expect(respondAction).toBeVisible(); await respondAction.click()
    stage = 'response-option'
    if (scratch) await page.getByRole('textbox', { name: `${surveyPrompt.link} response`, exact: true }).fill('https://example.invalid/learning')
    else await chooseContextualSurveyOption(page)
    stage = 'response-text'
    await page.getByRole('textbox', { name: `${surveyPrompt.text} response`, exact: true }).fill(surveyText(actor, updated))
    const ack = waitFor(page, 'POST', `/api/student/surveys/${identity.surveyId}/respond`)
    stage = 'response-submit'
    await page.getByRole('button', { name: updated ? 'Update responses' : 'Submit', exact: true }).click()
    stage = 'response-ack'; const acknowledged = await ack
    stage = 'response-body'
    const body = await record(label, actor, 'screen', 'POST', `/api/student/surveys/${identity.surveyId}/respond`, page, updated ? 200 : 201, null, acknowledged) as { success: boolean; updated: boolean }
    stage = 'response-validate'
    assert(body.success === true && body.updated === updated)
    stage = 'member-results'
    const results = await r.api<SurveyResults>(page, 'GET', `/api/student/surveys/${identity.surveyId}/results`)
    if (!scratch) assertSurveyResults(results, identity, true)
    await expect(page.getByText(surveyText(actor, updated), { exact: true })).toBeVisible()
  }
  const answers = (identity: SurveyIdentity, actor: ActorLabel, updated = false) => ({ responses: {
    [identity.questionIds[0]]: { question_type: 'multiple_choice', selected_option: 1 },
    [identity.questionIds[1]]: { question_type: 'short_text', response_text: surveyText(actor, updated) },
  } })
  const setting = async (page: Page, actor: 'ownerTeacher' | 'ownerStudent', identity: SurveyIdentity, label: string,
    option: 'Allow students to update responses' | 'Show class results to students') => {
    await selected(page, identity, true); const editor = await openContextualSurveyEditor(page)
    await editor.getByRole('button', { name: 'Settings', exact: true }).click()
    const ack = waitFor(page, 'PATCH', `/api/teacher/surveys/${identity.surveyId}`)
    await page.getByRole('menuitemcheckbox', { name: option, exact: true }).click()
    await record(label, actor, 'screen', 'PATCH', `/api/teacher/surveys/${identity.surveyId}`, page, 200, null, await ack)
    await expect(editor.getByRole('button', { name: 'Close survey editor', exact: true })).toBeEnabled()
    await editor.getByRole('button', { name: 'Close survey editor', exact: true }).click()
  }
  const removeScratch = async (page: Page, actor: 'ownerTeacher' | 'ownerStudent', identity: SurveyIdentity, letter: 'A' | 'B') => {
    stage = 'owner-scratch'; await selected(page, identity, true)
    const editor = await openContextualSurveyEditor(page)
    await expect(editor.getByRole('spinbutton', { name: 'Question number', exact: true })).toHaveValue('1')
    await editor.getByRole('button', { name: 'Question actions', exact: true }).click()
    const ack = waitFor(page, 'DELETE', `/api/teacher/surveys/${identity.surveyId}/questions/${identity.questionIds[0]}`)
    await page.getByRole('menuitem', { name: 'Delete question', exact: true }).click()
    await record(`delete-question-${letter}`, actor, 'screen', 'DELETE', `/api/teacher/surveys/${identity.surveyId}/questions/${identity.questionIds[0]}`, page, 200, null, await ack)
    const one = await r.api<Detail>(page, 'GET', `/api/teacher/surveys/${identity.surveyId}`)
    assert.deepEqual(one.questions.map(q => q.id), [identity.questionIds[1]])
    await editor.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete survey', exact: true }).click()
    const deleteAck = waitFor(page, 'DELETE', `/api/teacher/surveys/${identity.surveyId}`)
    await page.getByRole('dialog', { name: 'Delete survey?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click()
    await record(`delete-scratch-${letter}`, actor, 'screen', 'DELETE', `/api/teacher/surveys/${identity.surveyId}`, page, 200, null, await deleteAck)
    deleted.push({ surveyId: identity.surveyId, classroomId: identity.classroomId, questionIds: identity.questionIds })
  }
  let result: SurveyWorkflowResult | undefined
  try {
    assert.equal(p.proofScope, surveyScope); r.check()
    await r.withActor('ownerTeacher', async ownerA => {
      const mainA = await create(ownerA, 'ownerTeacher', 'A', false), scratchA = await create(ownerA, 'ownerTeacher', 'A', true)
      await r.withActor('ownerStudent', async ownerB => {
        const mainB = await create(ownerB, 'ownerStudent', 'B', false), scratchB = await create(ownerB, 'ownerStudent', 'B', true)
        stage = 'owner-cross-class'
        await respond(ownerA, 'ownerTeacher', mainB, 'cross-ownerTeacher')
        await respond(ownerB, 'ownerStudent', mainA, 'cross-ownerStudent')
        await respond(ownerB, 'ownerStudent', scratchA, 'scratch-submit-A', true)
        await respond(ownerA, 'ownerTeacher', scratchB, 'scratch-submit-B', true)
        await removeScratch(ownerA, 'ownerTeacher', scratchA, 'A'); await removeScratch(ownerB, 'ownerStudent', scratchB, 'B')
        await r.withActor('memberStudent', async student => {
          await respond(student, 'memberStudent', mainA, 'submit-memberStudent')
          stage = 'static-duplicate'
          await record('static-duplicate', 'memberStudent', 'denied-probe', 'POST', `/api/student/surveys/${mainA.surveyId}/respond`, student, 400, answers(mainA, 'memberStudent'))
          await r.withActor('memberTeacher', async teacher => {
            await respond(teacher, 'memberTeacher', mainB, 'submit-memberTeacher')
            const initialA = await ownerResults(ownerA, mainA), initialB = await ownerResults(ownerB, mainB)
            for (const [identity, graph, actor] of [[mainA, initialA, 'memberStudent'], [mainA, initialA, 'ownerStudent'], [mainB, initialB, 'memberTeacher'], [mainB, initialB, 'ownerTeacher']] as const) {
              const initial = textRow(graph, p.actors[actor].id)
              submissions.push({ surveyId: identity.surveyId, actor, studentId: p.actors[actor].id, initial, final: initial })
            }
            stage = 'denials'; const before: [SurveyResults, SurveyResults] = [initialA, initialB]
            await record('self-owner', 'ownerTeacher', 'denied-probe', 'GET', `/api/student/surveys/${mainA.surveyId}`, ownerA, 403, null)
            await record('foreign-owner', 'ownerTeacher', 'denied-probe', 'PATCH', `/api/teacher/surveys/${mainB.surveyId}`, ownerA, 403, { title: 'Forbidden foreign edit' })
            await record('foreign-question', 'ownerTeacher', 'denied-probe', 'PATCH', `/api/teacher/surveys/${mainA.surveyId}/questions/${mainB.questionIds[0]}`, ownerA, 404, { question_text: 'Forbidden foreign question' })
            await record('foreign-class', 'ownerTeacher', 'denied-probe', 'GET', `/api/teacher/surveys?classroom_id=${mainB.classroomId}`, ownerA, 403, null)
            await record('member-owner', 'memberTeacher', 'denied-probe', 'GET', `/api/teacher/surveys/${mainB.surveyId}/results`, teacher, 403, null)
            await r.withActor('nonmember', async outsider => {
              await record('nonmember-detail', 'nonmember', 'denied-probe', 'GET', `/api/student/surveys/${mainA.surveyId}`, outsider, 403, null)
              await record('nonmember-results', 'nonmember', 'denied-probe', 'GET', `/api/student/surveys/${mainA.surveyId}/results`, outsider, 403, null)
            })
            const after: [SurveyResults, SurveyResults] = [await ownerResults(ownerA, mainA), await ownerResults(ownerB, mainB)]
            assert.deepEqual(after, before)
            await setting(ownerA, 'ownerTeacher', mainA, 'dynamic-enabled', 'Allow students to update responses')
            await respond(student, 'memberStudent', mainA, 'dynamic-update', false, true)
            const dynamic = await ownerResults(ownerA, mainA)
            for (const submission of submissions.filter(s => s.surveyId === mainA.surveyId)) {
              submission.final = textRow(dynamic, submission.studentId)
              assertSurveySubmissionPreserved(submission.initial, submission.final, submission.actor, submission.actor === 'memberStudent')
            }
            stage = 'visibility'
            await setting(ownerA, 'ownerTeacher', mainA, 'hide-results', 'Show class results to students')
            await record('hidden-results', 'memberStudent', 'denied-probe', 'GET', `/api/student/surveys/${mainA.surveyId}/results`, student, 403, null)
            await setting(ownerA, 'ownerTeacher', mainA, 'show-results', 'Show class results to students')
            stage = 'future-opening'
            await record('future-opening', 'ownerTeacher', 'permission-fixture', 'PATCH', `/api/teacher/surveys/${mainA.surveyId}`, ownerA, 200, { opens_at: '2099-01-01T00:00:00.000Z' })
            await record('future-response', 'memberStudent', 'denied-probe', 'POST', `/api/student/surveys/${mainA.surveyId}/respond`, student, 400, answers(mainA, 'memberStudent', true))
            await record('restore-opening', 'ownerTeacher', 'permission-fixture', 'PATCH', `/api/teacher/surveys/${mainA.surveyId}`, ownerA, 200, { opens_at: null })
            stage = 'close-reopen'; await selected(ownerA, mainA, true)
            for (const [label, button] of [['close', 'Close poll'], ['reopen', 'Open poll']] as const) {
              const ack = waitFor(ownerA, 'PATCH', `/api/teacher/surveys/${mainA.surveyId}`)
              await ownerA.getByRole('button', { name: button, exact: true }).click()
              await record(label, 'ownerTeacher', 'screen', 'PATCH', `/api/teacher/surveys/${mainA.surveyId}`, ownerA, 200, null, await ack)
              if (label === 'close') await record('closed-response', 'memberStudent', 'denied-probe', 'POST', `/api/student/surveys/${mainA.surveyId}/respond`, student, 400, answers(mainA, 'memberStudent', true))
            }
            stage = 'captures'
            const capturedActors = new Set<string>()
            for (const scene of surveyScreens) {
              const page = { ownerTeacher: ownerA, ownerStudent: ownerB, memberStudent: student, memberTeacher: teacher }[scene.actor]
              const identity = scene.actor === 'ownerTeacher' || scene.actor === 'memberStudent' ? mainA : mainB
              await page.setViewportSize(scene.viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 })
              await page.emulateMedia({ colorScheme: scene.theme })
              await setContextualSurveyTheme(page, scene.theme)
              await selectContextualSurveyForCapture(r, page, identity, scene.actor.startsWith('owner'), !capturedActors.has(scene.actor))
              await expect(page.getByText(surveyText(scene.actor === 'ownerTeacher' ? 'memberStudent' : scene.actor === 'ownerStudent' ? 'memberTeacher' : scene.actor,
                scene.actor === 'ownerTeacher' || scene.actor === 'memberStudent'), { exact: true })).toBeVisible()
              const editor = scene.actor.startsWith('owner') ? await openContextualSurveyEditor(page) : null
              if (editor) {
                await expect(editor.getByRole('textbox', { name: 'Prompt', exact: true })).toContainText(surveyPrompt.mc)
                await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(identity.title)
              }
              assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
              await r.snapshot(scene.label, page)
              capturedActors.add(scene.actor)
              if (editor) await editor.getByRole('button', { name: 'Close survey editor', exact: true }).click()
            }
            stage = 'archive'; const archiveBefore = await ownerResults(ownerB, mainB)
            await record('archive', 'ownerStudent', 'permission-fixture', 'PATCH', `/api/teacher/classrooms/${mainB.classroomId}`, ownerB, 200, { archived: true })
            for (const [label, method, suffix, body] of [['archived-cached-detail', 'GET', '', null], ['archived-cached-response', 'POST', '/respond', answers(mainB, 'memberTeacher')], ['archived-cached-results', 'GET', '/results', null]] as const) {
              await record(label, 'memberTeacher', 'denied-probe', method, `/api/student/surveys/${mainB.surveyId}${suffix}`, teacher, 403, body)
            }
            await record('archived-owner-read', 'ownerStudent', 'permission-fixture', 'GET', `/api/teacher/surveys/${mainB.surveyId}`, ownerB, 200, null)
            await record('archived-owner-write', 'ownerStudent', 'denied-probe', 'PATCH', `/api/teacher/surveys/${mainB.surveyId}`, ownerB, 403, { title: 'Forbidden archive edit' })
            await r.withActor('memberTeacher', async fresh => {
              await record('archived-fresh-detail', 'memberTeacher', 'denied-probe', 'GET', `/api/student/surveys/${mainB.surveyId}`, fresh, 403, null)
              await record('archived-fresh-response', 'memberTeacher', 'denied-probe', 'POST', `/api/student/surveys/${mainB.surveyId}/respond`, fresh, 403, answers(mainB, 'memberTeacher'))
            })
            await record('unarchive', 'ownerStudent', 'permission-fixture', 'PATCH', `/api/teacher/classrooms/${mainB.classroomId}`, ownerB, 200, { archived: false })
            const archiveAfter = await ownerResults(ownerB, mainB); assert.deepEqual(archiveAfter, archiveBefore)
            stage = 'revocation'; assert(p.lifecycleRoster?.classroomId === mainA.classroomId && p.lifecycleRoster.studentId === p.actors.memberStudent.id)
            await record('remove-member', 'ownerTeacher', 'permission-fixture', 'POST', `/api/teacher/classrooms/${mainA.classroomId}/roster/remove`, ownerA, 200, { roster_ids: [p.lifecycleRoster.id] })
            for (const [label, method, suffix, body] of [['revoked-cached-detail', 'GET', '', null], ['revoked-cached-response', 'POST', '/respond', answers(mainA, 'memberStudent', true)], ['revoked-cached-results', 'GET', '/results', null]] as const) {
              await record(label, 'memberStudent', 'denied-probe', method, `/api/student/surveys/${mainA.surveyId}${suffix}`, student, 403, body)
            }
            await r.withActor('memberStudent', async fresh => {
              await record('revoked-fresh-detail', 'memberStudent', 'denied-probe', 'GET', `/api/student/surveys/${mainA.surveyId}`, fresh, 403, null)
              await record('revoked-fresh-response', 'memberStudent', 'denied-probe', 'POST', `/api/student/surveys/${mainA.surveyId}/respond`, fresh, 403, answers(mainA, 'memberStudent', true))
            })
            stage = 'final-readback'
            const remaining = await r.api<SurveyResults>(ownerA, 'GET', `/api/teacher/surveys/${mainA.surveyId}/results`)
            assert(remaining.stats?.total_students === 2 && remaining.stats.responded === 1)
            assert.deepEqual(remaining.responders?.map(row => row.student_id), [p.actors.ownerStudent.id])
            assert.deepEqual(textRow(remaining, p.actors.ownerStudent.id), submissions.find(s => s.actor === 'ownerStudent')!.final)
            assert.deepEqual(exchanges.map(e => e.label), [...surveyExchangeLabels])
            result = { surveys: [mainA, mainB], deleted, submissions, archive: { before: archiveBefore, after: archiveAfter }, denials: { before, after }, exchanges }
          })
        })
      })
    })
    assert(result); r.check(); return result
  } catch { throw Error(`Contextual Survey failed: ${stage}`) }
}
