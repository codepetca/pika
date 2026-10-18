/** Ordinary Playwright; network admission and body limits belong to the gateways. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page, Response } from '@playwright/test'
import { contextualTestStartupBinding } from './contextual-test-startup'
import { createContextualTestPlan } from './contextual-test-rehearsal'
import { verticalWorkflowFailureStage, type VerticalTestRuntime, type runContextualTestVerticalWorkflow } from './contextual-test-vertical-workflow'
import { gradeReturnActors, gradeReturnLabels } from './contextual-test-grade-return-contract'
import type { runContextualTestGradeReturnWorkflow } from './contextual-test-grade-return-workflow'
import { lifecycleActors, lifecycleLabels, lifecycleScreens, lifecycleFailureStage, type LifecycleResult } from './contextual-test-lifecycle-contract'
import type { LifecycleRuntime } from './contextual-test-lifecycle-workflow'
import { surveyActors, surveyLabels, surveyScreens, surveyFailureStage, type SurveyRuntime, type SurveyWorkflowResult } from './contextual-survey-contract'

// Public DOM hydration check, without importing the former interception runtime.
export function verticalLoginReady(): boolean {
  const forms = document.querySelectorAll('form')
  if (forms.length !== 1) return false
  const email = forms[0].querySelector<HTMLInputElement>('input[type="email"]')
  const password = forms[0].querySelector<HTMLInputElement>('input[type="password"]')
  const submit = forms[0].querySelector<HTMLButtonElement>('button[type="submit"]')
  return email?.value === 'teacher@example.com' && password?.value === 'test1234'
    && submit?.textContent?.trim() === 'Login' && !submit.disabled
}

/** Finish finite UI transitions for lifecycle captures; preserve other scopes. */
export function verticalScreenshotOptions(lifecycle: boolean, timeout: number) {
  return { fullPage: false as const, timeout, ...(lifecycle ? { animations: 'disabled' as const } : {}) }
}

export async function createContextualTestVerticalRuntime(browser: Browser) {
  const binding = contextualTestStartupBinding()
  assert(binding.proofScope === 'vertical-v1' || binding.proofScope === 'vertical-grade-return-v1' || binding.proofScope === 'lifecycle-permissions-v1' || binding.proofScope === 'survey-workflow-v1'); assert(!binding.sqlControl)
  const successor = binding.proofScope === 'vertical-grade-return-v1'
  const lifecycle = binding.proofScope === 'lifecycle-permissions-v1'
  const survey = binding.proofScope === 'survey-workflow-v1'
  const plan = createContextualTestPlan(binding.projectId, binding.proofScope)
  const expectedActors = survey ? surveyActors : lifecycle ? lifecycleActors : successor ? gradeReturnActors : ['ownerStudent','memberTeacher','nonmember','ownerStudent'] as const
  const expectedLabels = survey ? surveyLabels : lifecycle ? lifecycleLabels : successor ? gradeReturnLabels : ['vertical-owner-author','vertical-member-submitted','vertical-owner-results'] as const
  const contexts = new Set<BrowserContext>(), artifacts: Array<{ label: string; kind: 'png'; bytes: number; sha256: string; actor?: string; viewport?: string; theme?: string }> = []
  const actors: string[] = []
  const contextActors = new WeakMap<BrowserContext,string>()
  let pageErrors = 0, closed = false, step = 'startup'
  const output = join(binding.outputDir, 'playwright'); mkdirSync(output, { mode: 0o700 })
  const check = () => { assert(!closed && Date.now() < binding.deadline, 'Narrow Test deadline') }
  const timeout = () => { check(); return Math.min(30000, binding.deadline - Date.now()) }
  const owned = (page: Page) => { check(); assert(contexts.has(page.context())); return page.context() }
  async function response<T>(page: Page, value: Response): Promise<T> {
    owned(page); const u = new URL(value.url()); assert.equal(u.origin, plan.appOrigin)
    const bytes = await value.body(); check(); assert(bytes.length <= 1048576)
    return JSON.parse(bytes.toString('utf8')) as T
  }
  const runtime: LifecycleRuntime = {
    plan, check, response,
    async api<T>(page: Page, method: string, path: string, body?: unknown, expectedStatus = 200): Promise<T> {
      step = 'api'; const context = owned(page)
      assert(path.startsWith('/api/') && !path.startsWith('//') && new URL(path, plan.appOrigin).origin === plan.appOrigin)
      const result = await context.request.fetch(plan.appOrigin + path, { method, data: body, timeout: timeout(), maxRedirects: 0, maxRetries: 0 })
      try {
        check(); assert.equal(result.status(), expectedStatus)
        const bytes = await result.body(); check(); assert(bytes.length <= 1048576)
        return JSON.parse(bytes.toString('utf8')) as T
      } finally { await result.dispose() }
    },
    async navigate(page, url) {
      step = 'navigation'; owned(page); assert.equal(new URL(url).origin, plan.appOrigin)
      await page.goto(url, { waitUntil: 'load', timeout: timeout() }); check()
    },
    async withActor(actorLabel, callback) {
      step = 'login'; check(); assert(survey || lifecycle || ['ownerStudent','memberTeacher','nonmember'].includes(actorLabel))
      assert(successor || lifecycle || survey ? actorLabel === expectedActors[actors.length] : actors.length < 5)
      const actor = plan.actors[actorLabel === 'ownerTeacherPeer' ? 'ownerTeacher' : actorLabel]
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(lifecycle || survey ? {colorScheme:'light' as const}:{}), serviceWorkers: 'block', acceptDownloads: false })
      contexts.add(context)
      context.on('page', page => { page.on('pageerror', () => { pageErrors++ }) })
      context.setDefaultTimeout(timeout()); context.setDefaultNavigationTimeout(timeout())
      try {
        const page = await context.newPage()
        await page.goto(plan.appOrigin + '/login', { waitUntil: 'load', timeout: timeout() })
        // Existing public preset is only a React-hydration barrier, not fixture auth.
        await page.getByRole('button', { name: 'Teacher', exact: true }).click()
        await page.waitForFunction(verticalLoginReady)
        await page.getByLabel('School Email').fill(actor.email)
        await page.getByLabel(/^Password(?:\s*\*)?$/).fill(binding.password)
        const ack = page.waitForResponse(r => r.url() === plan.appOrigin + '/api/auth/login' && r.request().method() === 'POST')
        void ack.catch(() => {})
        await page.getByRole('button', { name: 'Login', exact: true }).click()
        assert.equal((await ack).status(), 200)
        await page.waitForURL(url => url.origin === plan.appOrigin && url.pathname === '/classrooms')
        const identity = await runtime.api<{ user: { id: string; role: string; email: string } }>(page, 'GET', '/api/auth/me')
        assert.equal(identity.user.id, actor.id); assert.equal(identity.user.role, actor.role); assert.equal(identity.user.email, actor.email)
        contextActors.set(context,actorLabel==='ownerTeacherPeer'?'ownerTeacher':actorLabel)
        actors.push(actorLabel); step = 'workflow'; await callback(page); check()
      } finally { await context.close(); contexts.delete(context) }
    },
    async snapshot(label, page) {
      step = 'screenshot'; owned(page)
      assert((expectedLabels as readonly string[]).includes(label))
      if (successor || lifecycle || survey) assert.equal(label, expectedLabels[artifacts.length])
      assert(!artifacts.some(row => row.label === label))
      const scene = survey ? surveyScreens[artifacts.length] : lifecycle ? lifecycleScreens[artifacts.length] : undefined
      if(scene) {
        assert.equal(contextActors.get(page.context()),scene.actor)
        assert.deepEqual(page.viewportSize(),scene.viewport==='mobile'?{width:390,height:844}:{width:1440,height:900})
        assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),scene.theme==='dark')
      }
      const bytes = await page.screenshot(verticalScreenshotOptions(lifecycle || survey, timeout()))
      check(); assert(bytes.length > 0 && bytes.length <= 4194304)
      writeFileSync(join(output, `${label}.png`), bytes, { mode: 0o600, flag: 'wx' })
      artifacts.push({ label, kind: 'png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(scene?{actor:scene.actor,viewport:scene.viewport,theme:scene.theme}:{}) })
    },
  }
  return { runtime: runtime as VerticalTestRuntime & LifecycleRuntime & SurveyRuntime, async close(result: Awaited<ReturnType<typeof runContextualTestVerticalWorkflow | typeof runContextualTestGradeReturnWorkflow>> | LifecycleResult | SurveyWorkflowResult | null, error?: unknown) {
    const settled = await Promise.allSettled([...contexts].map(async context => { await context.close(); contexts.delete(context) }))
    const contextsClosed = contexts.size === 0 && settled.every(r => r.status === 'fulfilled')
    const outcome = result && !error && contextsClosed && pageErrors === 0 && Date.now() < binding.deadline ? 'passed' : 'failed'
    closed = true
    const receipt = { version: 1, proofScope: binding.proofScope, projectId: binding.projectId, nonce: binding.nonce,
      sourceSha: binding.sourceSha, sourceTree: binding.sourceTree, appOverlaySha256: binding.appOverlaySha256,
      deadline: binding.deadline, endedAt: Date.now(), outcome, contextsClosed, pageErrors, actors, result,
      failureStage: outcome === 'passed' ? null : (survey ? surveyFailureStage(error) : lifecycle ? lifecycleFailureStage(error) : verticalWorkflowFailureStage(error)) ?? step, artifacts }
    writeFileSync(join(binding.outputDir, 'playwright-receipt.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' })
    assert.equal(outcome, 'passed', 'Narrow Test workflow failed')
  } }
}
