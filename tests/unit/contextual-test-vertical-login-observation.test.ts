import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser } from '@playwright/test'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import { contextualSurveyFixture } from '../helpers/contextual-survey-fixture'
import { validateContextualSurveyReceipt } from '../../scripts/contextual-survey-workflow-proof'

const startup = vi.hoisted(() => ({ binding: {} as Record<string, unknown> }))
vi.mock('../../e2e/helpers/contextual-test-startup', () => ({ contextualTestStartupBinding: () => startup.binding }))
import { createContextualTestVerticalRuntime } from '../../e2e/helpers/contextual-test-vertical-runtime'

const directories: string[] = []
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const phases = ['context', 'page', 'login-document', 'hydration-preset', 'hydration-ready', 'email', 'password',
  'login-click', 'login-ack', 'redirect', 'identity-request', 'identity-check'] as const

async function setup(failAt?: typeof phases[number], diagnostic = false) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000)
  const outputDir = mkdtempSync(join(tmpdir(), 'pika-login-observation-cpu-')); directories.push(outputDir)
  const plan = createContextualTestPlan('pika_assignment_list_123456abcdef', 'survey-workflow-v1')
  startup.binding = { version: 1, proofScope: plan.proofScope, projectId: plan.projectId, outputDir,
    sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256,
    nonce: '0'.repeat(20) + '123456abcdef', startedAt: Date.now(), deadline: Date.now() + 2_700_000,
    password: 'PRIVATE-CREDENTIAL-DO-NOT-RECORD', ...(diagnostic ? { diagnostic: 'login-only' } : {}) }
  const calls: string[] = []
  const at = (phase: typeof phases[number]) => {
    calls.push(phase); vi.setSystemTime(Date.now() + 1)
    if (phase === failAt && phase !== 'identity-check') throw Error('PRIVATE-ERROR-DO-NOT-RECORD')
  }
  const loginBody = vi.fn(async () => { throw Error('Login response body must not be read') })
  const ack = { url: () => plan.appOrigin + '/api/auth/login', request: () => ({ method: () => 'POST' }), status: () => 200, body: loginBody }
  const page = {
    goto: async () => { at('login-document') },
    getByRole: (_role: string, options: { name: string }) => ({ click: async () => { at(options.name === 'Teacher' ? 'hydration-preset' : 'login-click') } }),
    waitForFunction: async () => { at('hydration-ready') },
    getByLabel: (label: string | RegExp) => ({ fill: async () => { at(label === 'School Email' ? 'email' : 'password') } }),
    waitForResponse: (predicate: (response: typeof ack) => boolean) => {
      expect(predicate(ack)).toBe(true)
      // The observer is registered before click; rejection occurs when awaited.
      return { then(resolve: (response: typeof ack) => unknown, reject: (error: unknown) => unknown) {
        try { at('login-ack'); return Promise.resolve(resolve(ack)) } catch (error) { return Promise.resolve(reject(error)) }
      }, catch: () => {} }
    },
    waitForURL: async (predicate: (url: URL) => boolean) => { at('redirect'); expect(predicate(new URL(plan.appOrigin + '/classrooms'))).toBe(true) },
    context: () => context,
  }
  const context = {
    on: () => {}, setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
    newPage: async () => { at('page'); return page }, close: vi.fn(async () => {}),
    request: { fetch: async (_url: string, options: { maxRedirects: number; maxRetries: number; timeout: number }) => {
      at('identity-request'); expect(options).toMatchObject({ maxRedirects: 0, maxRetries: 0 }); expect(options.timeout).toBe(30_000)
      return { status: () => 200, body: async () => {
        at('identity-check')
        return Buffer.from(JSON.stringify({ user: failAt === 'identity-check' ? { ...plan.actors.ownerTeacher, id: 'foreign' } : plan.actors.ownerTeacher }))
      }, dispose: vi.fn(async () => {}) }
    } },
  }
  const browser = { newContext: async () => { at('context'); return context } }
  const runtime = await createContextualTestVerticalRuntime(browser as unknown as Browser)
  return { ...runtime, outputDir, calls, context, loginBody,
    receipt: () => JSON.parse(readFileSync(join(outputDir, 'playwright-receipt.json'), 'utf8')) }
}

describe('actual vertical login observation through CPU browser doubles (not native proof)', () => {
  it('diagnostic performs exactly one real login path and writes only its exclusive private receipt', async () => {
    const s = await setup(undefined, true)
    await s.runtime.withActor('ownerTeacher', async () => {})
    await s.closeLoginDiagnostic()
    expect(s.calls).toEqual(phases)
    expect(s.loginBody).not.toHaveBeenCalled()
    expect(s.context.close).toHaveBeenCalledOnce()
    expect(existsSync(join(s.outputDir, 'playwright-receipt.json'))).toBe(false)
    expect(JSON.parse(readFileSync(join(s.outputDir, 'login-only-receipt.json'), 'utf8'))).toMatchObject({
      kind: 'pika-login-only-v1', outcome: 'diagnostic-passed', actors: ['ownerTeacher'], contextsClosed: true, pageErrors: 0,
      loginDiagnostic: { phase: 'verified', actorIndex: 0, verified: true, failureObservedAt: null },
    })
    await expect(s.closeLoginDiagnostic()).rejects.toThrow()
  })
  it('a forbidden extra actor latches diagnostic failure even if caught', async () => {
    const s = await setup(undefined, true)
    await s.runtime.withActor('ownerTeacher', async () => {})
    await expect(s.runtime.withActor('ownerStudent', async () => {})).rejects.toThrow()
    await expect(s.closeLoginDiagnostic()).rejects.toThrow()
    expect(s.calls).toEqual(phases)
  })
  it('a context closure failure cannot be laundered by later successful closure', async () => {
    const s = await setup(undefined, true)
    s.context.close.mockRejectedValueOnce(Error('private'))
    await expect(s.runtime.withActor('ownerTeacher', async () => {})).rejects.toThrow()
    await expect(s.closeLoginDiagnostic()).rejects.toThrow()
  })
  it.each(['identity-check', 'deadline', 'closure'] as const)('diagnostic fails on %s', async issue => {
    const s = await setup(issue === 'identity-check' ? issue : undefined, true)
    let failure: unknown
    if (issue === 'closure') s.context.close.mockRejectedValue(Error('private'))
    try { await s.runtime.withActor('ownerTeacher', async () => {}) } catch (error) { failure = error }
    if (issue === 'deadline') vi.setSystemTime(Number(startup.binding.deadline))
    await expect(s.closeLoginDiagnostic(failure)).rejects.toThrow()
    const receipt = JSON.parse(readFileSync(join(s.outputDir, 'login-only-receipt.json'), 'utf8'))
    expect(receipt.outcome).toBe('failed')
    expect(existsSync(join(s.outputDir, 'playwright-receipt.json'))).toBe(false)
  })
  it.each(phases)('retains the exact failed %s phase without credentials, identifiers or error text', async phase => {
    const s = await setup(phase)
    await expect(s.runtime.withActor('ownerTeacher', async () => { throw Error('Callback must not run') })).rejects.toThrow()
    await expect(s.close(null, Error('PRIVATE-ERROR-DO-NOT-RECORD'))).rejects.toThrow('Narrow Test workflow failed')
    expect(s.receipt()).toMatchObject({ outcome: 'failed', actors: [], contextsClosed: true,
      loginDiagnostic: { phase: phase === 'identity-check' ? 'identity-check' : phase, actorIndex: 0, verified: false } })
    expect(s.receipt().loginDiagnostic.observedAt).toBeGreaterThanOrEqual(1_000_000)
    expect(s.receipt().loginDiagnostic.failureObservedAt).toBe(phase === 'context' ? null : Date.now())
    expect(JSON.stringify(s.receipt())).not.toMatch(/PRIVATE|teacher@example/)
    expect(s.loginBody).not.toHaveBeenCalled()
    if (phase !== 'context') expect(s.context.close).toHaveBeenCalledOnce()
  })
  it('distinguishes a verified login followed by workflow failure, without changing login/body/navigation order', async () => {
    const s = await setup()
    await expect(s.runtime.withActor('ownerTeacher', async () => { throw Error('PRIVATE-WORKFLOW-ERROR') })).rejects.toThrow()
    await expect(s.close(null, Error('PRIVATE-WORKFLOW-ERROR'))).rejects.toThrow()
    expect(s.receipt()).toMatchObject({ outcome: 'failed', actors: ['ownerTeacher'], loginDiagnostic: { phase: 'verified', actorIndex: 0, verified: true } })
    expect(s.calls).toEqual(phases)
    expect(s.loginBody).not.toHaveBeenCalled()
    expect(JSON.stringify(s.receipt())).not.toContain('PRIVATE')
  })
  it('leaves success-shaped receipt keys unchanged and cannot promote this incomplete CPU workflow to Survey proof', async () => {
    const s = await setup()
    await s.runtime.withActor('ownerTeacher', async () => {})
    const binding = startup.binding as unknown as ContextualTestRunBinding
    await s.close(contextualSurveyFixture(binding).result)
    const receipt = s.receipt()
    expect(receipt.outcome).toBe('passed')
    expect(receipt).not.toHaveProperty('loginDiagnostic')
    expect(() => validateContextualSurveyReceipt(receipt, binding)).toThrow('Survey receipt rejected')
    expect(s.loginBody).not.toHaveBeenCalled()
  })
})
