/** Ordinary Playwright; network admission and body limits belong to the gateways. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page, Response } from '@playwright/test'
import { contextualTestStartupBinding } from './contextual-test-startup'
import { createContextualTestPlan } from './contextual-test-rehearsal'
import { verticalWorkflowFailureStage, type VerticalTestRuntime, type runContextualTestVerticalWorkflow } from './contextual-test-vertical-workflow'

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

export async function createContextualTestVerticalRuntime(browser: Browser) {
  const binding = contextualTestStartupBinding()
  assert.equal(binding.proofScope, 'vertical-v1'); assert(!binding.sqlControl)
  const plan = createContextualTestPlan(binding.projectId)
  const contexts = new Set<BrowserContext>(), artifacts: Array<{ label: string; kind: 'png'; bytes: number; sha256: string }> = []
  const actors: string[] = []
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
  const runtime: VerticalTestRuntime = {
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
      step = 'login'; check(); assert(['ownerStudent','memberTeacher','nonmember'].includes(actorLabel))
      assert(actors.length < 5)
      const actor = plan.actors[actorLabel]
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false })
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
        actors.push(actorLabel); step = 'workflow'; await callback(page); check()
      } finally { await context.close(); contexts.delete(context) }
    },
    async snapshot(label, page) {
      step = 'screenshot'; owned(page)
      assert(['vertical-owner-author','vertical-member-submitted','vertical-owner-results'].includes(label))
      assert(!artifacts.some(row => row.label === label))
      const bytes = await page.screenshot({ fullPage: false, timeout: timeout() })
      check(); assert(bytes.length > 0 && bytes.length <= 4194304)
      writeFileSync(join(output, `${label}.png`), bytes, { mode: 0o600, flag: 'wx' })
      artifacts.push({ label, kind: 'png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    },
  }
  return { runtime, async close(result: Awaited<ReturnType<typeof runContextualTestVerticalWorkflow>> | null, error?: unknown) {
    const settled = await Promise.allSettled([...contexts].map(async context => { await context.close(); contexts.delete(context) }))
    const contextsClosed = contexts.size === 0 && settled.every(r => r.status === 'fulfilled')
    const outcome = result && !error && contextsClosed && pageErrors === 0 && Date.now() < binding.deadline ? 'passed' : 'failed'
    closed = true
    const receipt = { version: 1, proofScope: 'vertical-v1', projectId: binding.projectId, nonce: binding.nonce,
      sourceSha: binding.sourceSha, sourceTree: binding.sourceTree, appOverlaySha256: binding.appOverlaySha256,
      deadline: binding.deadline, endedAt: Date.now(), outcome, contextsClosed, pageErrors, actors, result,
      failureStage: outcome === 'passed' ? null : verticalWorkflowFailureStage(error) ?? step, artifacts }
    writeFileSync(join(binding.outputDir, 'playwright-receipt.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' })
    assert.equal(outcome, 'passed', 'Narrow Test workflow failed')
  } }
}
