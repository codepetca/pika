import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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
      expect(reporter.printsToStdio()).toBe(false)
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
