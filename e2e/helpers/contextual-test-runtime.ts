/** Native Playwright fixtures for the separately admitted disposable rehearsal.
 * No fixture, browser, SQL or environment inspection occurs at test collection.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Browser, BrowserContext, Page, Request, Response, TestInfo } from '@playwright/test'
import { readContextualTestBinding, executeContextualTestSql } from '../../scripts/contextual-test-rehearsal-binding'
import { ContextualTestBoundary } from './contextual-test-boundary'
import { installLoginFetchGate } from './contextual-login-fetch-gate'
import { createContextualTestPlan, type ContextualTestRuntime, type RehearsalWitness } from './contextual-test-rehearsal'
import type { ContextualTestStartupStage } from './contextual-test-startup'
import { contextualTestFontShot, contextualTestFontEditingText } from './contextual-test-font-matrix'

const witnessSchema = z.object({
  version: z.literal(1), work_graph_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tests: z.array(z.object({ id: z.string().uuid(), classroom_id: z.string().uuid(), status: z.string(), position: z.number().int(), retired: z.boolean() }).strict()).max(8),
  attempts: z.array(z.object({ id: z.string().uuid(), test_id: z.string().uuid(), student_id: z.string().uuid(), draft_revision: z.number().int(), is_submitted: z.boolean(), returned_at: z.string().nullable() }).strict()),
  memberships: z.array(z.object({ classroom_id: z.string().uuid(), student_id: z.string().uuid(), generation_id: z.string().uuid(), ledger_state: z.string() }).strict()),
  generations: z.array(z.object({ generation_id: z.string().uuid(), state: z.string() }).strict()),
  question_counts: z.array(z.object({ test_id: z.string().uuid(), count: z.number().int().min(0).max(2) }).strict()),
  classes: z.array(z.object({ id: z.string().uuid(), archived_at: z.string().nullable(), updated_at: z.string() }).strict()).length(2),
  response_count: z.number().int().min(0), history_count: z.number().int().min(0),
  objects: z.array(z.object({ id: z.string().uuid(), resource_id: z.string().uuid(), purpose: z.string(), status: z.string(), byte_size: z.number().int().min(0).max(32768).nullable(), content_sha256: z.string().nullable() }).strict()).max(2),
}).strict()
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const safeError = () => new Error('Private contextual Test rehearsal failed; inspect fixed-schema receipt')
const loginSteps = ['context', 'setup', 'page', 'navigate', 'preset', 'form-ready', 'email', 'password', 'submit', 'response-body', 'redirect', 'session', 'identity'] as const
type LoginStep = typeof loginSteps[number]
/** Diagnostic metadata only: fixed labels and ordinals, never action results or
 * errors. Retention overflow does not change login behavior or grant a retry. */
export function createContextualTestLoginProgress() {
  type Progress = { attempt: number; entered: LoginStep | null; completed: LoginStep | null }
  const entries: Progress[] = []
  let attempts = 0
  return {
    begin() {
      const row: Progress = { attempt: ++attempts, entered: null, completed: null }
      if (entries.length < 64) entries.push(row)
      let next = 0
      return {
        async step<T>(label: LoginStep, action: () => T | Promise<T>): Promise<T> {
          assert(next < loginSteps.length && loginSteps[next] === label && row.entered === row.completed, 'Private login marker order')
          row.entered = label; next++
          const result = await action()
          row.completed = label
          return result
        },
      }
    },
    snapshot() {
      return { attempts, overflow: attempts > 64, entries: entries.map(({ attempt, entered, completed }) => ({ attempt, entered, completed })) }
    },
  }
}
export function contextualTestArtifactLabel(value: string) {
  assert(/^[A-Za-z][A-Za-z0-9-]{0,99}$/.test(value), 'Private artifact label')
  return value
}

/** Serialized into the page: observe only the existing public preset's effect.
 * Its setter-only source contract and public defaults are guarded by CPU tests.
 */
export function contextualTestLoginReady(): boolean {
  const forms = document.querySelectorAll('form')
  if (forms.length !== 1) return false
  const email = forms[0].querySelector<HTMLInputElement>('input[type="email"]')
  const password = forms[0].querySelector<HTMLInputElement>('input[type="password"]')
  const submit = forms[0].querySelector<HTMLButtonElement>('button[type="submit"]')
  return email?.value === 'teacher@example.com' && password?.value === 'test1234'
    && submit?.textContent?.trim() === 'Login' && !submit.disabled
}

export async function createContextualTestRuntime(browser: Browser, _testInfo: TestInfo, stage: (stage: ContextualTestStartupStage) => void = () => {}) {
  stage('runtime-entry')
  stage('binding')
  assert.equal(process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL, 'true')
  const path = process.env.PIKA_CONTEXTUAL_TEST_BINDING_FILE, digest = process.env.PIKA_CONTEXTUAL_TEST_BINDING_SHA256
  assert(path && digest, 'Missing admitted private binding')
  const binding = readContextualTestBinding(path, digest)
  stage('plan')
  const plan = createContextualTestPlan(binding.projectId)
  stage('boundary')
  const boundary = new ContextualTestBoundary(plan, binding.deadline)
  const output = join(binding.outputDir, 'playwright')
  stage('output')
  mkdirSync(output, { mode: 0o700 }) // exclusive run ownership; never adopt old output
  const contexts = new Map<BrowserContext, { closing: boolean; closed: boolean; actor?: string }>()
  const artifacts: Array<{ label: string; kind: 'png' | 'aria'; bytes: number; sha256: string; fontReference?: string }> = []
  const witnesses: Array<{ label: string; sha256: string }> = []
  const loginProgress = createContextualTestLoginProgress()
  let screenshots = 0, fontShots = 0, pngBytes = 0, snapshots = 0, pageErrors = 0, consoleErrors = 0, closeStarted = false
  const requireOwned = (page: Page) => {
    const context = page.context(), state = contexts.get(context)
    assert(state && !state.closing && !state.closed, 'Private Page ownership'); return context
  }
  const fixedTimeout = () => { boundary.check(); return Math.min(plan.limits.operationMs, binding.deadline - Date.now()) }
  const depart = async (page: Page, action: (timeout: number) => Promise<unknown>) => {
    const context = requireOwned(page), end = Math.min(binding.deadline, Date.now() + plan.limits.operationMs)
    await boundary.settle(context, end)
    boundary.check(); assert(Date.now() < end, 'Private navigation deadline')
    await action(end - Date.now())
    await boundary.settle(context, end)
  }
  const requestBody = (request: Request) => {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) return undefined
    try { return request.postDataJSON() } catch { return request.postDataBuffer() ?? undefined }
  }
  const save = (label: string, kind: 'png' | 'aria', bytes: Buffer, fontReference?: string) => {
    boundary.check(); contextualTestArtifactLabel(label)
    assert(!label.includes(binding.password), 'Private artifact label')
    assert(!artifacts.some(row => row.label === label), 'Duplicate private artifact')
    if (kind === 'png') { assert(bytes.byteLength > 0 && bytes.byteLength <= 4194304 && pngBytes + bytes.byteLength <= 64 * 1024 * 1024); pngBytes += bytes.byteLength }
    writeFileSync(join(output, `${label}.${kind === 'png' ? 'png' : 'txt'}`), bytes, { mode: 0o600, flag: 'wx' })
    artifacts.push({ label, kind, bytes: bytes.byteLength, sha256: sha(bytes), ...(fontReference ? { fontReference } : {}) })
  }
  const runtime: ContextualTestRuntime = {
    plan, password: binding.password, deadline: binding.deadline, check: () => boundary.check(),
    async withActor(label, callback) {
      boundary.check(); assert(Object.hasOwn(plan.actors, label) || ['ownerTeacherPeer', 'ownerStudentPeer'].includes(label))
      const login = loginProgress.begin()
      const context = await login.step('context', () => browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false }))
      const state = { closing: false, closed: false }; contexts.set(context, state)
      let loginSubmitted = false, loginVerified = false, loginNavigationEnd = 0
      let loginGate: Awaited<ReturnType<typeof installLoginFetchGate>> | undefined
      // Register closure before any fallible context setup. Failed route or
      // timeout setup must not strand an actor until the outer suite teardown.
      context.on('close', () => { state.closed = true })
      try {
        await login.step('setup', async () => {
          context.setDefaultTimeout(fixedTimeout()); context.setDefaultNavigationTimeout(fixedTimeout())
          loginGate = await installLoginFetchGate(context, plan.appOrigin, () => {
            boundary.check(); assert(!state.closing && loginSubmitted && Date.now() < loginNavigationEnd, 'Private login deadline')
          })
          context.on('request', request => boundary.requestStarted(context, request))
          context.on('requestfinished', request => boundary.requestFinished(context, request))
          context.on('requestfailed', request => boundary.requestFinished(context, request, true))
          context.on('response', response => { void boundary.observe(context, response, response.request()) })
          context.on('page', page => {
            page.on('pageerror', () => { pageErrors++ })
            page.on('console', message => { if (message.type() === 'error') consoleErrors++ })
          })
          await context.route('**/*', async route => {
            if (state.closing) { await route.abort('aborted').catch(() => {}); return }
            try {
              const request = route.request(); boundary.admit(request.url(), request.method(), requestBody(request), request.resourceType())
              if (loginSubmitted && !loginVerified && request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) {
                // The fetch gate prevents navigation from starting before the
                // original bytes are verified. Any premature navigation fails
                // closed immediately instead of pausing the browser protocol.
                boundary.violate('endpoint')
              }
              // Fail closed if a request began between the departure drain and
              // dispatch. Never pause a navigation route waiting for its loader.
              if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) boundary.canNavigate(context, request)
              await route.continue()
            }
            catch { try { boundary.violate('endpoint') } catch { /* retain fixed first failure */ }
              await route.abort('blockedbyclient').catch(() => {}) }
          })
          await context.routeWebSocket('**/*', socket => {
            try { const u = new URL(socket.url()); if (u.origin !== 'ws://localhost:3117' || u.pathname !== '/_next/webpack-hmr') boundary.violate('endpoint') }
            catch { /* boundary retains the fixed failure, not the socket URL */ }
            finally { socket.close({ code: 1008, reason: 'Private rehearsal blocks WebSockets' }) }
          })
          assert.equal(context.serviceWorkers().length, 0)
        })
        const page = await login.step('page', () => context.newPage())
        const actorLabel = label === 'ownerTeacherPeer' ? 'ownerTeacher' : label === 'ownerStudentPeer' ? 'ownerStudent' : label
        const actor = plan.actors[actorLabel]
        // One original operation end covers readiness, real login and identity.
        // Load alone is not hydration proof. Activate the existing public field
        // preset exactly once, observe its React-owned transition, then replace
        // both public defaults before the only authentication submission.
        const loginEnd = Math.min(binding.deadline, Date.now() + plan.limits.operationMs)
        loginNavigationEnd = loginEnd
        const loginTimeout = () => { boundary.check(); const remaining = loginEnd - Date.now(); assert(remaining > 0, 'Private login deadline'); return remaining }
        let loginTimer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([(async () => {
            await login.step('navigate', () => page.goto(plan.appOrigin + '/login', { timeout: loginTimeout(), waitUntil: 'load' }))
            await login.step('preset', () => page.getByRole('button', { name: 'Teacher', exact: true }).click({ timeout: loginTimeout() }))
            await login.step('form-ready', () => page.waitForFunction(contextualTestLoginReady, undefined, { timeout: loginTimeout() }))
            await login.step('email', () => page.getByLabel('School Email').fill(actor.email, { timeout: loginTimeout() }))
            await login.step('password', () => page.getByLabel(/^Password(?:\s*\*)?$/).fill(binding.password, { timeout: loginTimeout() }))
            const original = await login.step('submit', async () => {
              loginSubmitted = true
              const loginResponse = page.waitForResponse(response => response.url() === plan.appOrigin + '/api/auth/login' && response.request().method() === 'POST', { timeout: loginTimeout() })
              // A synchronous deadline/setup failure before Promise.all must not
              // leave the already-created waiter rejection unobserved.
              void loginResponse.catch(() => {})
              // A normal click may wait for the very navigation whose release
              // depends on body verification. We explicitly await it below.
              const [, response] = await Promise.all([page.getByRole('button', { name: 'Login', exact: true }).click({ timeout: loginTimeout(), noWaitAfter: true }), loginResponse])
              return response
            })
            await login.step('response-body', async () => {
              loginTimeout(); await runtime.response(page, original); loginTimeout()
              assert.equal(original.status(), 200, 'Private login rejected')
              loginVerified = true; loginGate!.release(true)
            })
            await login.step('redirect', () => page.waitForURL(url => url.origin === plan.appOrigin && url.pathname === '/classrooms', { timeout: loginTimeout() }))
            const current = await login.step('session', async () => {
              loginTimeout()
              return runtime.api<{ user: { id: string; role: string; email: string } }>(page, 'GET', '/api/auth/me')
            })
            await login.step('identity', () => {
              loginTimeout()
              assert.equal(current.user.id, actor.id, 'Private session actor')
              assert.equal(current.user.role, actor.role, 'Private session role')
              assert.equal(current.user.email, actor.email, 'Private session email')
            })
          })(), new Promise<never>((_resolve, reject) => { loginTimer = setTimeout(() => reject(safeError()), loginTimeout()) })])
        } finally { if (loginTimer) clearTimeout(loginTimer) }
        contexts.get(context)!.actor = actorLabel
        await callback(page); await boundary.settle(context)
      }
      finally {
        state.closing = true
        loginGate?.release(false)
        await boundary.beforeContextClose(context, () => context.close())
        // A late original body failure during close still invalidates this run.
        boundary.check(); assert(state.closed); assert.equal(boundary.pending(context), 0)
        contexts.delete(context)
      }
    },
    async api<T>(page: Page, method: string, path: string, body?: unknown, expectedStatus = 200): Promise<T> {
      const context = requireOwned(page); boundary.check()
      assert(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'Private relative API path')
      const target = new URL(path, plan.appOrigin); assert.equal(target.origin, plan.appOrigin)
      boundary.admit(target.href, method, body, 'api')
      const request = { method: () => method, postDataJSON: () => body }
      boundary.requestStarted(context, request)
      let response: Awaited<ReturnType<typeof context.request.fetch>>
      try { response = await context.request.fetch(target.href, { method, data: body, timeout: fixedTimeout(), maxRedirects: 0 }) }
      catch (error) { boundary.requestFinished(context, request, true); throw error }
      try {
        const original = boundary.observe(context, response, request, 'api')
        boundary.requestFinished(context, request)
        // Bound the consumer before awaiting its cached value. The original
        // body task remains registered if it hangs; no timeout grants success.
        await boundary.settle(context); const value = await original
        assert.equal(response.status(), expectedStatus, 'Private expected API status')
        assert(/json/i.test(response.headers()['content-type'] ?? ''), 'Private expected JSON')
        return value as T
      } finally { await response.dispose() }
    },
    async response<T>(page: Page, response: Response): Promise<T> {
      const context = requireOwned(page)
      assert.equal(response.frame().page().context(), context, 'Private response ownership')
      const original = boundary.observe(context, response, response.request())
      await boundary.settle(context); const value = await original
      assert(/json/i.test(response.headers()['content-type'] ?? ''), 'Private expected JSON')
      return value as T
    },
    settle: page => boundary.settle(requireOwned(page)),
    async navigate(page, url, waitUntil = 'domcontentloaded') {
      const target = new URL(url)
      assert.equal(target.origin, plan.appOrigin, 'Private navigation origin')
      assert(!target.username && !target.password, 'Private navigation credentials')
      await depart(page, timeout => page.goto(target.href, { waitUntil, timeout }))
    },
    reload: page => depart(page, timeout => page.reload({ waitUntil: 'domcontentloaded', timeout })),
    async witness(label) {
      boundary.check(); contextualTestArtifactLabel(label)
      const raw = await executeContextualTestSql(binding, 'witness')
      boundary.check(); assert(Buffer.byteLength(raw) <= plan.limits.responseBytes)
      const parsed = witnessSchema.parse(JSON.parse(raw)) as RehearsalWitness
      assert(parsed.tests.every(test => Object.values(plan.classrooms).some(c => c.id === test.classroom_id)))
      assert(parsed.memberships.every(row => Object.values(plan.actors).some(a => a.id === row.student_id)))
      witnesses.push({ label, sha256: sha(raw) }); return parsed
    },
    async mutate(cell) {
      boundary.check(); assert(Object.hasOwn(plan.mutations, cell))
      await executeContextualTestSql(binding, cell); boundary.check()
    },
    async snapshot(label, page) {
      requireOwned(page); boundary.check(); assert(new URL(page.url()).pathname !== '/login')
      assert(snapshots < 64); snapshots++
      const raw = await page.locator('body').ariaSnapshot({ timeout: fixedTimeout() })
      const clean = raw.split(binding.password).join('[private]').replace(/https?:\/\/[^\s)"<>]+/g, value => {
        try { const url = new URL(value); return url.origin + url.pathname } catch { return '[url]' }
      }).split('\n').filter(line => !/password|cookie|secret|token/i.test(line)).join('\n')
      const bytes = Buffer.from(clean); assert(bytes.byteLength <= 262144); save(label, 'aria', bytes)
    },
    async capture(label, page) {
      requireOwned(page); boundary.check(); assert(new URL(page.url()).pathname !== '/login')
      assert(/^(ownerTeacher|ownerStudent|memberTeacher|memberStudent)-(desktop|mobile)-(light|dark)$/.test(label))
      assert(screenshots < 16); screenshots++
      const bytes = await page.screenshot({ type: 'png', fullPage: false, timeout: fixedTimeout() })
      assert(bytes.byteLength <= 4194304); save(label, 'png', bytes)
    },
    async captureFont(label, page) {
      const context = requireOwned(page), shot = contextualTestFontShot(label)
      boundary.check(); assert.equal(contexts.get(context)!.actor, shot.actor)
      const url = new URL(page.url())
      assert.equal(url.origin, plan.appOrigin); assert.equal(url.pathname, '/pattern-lab')
      assert.equal(url.search, `?role=${shot.referenceRole}`)
      assert.equal(url.hash, shot.state === 'editing' || shot.state === 'empty' ? '#student-image-upload' : '#history-preview')
      assert.deepEqual(page.viewportSize(), shot.view === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
      assert(fontShots < 32)
      const gallery = page.locator(shot.selector)
      await gallery.waitFor({ state: 'visible', timeout: fixedTimeout() })
      assert.equal(await gallery.count(), 1)
      await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout: fixedTimeout() })
      const observed = await gallery.evaluate(element => {
        // Preserve real sticky chrome and editor scrolling. Locator screenshots
        // may scroll a tall gallery back under the mobile navigation; capture a
        // viewport-bounded clip instead, after ordinary document scrolling.
        const navs = document.querySelectorAll('nav[aria-label="Pattern Lab sections"]')
        if (navs.length !== 1) throw new Error('Private font capture navigation')
        const nav = navs[0], style = getComputedStyle(nav)
        if (style.position !== 'sticky') throw new Error('Private font capture navigation')
        const inset = Number.parseFloat(style.top), height = nav.getBoundingClientRect().height
        if (!Number.isFinite(inset) || height <= 0) throw new Error('Private font capture navigation')
        const original = element.getBoundingClientRect()
        window.scrollTo({ top: window.scrollY + original.top - (inset + height + 8), behavior: 'instant' })
        const editor = element.querySelector('.tiptap.ProseMirror')
        const box = element.getBoundingClientRect(), heading = element.querySelector('h2')
        const clip = { x: Math.ceil(box.left), y: Math.ceil(box.top),
          width: Math.floor(box.right) - Math.ceil(box.left),
          height: Math.floor(Math.min(box.bottom, window.innerHeight)) - Math.ceil(box.top) }
        const inside = (node: Element) => {
          const rect = node.getBoundingClientRect()
          return rect.height > 0 && rect.top >= clip.y && rect.bottom <= clip.y + clip.height
            && rect.left >= clip.x && rect.right <= clip.x + clip.width
        }
        // History fixtures intentionally contain 40 scrollable paragraphs. Their
        // first two blocks prove representative heading/body typography; editing
        // and empty fixtures have one paragraph, which must fit in full.
        const blocks = editor ? Array.from(editor.querySelectorAll(':scope > *')).slice(0, 2) : []
        return { dark: document.documentElement.classList.contains('dark'), ready: document.fonts.status === 'loaded',
          clip, positioned: box.top >= nav.getBoundingClientRect().bottom + 1 && clip.x >= 0 && box.right <= window.innerWidth && clip.y >= 0
            && clip.width > 0 && clip.height > 0 && !!heading && inside(heading) && blocks.length > 0 && blocks.every(inside),
          fits: element.scrollWidth <= element.clientWidth + 1 && box.width <= window.innerWidth + 1
            && !!editor && editor.scrollWidth <= editor.clientWidth + 1,
          editable: editor?.getAttribute('contenteditable'), text: editor?.textContent?.trim(),
          preview: !!element.querySelector('[data-history-preview-mode="focused"], [data-history-preview-mode="locked"]') }
      })
      assert.equal(observed.dark, shot.theme === 'dark'); assert(observed.ready && observed.fits && observed.positioned)
      assert.equal(observed.editable, shot.state === 'editing' || shot.state === 'empty' ? 'true' : 'false')
      assert.equal(observed.preview, shot.state === 'preview')
      if (shot.state === 'editing') assert.equal(observed.text, contextualTestFontEditingText)
      if (shot.state === 'empty') assert.equal(observed.text, '')
      const bytes = await page.screenshot({ type: 'png', fullPage: false, clip: observed.clip, timeout: fixedTimeout() })
      save(label, 'png', bytes, shot.fontReference); fontShots++
    },
  }
  stage('runtime-ready')
  return { runtime, async close(outcome: 'passed' | 'failed' = 'failed') {
    assert(!closeStarted); closeStarted = true
    let closed = true
    for (const [context, state] of contexts) {
      state.closing = true
      try { await boundary.beforeContextClose(context, () => context.close()) } catch {
        // A latched body failure still fails the outcome below. Do not rewrite
        // positive context-close evidence as an ownership/closure failure.
      }
      if (!state.closed) closed = false
    }
    const boundaryReceipt = boundary.receipt()
    const complete = outcome === 'passed' && closed && boundaryReceipt.firstFailure === null && boundaryReceipt.pending === 0
      && screenshots === 16 && fontShots === 32 && pageErrors === 0 && Date.now() < binding.deadline
    writeFileSync(join(binding.outputDir, 'playwright-receipt.json'), JSON.stringify({ version: 1, projectId: plan.projectId,
      sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256, outcome: complete ? 'passed' : 'failed',
      contextsClosed: closed, ...boundaryReceipt, pageErrors, consoleErrors, artifacts, witnesses, login: loginProgress.snapshot(),
      endedAt: Date.now(), deadline: binding.deadline }), { mode: 0o600, flag: 'wx' })
    if (!complete) throw safeError()
  } }
}
