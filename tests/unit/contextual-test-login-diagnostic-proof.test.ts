import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { validateContextualTestLoginDiagnosticReceipt } from '../../scripts/contextual-test-login-diagnostic-proof'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'

const binding = { diagnostic: 'login-only', proofScope: 'survey-workflow-v1', projectId: 'synthetic', nonce: 'nonce',
  sourceSha: 'sha', sourceTree: 'tree', appOverlaySha256: 'overlay', startedAt: 1000, deadline: 2000 } as ContextualTestRunBinding
const receipt = () => ({ version: 1, kind: 'pika-login-only-v1', diagnostic: binding.diagnostic, proofScope: binding.proofScope,
  projectId: binding.projectId, nonce: binding.nonce, sourceSha: binding.sourceSha, sourceTree: binding.sourceTree,
  appOverlaySha256: binding.appOverlaySha256, deadline: binding.deadline, endedAt: 1500, outcome: 'diagnostic-passed',
  contextsClosed: true, pageErrors: 0, actors: ['ownerTeacher'],
  loginDiagnostic: { phase: 'verified', observedAt: 1400, actorIndex: 0, verified: true, failureObservedAt: null } })

describe('login-only strict receipt and actual spec dispatch (CPU only)', () => {
  it('accepts only its distinct complete observation and rejects identity, clock, scope and shape drift', () => {
    expect(() => validateContextualTestLoginDiagnosticReceipt(receipt(), binding)).not.toThrow()
    for (const change of [{ kind: 'survey' }, { outcome: 'passed' }, { projectId: 'other' }, { nonce: 'other' },
      { sourceSha: 'other' }, { sourceTree: 'other' }, { appOverlaySha256: 'other' }, { deadline: 2001 },
      { endedAt: 999 }, { endedAt: 2000 }, { endedAt: NaN }, { contextsClosed: false }, { pageErrors: 1 },
      { actors: [] }, { actors: ['ownerTeacher', 'ownerTeacher'] }, { actors: ['ownerStudent'] },
      { result: {} }, { diagnostic: undefined }, { proofScope: 'vertical-v1' },
      { loginDiagnostic: { ...receipt().loginDiagnostic, verified: false } },
      { loginDiagnostic: { ...receipt().loginDiagnostic, observedAt: 1501 } },
      { loginDiagnostic: { ...receipt().loginDiagnostic, failureObservedAt: 1400 } },
      { loginDiagnostic: { ...receipt().loginDiagnostic, actorIndex: 1 } }]) {
      expect(() => validateContextualTestLoginDiagnosticReceipt({ ...receipt(), ...change }, binding)).toThrow()
    }
    const getter = vi.fn(() => 'diagnostic-passed'), value = receipt()
    Object.defineProperty(value, 'outcome', { get: getter })
    expect(() => validateContextualTestLoginDiagnosticReceipt(value, binding)).toThrow(); expect(getter).not.toHaveBeenCalled()
    expect(() => validateContextualTestLoginDiagnosticReceipt(receipt(), { ...binding, diagnostic: undefined })).toThrow()
  })
  it.each(['login-only', undefined] as const)('actual spec dispatch preserves selected login or absent Survey path: %s', async diagnostic => {
    const source = readFileSync(new URL('../../e2e/contextual-test-vertical.spec.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    let body!: (fixtures: unknown) => Promise<void>
    const login = vi.fn(async (_actor: string, callback: () => Promise<void>) => { await callback() })
    const closeLoginDiagnostic = vi.fn(async () => {}), close = vi.fn(async () => {})
    const survey = vi.fn(async () => ({ result: 'survey' })), imports: string[] = []
    const test = Object.assign((_name: string, fn: typeof body) => { body = fn }, { skip() {}, setTimeout() {} })
    runInNewContext(compiled, { exports: {}, process: { env: { PIKA_CONTEXTUAL_TEST_REHEARSAL: 'true', PIKA_CONTEXTUAL_TEST_VERTICAL: 'true' } },
      require(id: string) {
        imports.push(id)
        if (id === '@playwright/test') return { test }
        if (id.endsWith('/contextual-test-startup')) return { contextualTestStartupBinding: () => ({ ...binding, ...(diagnostic ? { diagnostic } : { diagnostic: undefined }) }),
          createContextualTestStartup: () => ({ stage() {}, failure() {} }) }
        if (id.endsWith('/contextual-test-vertical-runtime')) return { createContextualTestVerticalRuntime: async () => ({ runtime: { withActor: login }, closeLoginDiagnostic, close }) }
        if (id.endsWith('/contextual-survey-workflow')) return { runContextualSurveyWorkflow: survey }
        if (id.endsWith('-workflow')) return {}
        throw Error('Unexpected import')
      } })
    await body({ browser: {} })
    if (diagnostic) {
      expect(login).toHaveBeenCalledOnce(); expect(login.mock.calls[0][0]).toBe('ownerTeacher')
      expect(closeLoginDiagnostic).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled(); expect(survey).not.toHaveBeenCalled()
      expect(imports.some(id => id.endsWith('-workflow'))).toBe(false)
    } else { expect(survey).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(closeLoginDiagnostic).not.toHaveBeenCalled() }
  })
})
