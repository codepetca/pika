import { describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Script } from 'node:vm'
import ts from 'typescript'
import * as data from '../../scripts/contextual-browser-diagnostic-data'
import { classifyDiagnosticError, diagnosticReportPassed, diagnosticSourceFiles, validateDiagnosticAdmission, validateDiagnosticReport } from '../../scripts/contextual-browser-diagnostic-data'

const root = resolve(import.meta.dirname, '../..')
describe('private browser diagnostic CPU contracts; no native calls', () => {
  it('redacts hostile messages, URLs, paths, env, source, names and stacks to fixed values', () => {
    const secret = 'SECRET-password-https://provider.invalid/?apikey=secret'
    const error = { name: secret, message: `browserType.launch: ${secret} signal=SIGTRAP code=EACCES`, stack: secret, stdout: secret, stderr: secret,
      location: { file: `/private/${secret}.ts`, line: 42 }, cause: { message: secret }, code: secret }
    expect(classifyDiagnosticError(error)).toEqual({ category: 'permission', code: 'EACCES', signal: 'SIGTRAP', source: 'fixture' })
    expect(JSON.stringify(classifyDiagnosticError(error))).not.toContain(secret)
    expect(classifyDiagnosticError({ message: secret })).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    expect(classifyDiagnosticError(Object.defineProperty({}, 'message', { get() { throw Error(secret) } }))).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
  })
  it.each([
    [{ message: 'browserType.launch: Library not loaded: PRIVATE' }, 'missing-library'],
    [{ message: "browserType.launch: Executable doesn't exist at PRIVATE" }, 'missing-executable'],
    [{ name: 'TimeoutError', message: 'PRIVATE' }, 'timeout'],
    [{ message: 'Target page, context or browser has been closed PRIVATE' }, 'browser-closed'],
    [{ message: 'browserType.launch: PRIVATE' }, 'browser-launch'],
  ])('maps a known safe category without retaining raw error (%j)', (error, category) => {
    const output = classifyDiagnosticError(error); expect(output.category).toBe(category); expect(JSON.stringify(output)).not.toContain('PRIVATE')
  })
  it.each(['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_REQUIRE_ESM','ERR_UNKNOWN_FILE_EXTENSION','ERR_UNSUPPORTED_DIR_IMPORT','ERR_ASSERTION'])('retains fixed Node code %s without module paths, assertion values or secrets', code => {
    const category = code === 'ERR_ASSERTION' ? 'assertion' : 'module-loading'
    for (const error of [{ code, message: 'SECRET /private/credential.ts' }, { message: `Error [${code}]: SECRET https://private.invalid` }]) {
      const result = classifyDiagnosticError(error)
      expect(result).toEqual({ category, code, signal: null, source: 'unknown' })
      expect(JSON.stringify(result)).not.toMatch(/SECRET|credential|private\.invalid/)
    }
  })
  it('classifies installed Playwright 1.58 serialized launch, cause and non-Error shapes without retaining private text', () => {
    const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { serializeError } = pw(join(dirname(pw.resolve('playwright/package.json')), 'lib/util.js'))
    expect(require('@playwright/test/package.json').version).toBe('1.58.0')
    const secret = 'SECRET https://private.invalid/?token=SECRET /private/credential'
    const cases = [
      [new Error(`Failed to launch the browser process.\nBrowser logs:\n${secret}`), { category: 'browser-launch', code: null, signal: null, source: 'fixture' }],
      [new Error(`Failed to launch chromium because executable doesn't exist at ${secret}`), { category: 'missing-executable', code: null, signal: null, source: 'fixture' }],
      [new Error(`Fixture setup failed: ${secret}`, { cause: new Error(`EACCES: ${secret}`) }), { category: 'permission', code: 'EACCES', signal: null, source: 'unknown' }],
      [`Failed to launch the browser process.\nBrowser logs:\n${secret}`, { category: 'browser-launch', code: null, signal: null, source: 'fixture' }],
      [new TypeError(secret), { category: 'type-error', code: null, signal: null, source: 'unknown' }],
      [new ReferenceError(secret), { category: 'reference-error', code: null, signal: null, source: 'unknown' }],
      [new SyntaxError(secret), { category: 'syntax-error', code: null, signal: null, source: 'unknown' }],
      [{ privateValue: secret }, { category: 'non-error-thrown', code: null, signal: null, source: 'unknown' }],
      [new Error('Private contextual Test binding rejected'), { category: 'binding-rejected', code: null, signal: null, source: 'unknown' }],
      [new Error('Private contextual Test startup reporting failed'), { category: 'startup-reporting-failed', code: null, signal: null, source: 'unknown' }],
      ['Private contextual Test binding rejected', { category: 'binding-rejected', code: null, signal: null, source: 'unknown' }],
    ] as const
    for (const [thrown, expected] of cases) {
      const serialized = serializeError(thrown)
      const actual = classifyDiagnosticError(serialized)
      expect(actual).toEqual(expected)
      expect(Object.keys(actual).sort()).toEqual(['category','code','signal','source'])
      expect(JSON.stringify(actual)).not.toMatch(/SECRET|private\.invalid|credential/)
    }
  })
  it('recognizes the installed worker-exit envelope and exact full-app source locations', () => {
    const message = 'Error: worker process exited unexpectedly (code=1, signal=SIGTRAP) SECRET'
    expect(classifyDiagnosticError({ message })).toEqual({ category: 'worker-exit', code: null, signal: 'SIGTRAP', source: 'unknown' })
    expect(classifyDiagnosticError({ message: 'SECRET', location: { file: '/private/e2e/contextual-test-lifecycle.spec.ts' } }).source).toBe('spec')
    expect(classifyDiagnosticError({ message: 'SECRET', location: { file: '/private/playwright.contextual-tests.config.ts' } }).source).toBe('config')
    expect(classifyDiagnosticError({ message: 'SECRET', location: { file: '/private/contextual-test-lifecycle.spec.ts' } }).source).toBe('unknown')
    expect(classifyDiagnosticError({ message: 'Private contextual Test binding rejected SECRET' }).category).toBe('unknown')
  })
  it('bounds serialized text and cause depth while ignoring getters and malformed values', () => {
    let reads = 0
    const accessor = Object.defineProperties({}, {
      message: { get() { reads++; return 'browserType.launch: SECRET' } },
      value: { get() { reads++; return 'browserType.launch: SECRET' } },
      cause: { get() { reads++; return { message: 'EACCES' } } },
    })
    expect(classifyDiagnosticError(accessor)).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    expect(reads).toBe(0)
    const proxy = new Proxy({ message: 'browserType.launch: SECRET' }, { getOwnPropertyDescriptor() { reads++; throw Error('SECRET') } })
    expect(classifyDiagnosticError(proxy)).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    expect(classifyDiagnosticError({ message: 'opaque', cause: proxy, location: proxy })).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    expect(reads).toBe(0)
    expect(classifyDiagnosticError({ message: 'TypeError: SECRET', value: 'browserType.launch: SECRET' })).toEqual({ category: 'type-error', code: null, signal: null, source: 'unknown' })
    expect(classifyDiagnosticError({ message: 'x'.repeat(65537) + ' EACCES', value: 'browserType.launch: SECRET' })).toEqual({ category: 'browser-launch', code: null, signal: null, source: 'fixture' })
    expect(classifyDiagnosticError({ value: 'browserType.launch: ' + 'x'.repeat(65537) })).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    expect(classifyDiagnosticError({ value: { message: 'browserType.launch: SECRET' } })).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    const cycle: { message: string; cause?: unknown } = { message: 'opaque' }; cycle.cause = cycle
    expect(classifyDiagnosticError(cycle)).toEqual({ category: 'unknown', code: null, signal: null, source: 'unknown' })
    const deep = { message: 'opaque', cause: { message: 'opaque', cause: { message: 'EACCES' } } }
    expect(classifyDiagnosticError(deep).category).toBe('unknown')
  })
  it('requires exact single-test success and rejects unknown extra schema, counters and errors', () => {
    const good = { version: 1, status: 'passed', discovered: 1, started: 1, ended: 1, passed: 1, errors: [], overflow: false }
    expect(diagnosticReportPassed(good)).toBe(true)
    for (const patch of [{ started: 0 }, { ended: 2 }, { overflow: true }, { status: 'failed' }, { errors: [classifyDiagnosticError({ message: 'unknown' })] }]) expect(diagnosticReportPassed({ ...good, ...patch })).toBe(false)
    for (const patch of [{ stdout: 'SECRET' }, { started: 3 }, { passed: NaN }, { errors: Array(9).fill(classifyDiagnosticError({})) }, { errors: [{ category: 'unknown', code: 'SECRET', signal: null, source: 'unknown' }] }]) expect(() => validateDiagnosticReport({ ...good, ...patch })).toThrow()
  })
  it('rejects renewed clocks, expired admission and extra fields', () => {
    const a = { version: 1, nonce: 'a'.repeat(32), outputDir: '/private/fixed', startedAt: 1000, deadline: 91000, cleanupDeadline: 451000 }
    expect(validateDiagnosticAdmission(a, 2000)).toEqual(a)
    for (const patch of [{ startedAt: 2001 }, { deadline: 92000 }, { cleanupDeadline: 452000 }, { retries: 1 }]) expect(() => validateDiagnosticAdmission({ ...a, ...patch }, 2000)).toThrow()
    expect(() => validateDiagnosticAdmission(a, 91000)).toThrow()
    expect(validateDiagnosticAdmission({ ...a, mode: 'navigation-lifecycle' }, 2000).mode).toBe('navigation-lifecycle')
    expect(validateDiagnosticAdmission({ ...a, mode: 'redirect-interception' }, 2000).mode).toBe('redirect-interception')
    expect(() => validateDiagnosticAdmission({ ...a, mode: 'arbitrary' }, 2000)).toThrow()
  })
  it('accepts only the complete exact navigation lifecycle receipt without weakened counters or extra data', () => {
    const good = { version: 1, mode: 'navigation-lifecycle', versionMatched: true, diagnosticOnly: true,
      preHeaderHeld: true, bodyHeld: true, bodyVerified: true, destinationAfterValidation: true, boundaryFailed: false,
      contextClosed: true, serverClosed: true, requests: 3, jsonRequests: 1, originalBodies: 1, unexpectedRequests: 0,
      pageErrors: 0, pending: 0, socketsRemaining: 0, failure: null }
    expect(data.navigationLifecyclePassed(good)).toBe(true)
    for (const patch of [{ preHeaderHeld: false }, { bodyHeld: false }, { bodyVerified: false }, { destinationAfterValidation: false },
      { boundaryFailed: true }, { contextClosed: false }, { serverClosed: false }, { requests: 2 }, { requests: 4 },
      { jsonRequests: 2 }, { originalBodies: 0 }, { pending: 1 }, { socketsRemaining: 1 }, { pageErrors: 1 }, { failure: 'body' }]) {
      expect(data.navigationLifecyclePassed({ ...good, ...patch })).toBe(false)
    }
    for (const patch of [{ mode: 'login-body' }, { requests: 9 }, { requests: NaN }, { bodyVerified: 1 }, { failure: 'PRIVATE' }, { url: 'PRIVATE' }]) {
      expect(() => data.navigationLifecyclePassed({ ...good, ...patch })).toThrow()
    }
  })
  it('ordinary compiled spec discovery skips before admission or fixtures; invalid explicit opt-in fails at collection', () => {
    const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { babelTransform } = require(join(dirname(pw.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'))
    const file = join(root, 'e2e/contextual-browser-diagnostic.spec.ts')
    const compiled = babelTransform(readFileSync(file, 'utf8'), file, false, [], []).code
    const collect = (optIn: string | undefined, invalid = false) => {
      const calls: string[] = [], test = Object.assign(() => calls.push('declare'), { skip: (skip: boolean) => calls.push(skip ? 'skip' : 'admitted') })
      const context = { exports: {}, process: { env: { PIKA_BROWSER_DIAGNOSTIC: optIn } }, require: (specifier: string) => {
        if (specifier === '@playwright/test') return { test, expect: () => { throw Error('Fixture executed') } }
        if (specifier === './helpers/contextual-browser-login-diagnostic') return { runLoginBodyDiagnostic: () => { throw Error('Fixture executed') } }
        if (specifier === './helpers/contextual-browser-navigation-diagnostic') return { runNavigationLifecycleDiagnostic: () => { throw Error('Fixture executed') } }
        if (specifier === './helpers/contextual-browser-redirect-diagnostic') return { runRedirectDiagnostic: () => { throw Error('Fixture executed') } }
        if (specifier === '../scripts/contextual-playwright-redirect-guard.cjs') return { assertContextualRedirectInterception: () => { throw Error('Fixture executed') } }
        expect(specifier).toBe('../scripts/contextual-browser-diagnostic-data')
        return { diagnosticAdmissionFromEnvironment: () => { calls.push('read'); if (invalid) throw Error('Invalid admission'); return {} } }
      } }
      return { calls, run: () => new Script(compiled).runInNewContext(context) }
    }
    for (const env of [undefined, 'false']) { const ordinary = collect(env); ordinary.run(); expect(ordinary.calls).toEqual(['skip','declare']) }
    const invalid = collect('true', true); expect(invalid.run).toThrow('Invalid admission'); expect(invalid.calls).toEqual(['read'])
    const admitted = collect('true'); admitted.run(); expect(admitted.calls).toEqual(['read','admitted','declare'])
  })
  it('requires every redirect prevention, allowed delivery and cleanup observation', () => {
    const good = { version: 1, mode: 'redirect-interception', versionMatched: true, diagnosticOnly: true, serversClosed: true, failed: false,
      completed: 6, blocked: 5, appRequests: 13, sinkRequests: 1, forbiddenRequests: 0, redirectRoutes: 6,
      originalBodies: 1, contextsClosed: 6, socketsRemaining: 0 }
    expect(data.redirectInterceptionPassed(good)).toBe(true)
    for (const [key, value] of Object.entries(good)) {
      if (typeof value === 'number' && key !== 'version') expect(data.redirectInterceptionPassed({ ...good, [key]: value + 1 })).toBe(false)
      if (typeof value === 'boolean') expect(data.redirectInterceptionPassed({ ...good, [key]: !value })).toBe(false)
    }
    for (const patch of [{ mode: 'navigation-lifecycle' }, { appRequests: 17 }, { failed: 'false' }, { url: 'PRIVATE' }]) {
      expect(() => data.redirectInterceptionPassed({ ...good, ...patch })).toThrow()
    }
  })
  it.each([true, false])('dispatches only the admitted navigation mode and records its strict result (passed=%s)', async passed => {
    const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { babelTransform } = require(join(dirname(pw.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'))
    const file = join(root, 'e2e/contextual-browser-diagnostic.spec.ts')
    const compiled = babelTransform(readFileSync(file, 'utf8'), file, false, [], []).code
    let body!: (fixtures: { browser: unknown }) => Promise<void>
    const browser = { version: () => data.DIAGNOSTIC_VERSION }, calls: string[] = [], records: unknown[] = []
    const result = { diagnosticOnly: true, preHeaderHeld: true, bodyHeld: true, bodyVerified: passed, destinationAfterValidation: passed,
      boundaryFailed: !passed, contextClosed: true, serverClosed: true, requests: passed ? 3 : 2, jsonRequests: 1, originalBodies: 1,
      unexpectedRequests: 0, pageErrors: 0, pending: 0, socketsRemaining: 0, failure: passed ? null : 'body' }
    const test = Object.assign((_name: string, action: typeof body) => { body = action }, { skip() {} })
    new Script(compiled).runInNewContext({ exports: {}, Date, process: { env: { PIKA_BROWSER_DIAGNOSTIC: 'true' } }, require(specifier: string) {
      if (specifier === '@playwright/test') return { test, expect }
      if (specifier === '../scripts/contextual-playwright-redirect-guard.cjs') return { assertContextualRedirectInterception() {} }
      if (specifier === './helpers/contextual-browser-redirect-diagnostic') return { runRedirectDiagnostic: () => { throw Error('Wrong mode') } }
      if (specifier === '../scripts/contextual-browser-diagnostic-data') return { ...data,
        diagnosticAdmissionFromEnvironment: () => ({ mode: 'navigation-lifecycle', deadline: Date.now() + 90000, outputDir: '/CPU-private' }),
        diagnosticWrite: (_output: string, name: string, value: unknown) => { expect(name).toBe('lifecycle.json'); records.push(value) },
      }
      if (specifier === './helpers/contextual-browser-navigation-diagnostic') return { runNavigationLifecycleDiagnostic: async (actual: unknown, end: number) => {
        expect(actual).toBe(browser); expect(end - Date.now()).toBeLessThanOrEqual(20000); calls.push('navigation'); return result
      } }
      if (specifier === './helpers/contextual-browser-login-diagnostic') return { runLoginBodyDiagnostic: () => { throw Error('Wrong mode') } }
      throw Error('Unexpected import')
    } })
    if (passed) await body({ browser }); else await expect(body({ browser })).rejects.toThrow()
    expect(calls).toEqual(['navigation']); expect(records).toHaveLength(1)
    expect(data.navigationLifecyclePassed(records[0])).toBe(passed)
  })
  it('requires umask077 and verifies private defaults after Playwright-style remove/recreate', () => {
    const original = process.umask(0o022), folder = realpathSync(mkdtempSync(join(tmpdir(), 'pika-browser-modes-')))
    try {
      expect(() => data.assertDiagnosticPrivateUmask(process.umask())).toThrow()
      chmodSync(folder, 0o700); const output = join(folder, 'runner-output')
      mkdirSync(output, { mode: 0o700 }); rmSync(output, { recursive: true })
      process.umask(0o077); data.assertDiagnosticPrivateUmask(process.umask())
      mkdirSync(output); const metadata = join(output, '.last-run.json'); writeFileSync(metadata, '{}')
      expect(lstatSync(output).mode & 0o777).toBe(0o700); expect(lstatSync(metadata).mode & 0o777).toBe(0o600)
      data.assertDiagnosticRunnerOutputModes(folder)
      chmodSync(metadata, 0o644); expect(() => data.assertDiagnosticRunnerOutputModes(folder)).toThrow(); chmodSync(metadata, 0o600)
      symlinkSync(metadata, join(output, 'linked')); expect(() => data.assertDiagnosticRunnerOutputModes(folder)).toThrow(); rmSync(join(output, 'linked'))
      linkSync(metadata, join(output, 'hardlink')); expect(() => data.assertDiagnosticRunnerOutputModes(folder)).toThrow(); rmSync(join(output, 'hardlink'))
      for (let i = 0; i < 64; i++) writeFileSync(join(output, `file-${i}`), '')
      expect(() => data.assertDiagnosticRunnerOutputModes(folder)).toThrow()
    } finally { process.umask(original); rmSync(folder, { recursive: true }) }
  })
  it('captures pre-test fixture and global errors with bounded counters and no raw output', async () => {
    const admission = vi.spyOn(data, 'diagnosticAdmissionFromEnvironment').mockReturnValue({ version: 1, nonce: 'a'.repeat(32), outputDir: '/private/fixed', startedAt: 1000, deadline: 91000, cleanupDeadline: 451000 })
    const write = vi.spyOn(data, 'diagnosticWrite').mockImplementation(() => {})
    try {
      const { default: Reporter } = await import('../../e2e/helpers/contextual-browser-diagnostic-reporter')
      const reporter = new Reporter()
      reporter.onBegin({}, { allTests: () => [{}] } as never); reporter.onTestBegin()
      reporter.onTestEnd({} as never, { status: 'failed', errors: [{ message: 'browserType.launch: SECRET https://private.invalid/?token=SECRET SIGTRAP' }] } as never)
      for (let i = 0; i < 20; i++) reporter.onError({ message: 'SECRET unknown' })
      reporter.onEnd({ status: 'failed' } as never)
      const report = write.mock.calls[0][2]
      expect(data.validateDiagnosticReport(report)).toMatchObject({ discovered: 1, started: 1, ended: 1, passed: 0, overflow: true })
      expect((report as data.DiagnosticReport).errors).toHaveLength(8)
      expect(JSON.stringify(report)).not.toMatch(/SECRET|private\.invalid/)
      expect((report as data.DiagnosticReport).errors[0]).toEqual({ category: 'browser-launch', code: null, signal: 'SIGTRAP', source: 'fixture' })
      expect(reporter.printsToStdio()).toBe(true)
    } finally { admission.mockRestore(); write.mockRestore() }
  })
  it('parses every fixed runtime module using the actual installed Playwright CJS compiler without execution', () => {
    const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { babelTransform } = require(join(dirname(pw.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'))
    expect(require('@playwright/test/package.json').version).toBe('1.58.0')
    for (const file of diagnosticSourceFiles.filter(f => f.endsWith('.ts'))) {
      const compiled = babelTransform(readFileSync(join(root, file), 'utf8'), join(root, file), false, [], []).code
      expect(compiled).not.toContain('import.meta'); expect(() => new Script(compiled)).not.toThrow()
      const tree = ts.createSourceFile(file, compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')
          && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
          const specifier = node.arguments[0].text
          if (specifier.startsWith('.')) {
            const base = resolve(dirname(join(root, file)), specifier), dependency = [base, base + '.ts', base + '.js', base + '.cjs'].find(existsSync)
            expect(dependency).toBeDefined(); expect(diagnosticSourceFiles).toContain(dependency!.slice(root.length + 1))
          } else expect(specifier.startsWith('node:') || ['@playwright/test'].includes(specifier)).toBe(true)
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
    const runner = readFileSync(join(root, 'scripts/contextual-browser-diagnostic.ts'), 'utf8')
    expect(runner).toContain('createContextualTestNativeControls'); expect(runner).not.toContain('createContextualTestExecutionControls')
    expect(runner).not.toMatch(/command\.run|\.kill\(|\.ready\(|--version.*chrome/)
    const spec = readFileSync(join(root, 'e2e/contextual-browser-diagnostic.spec.ts'), 'utf8')
    expect(spec).not.toMatch(/\.goto\(|\.request\.|fetch\(|\.launch\(/)
    const config = readFileSync(join(root, 'playwright.contextual-browser-diagnostic.config.ts'), 'utf8')
    expect(config).toContain('workers: 1, retries: 0'); expect(config).not.toMatch(/webServer|baseURL/)
    expect(config).toContain("globalSetup: './e2e/helpers/contextual-browser-diagnostic-setup.ts'")
  })
})
