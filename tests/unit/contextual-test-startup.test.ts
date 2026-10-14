import { describe, expect, it, vi } from 'vitest'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Script } from 'node:vm'
import * as startup from '../../e2e/helpers/contextual-test-startup'

function fixture() {
  const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-startup-cpu-'))); chmodSync(outputDir, 0o700)
  const now = Date.now()
  const binding = { version: 1, projectId: 'pika_assignment_list_123456abcdef', nonce: 'a'.repeat(20) + '123456abcdef',
    sourceSha: 'b'.repeat(40), startedAt: now - 1000, deadline: now + 2699000, cleanupDeadline: now + 3059000, outputDir }
  return { outputDir, binding, remove: () => rmSync(outputDir, { recursive: true }) }
}
describe('full-app startup private CPU reporting', () => {
  it.each(['fixture','global'])('captures %s errors before runtime output, without raw error retention', async kind => {
    const f = fixture(), binding = vi.spyOn(startup, 'contextualTestStartupBinding').mockReturnValue(f.binding as never)
    try {
      const { default: Reporter } = await import('../../e2e/helpers/contextual-test-startup-reporter')
      const reporter = new Reporter()
      const error = { message: 'browserType.launch: SECRET https://private.invalid?token=SECRET SIGTRAP', stdout: 'SECRET', stack: 'SECRET' }
      if (kind === 'fixture') {
        reporter.onBegin({}, { allTests: () => [{}] } as never); reporter.onTestBegin()
        reporter.onTestEnd({} as never, { status: 'failed', errors: [error] } as never)
      } else for (let i = 0; i < 20; i++) reporter.onError(error)
      reporter.onEnd({ status: 'failed' } as never)
      const report = startup.readFullStartupReport(f.binding as never)
      expect(report.report).toMatchObject({ status: 'failed', passed: 0, overflow: kind === 'global' })
      expect(report.report.errors).toHaveLength(kind === 'global' ? 8 : 1)
      expect(report.report.errors[0]).toEqual({ category: 'browser-launch', code: null, signal: 'SIGTRAP', source: 'fixture' })
      expect(report.reached).toEqual(kind === 'global' ? [] : ['collection','fixture'])
      expect(JSON.stringify(report)).not.toMatch(/SECRET|private\.invalid|stdout|stack/)
      expect(reporter.printsToStdio()).toBe(false)
      expect(() => startup.validateFullStartupReport({ ...report, nonce: '0'.repeat(32) }, f.binding as never)).toThrow()
      expect(() => startup.validateFullStartupReport({ ...report, report: { ...report.report, message: 'SECRET' } }, f.binding as never)).toThrow()
      const hostile = { ...report, reached: Object.assign([], { toJSON: () => 'SECRET' }) }
      expect(() => startup.validateFullStartupReport(hostile, f.binding as never)).toThrow()
      // A receipt-only read after expiry does not renew or re-read admission.
      vi.spyOn(Date, 'now').mockReturnValue(f.binding.cleanupDeadline + 1)
      expect(startup.readFullStartupReport(f.binding as never)).toEqual(report)
    } finally { binding.mockRestore(); vi.restoreAllMocks(); f.remove() }
  })
  it('writes failure receipts after the original work deadline only until cleanup expiry', () => {
    const f = fixture()
    try {
      vi.spyOn(Date, 'now').mockReturnValue(f.binding.deadline + 1)
      const report = startup.createContextualTestStartup(f.binding as never); report.stage('binding'); report.failure({ name: 'TimeoutError' })
      expect(JSON.parse(readFileSync(join(f.outputDir, 'startup-failure.json'), 'utf8')).error.category).toBe('timeout')
      expect(f.binding.deadline).toBeLessThan(Date.now())
    } finally { vi.restoreAllMocks(); f.remove() }
  })
  it('classifies original hostile failures and retains only fixed schema and bound identity', () => {
    const f = fixture()
    try {
      const report = startup.createContextualTestStartup(f.binding as never)
      report.stage('runtime-entry'); report.stage('binding')
      const hostile = { message: 'browserType.launch: SECRET https://private.invalid/token EACCES SIGTRAP', stack: 'SECRET', stdout: 'SECRET', stderr: 'SECRET' }
      report.failure(hostile); report.failure(new Error('replacement'))
      const raw = readFileSync(join(f.outputDir, 'startup-failure.json'), 'utf8'), record = JSON.parse(raw)
      expect(record).toEqual({ version: 1, projectId: f.binding.projectId, nonce: f.binding.nonce, sourceSha: f.binding.sourceSha,
        deadline: f.binding.deadline, stage: 'binding', error: { category: 'permission', code: 'EACCES', signal: 'SIGTRAP', source: 'fixture' } })
      expect(raw).not.toMatch(/SECRET|private\.invalid|stack|stdout|stderr|outputDir/)
      expect(lstatSync(join(f.outputDir, 'startup-failure.json')).mode & 0o777).toBe(0o600)
      expect(() => startup.validateContextualTestStartupRecord({ ...record, message: 'SECRET' })).toThrow()
      expect(() => startup.validateContextualTestStartupRecord({ ...record, stage: 'SECRET' })).toThrow()
      expect(() => startup.validateContextualTestStartupRecord({ ...record, error: { ...record.error, code: 'SECRET' } })).toThrow()
    } finally { f.remove() }
  })
  it('never evaluates hostile getters and reports unknown honestly', () => {
    const f = fixture(), getter = vi.fn(() => { throw Error('SECRET') })
    try {
      const report = startup.createContextualTestStartup(f.binding as never); report.stage('spec-entry')
      report.failure(Object.defineProperty({}, 'message', { get: getter }))
      expect(getter).not.toHaveBeenCalled()
      expect(JSON.parse(readFileSync(join(f.outputDir, 'startup-failure.json'), 'utf8')).error.category).toBe('unknown')
    } finally { f.remove() }
  })
  it('rejects collisions, symlinks, nonprivate parents and expired clocks without adopting artifacts', () => {
    const f = fixture()
    try {
      const target = join(f.outputDir, 'startup-output.json'); writeFileSync(target, 'unchanged', { mode: 0o600 })
      const report = startup.createContextualTestStartup(f.binding as never)
      expect(() => report.stage('output')).toThrow('Private contextual Test startup reporting failed')
      expect(readFileSync(target, 'utf8')).toBe('unchanged')
      symlinkSync(target, join(f.outputDir, 'startup-plan.json'))
      expect(() => startup.createContextualTestStartup(f.binding as never).stage('plan')).toThrow()
      chmodSync(f.outputDir, 0o755)
      expect(() => startup.createContextualTestStartup(f.binding as never).stage('binding')).toThrow()
      chmodSync(f.outputDir, 0o700)
      vi.spyOn(Date, 'now').mockReturnValue(f.binding.cleanupDeadline)
      expect(() => startup.createContextualTestStartup(f.binding as never).stage('binding')).toThrow()
    } finally { vi.restoreAllMocks(); f.remove() }
  })
  it('ordinary actual-PW collection reads no binding and invokes no fixtures; invalid opt-in cannot declare', () => {
    const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { babelTransform } = require(join(dirname(pw.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'))
    const file = resolve(import.meta.dirname, '../../e2e/contextual-test-lifecycle.spec.ts')
    const compiled = babelTransform(readFileSync(file, 'utf8'), file, false, [], []).code
    const collect = (optIn?: string, invalid = false) => {
      const calls: string[] = [], test = Object.assign(() => calls.push('declare'), { skip: (skip: boolean) => calls.push(skip ? 'skip' : 'admitted') })
      const context = { exports: {}, process: { env: { PIKA_CONTEXTUAL_TEST_REHEARSAL: optIn } }, require: (specifier: string) => {
        if (specifier === '@playwright/test') return { test }
        if (specifier.endsWith('contextual-test-workflow')) return { runContextualTestWorkflow() { throw Error('Workflow executed') } }
        expect(specifier).toBe('./helpers/contextual-test-startup')
        return { contextualTestStartupBinding() { calls.push('read'); if (invalid) throw Error('Invalid binding'); return {} } }
      } }
      return { calls, run: () => new Script(compiled).runInNewContext(context) }
    }
    for (const flag of [undefined, 'false']) { const f = collect(flag); f.run(); expect(f.calls).toEqual(['skip','declare']) }
    const invalid = collect('true', true); expect(invalid.run).toThrow('Invalid binding'); expect(invalid.calls).toEqual(['read'])
    const admitted = collect('true'); admitted.run(); expect(admitted.calls).toEqual(['read','admitted','declare'])
  })
  it('actual compiled spec closes owned runtime when teardown reporting fails, preserving original workflow classification', async () => {
    const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { babelTransform } = require(join(dirname(pw.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'))
    const file = resolve(import.meta.dirname, '../../e2e/contextual-test-lifecycle.spec.ts')
    const compiled = babelTransform(readFileSync(file, 'utf8'), file, false, [], []).code
    let body!: (...args: unknown[]) => Promise<void>
    const original = Error('SECRET original workflow'), close = vi.fn(async () => {}), failure = vi.fn(), stages: string[] = []
    const test = Object.assign((_title: string, callback: typeof body) => { body = callback }, { skip() {}, setTimeout() {} })
    const runtime = { createContextualTestRuntime: async () => ({ runtime: {}, close }) }
    // Replacing only the compiled dynamic-import expression with a CPU double
    // avoids invoking the actual runtime/native graph; all surrounding spec code runs.
    const injected = compiled.replace(/import\(['"]\.\/helpers\/contextual-test-runtime['"]\)/, 'Promise.resolve(cpuRuntime)')
    expect(injected).not.toBe(compiled); const cpu = new Script(injected)
    cpu.runInNewContext({ exports: {}, Promise, cpuRuntime: runtime, process: { env: { PIKA_CONTEXTUAL_TEST_REHEARSAL: 'true' } }, require: (specifier: string) => {
      if (specifier === '@playwright/test') return { test }
      if (specifier.endsWith('contextual-test-workflow')) return { runContextualTestWorkflow: async () => { throw original } }
      return { contextualTestStartupBinding: () => ({}), createContextualTestStartup: () => ({
        stage(value: string) { stages.push(value); if (value === 'teardown') throw Error('SECRET writer') }, failure,
      }) }
    } })
    await expect(body({ browser: {} }, {})).rejects.toThrow('Isolated contextual Tests rehearsal failed')
    expect(stages).toContain('runtime-import'); expect(close).toHaveBeenCalledExactlyOnceWith('failed')
    expect(failure.mock.calls[0][0]).toBe(original)
  })
})
