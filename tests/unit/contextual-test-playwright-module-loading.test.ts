import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { Script } from 'node:vm'
import ts from 'typescript'

const repository = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
// Resolve the compiler actually used by the installed @playwright/test CLI;
// do not substitute Vitest/esbuild/TypeScript transpilation for this check.
const playwright = createRequire(require.resolve('@playwright/test/package.json'))
const playwrightRoot = dirname(playwright.resolve('playwright/package.json'))
const { babelTransform } = require(join(playwrightRoot, 'lib/transform/babelBundle.js')) as {
  babelTransform(code: string, file: string, esm: boolean, prologue: unknown[], epilogue: unknown[]): { code: string }
}
const { requireOrImport } = require(join(playwrightRoot, 'lib/transform/transform.js')) as {
  requireOrImport(file: string): Promise<{ load(): number }>
}
const compile = (file: string) => babelTransform(readFileSync(file, 'utf8'), file, false, [], []).code
function localModule(parent: string, specifier: string): string {
  const base = resolve(dirname(parent), specifier)
  expect(base.startsWith(`${repository}/`)).toBe(true)
  const candidate = [base, ...['.ts','.tsx','.js','.cjs','.json'].map(extension => base + extension), join(base, 'index.ts'), join(base, 'index.js')].find(existsSync)
  expect(candidate, `Unresolved local source dependency from ${relative(repository, parent)}`).toBeDefined()
  return candidate!
}
function importedSpecifiers(compiled: string): string[] {
  const tree = ts.createSourceFile('actual-playwright-output.cjs', compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) found.add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(tree); return [...found]
}

describe('actual installed Playwright CommonJS module-loading compatibility, CPU parse only', () => {
  it('covers config, spec, dynamic runtime and their complete repository-local runtime import closure without executing it', () => {
    expect(require('@playwright/test/package.json').version).toBe('1.58.0')
    // Installed PW util.fileIsModule selects CJS for these .ts files under the
    // nearest repository package. No change to that production compiler policy.
    expect(JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).type).not.toBe('module')
    const seeds = ['playwright.contextual-tests.config.ts', 'e2e/contextual-test-lifecycle.spec.ts', 'e2e/helpers/contextual-test-runtime.ts', 'e2e/helpers/contextual-test-startup-reporter.ts']
    const visited = new Set<string>(), external = new Set<string>(), pending = seeds.map(file => join(repository, file))
    while (pending.length) {
      const file = pending.pop()!; if (visited.has(file)) continue; visited.add(file)
      // The original 32-source closure plus the inert strict login receipt helper;
      // this CPU graph bound does not change any native execution allowance.
      expect(visited.size).toBeLessThanOrEqual(33)
      const compiled = compile(file)
      // Compiles/parses only: do not run Script or require any carrier module,
      // config binding, native function, filesystem SQL edge or old attempt.
      expect(() => new Script(compiled, { filename: relative(repository, file) })).not.toThrow()
      expect(compiled).not.toContain('import.meta')
      for (const specifier of importedSpecifiers(compiled)) {
        if (specifier.startsWith('.')) pending.push(localModule(file, specifier))
        else { expect(specifier.startsWith('node:') || ['@playwright/test','zod'].includes(specifier)).toBe(true); external.add(specifier) }
      }
    }
    const files = [...visited].map(file => relative(repository, file))
    for (const needed of [...seeds, 'e2e/helpers/contextual-test-admission.ts', 'e2e/helpers/contextual-test-workflow.ts',
      'scripts/contextual-test-rehearsal-binding.ts', 'scripts/contextual-test-rehearsal-native.ts', 'scripts/contextual-test-rehearsal-launch.ts',
      'scripts/contextual-test-process-ownership.ts', 'scripts/contextual-test-login-diagnostic-proof.ts']) expect(files).toContain(needed)
    for (const excluded of ['scripts/contextual-test-rehearsal-platform.ts', 'scripts/contextual-assignment-list-proof-platform.ts',
      'scripts/contextual-assignment-list-proof-lifecycle.ts', 'scripts/check-contextual-assignment-list-reads.ts',
      'scripts/contextual-test-rehearsal-controller.ts']) expect(files).not.toContain(excluded)
    expect(external.has('node:child_process')).toBe(true) // inert native helper imports are parsed, never invoked
    expect(external.has('@playwright/test')).toBe(true)
  })
  it('detects the historical CLI import.meta guard with the same actual compiler and never executes that guard', () => {
    const compiled = compile(join(repository, 'scripts/check-contextual-assignment-list-reads.ts'))
    expect(compiled).toContain('import.meta.url')
    expect(() => new Script(compiled, { filename: 'unexecuted-historical-cli.cjs' })).toThrow(SyntaxError)
  })
})

describe('compiled contextual Playwright spec loading with inert fixtures', () => {
  it('executes Playwright’s installed CommonJS TypeScript hook for a late extensionless require', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-pw-loader-'))
    try {
      const entry = join(directory, 'entry.ts')
      writeFileSync(entry, 'export function load() { return require("./runtime").marker }\n')
      writeFileSync(join(directory, 'runtime.ts'), 'export const marker: number = 42\n')
      const loaded = await requireOrImport(entry)
      expect(loaded.load()).toBe(42)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it.each([false, true])('keeps collection inert and loads the runtime only inside an opted-in test (optedIn=%s)', async optedIn => {
    const events: string[] = []
    let body: ((fixtures: { browser: object }, info: object) => Promise<void>) | undefined
    let skipped = false
    const binding = Object.freeze({})
    const startup = {
      stage(stage: string) { events.push(stage) },
      failure() { events.push('failure') },
    }
    const test = Object.assign(
      (_name: string, callback: typeof body) => { body = callback },
      { skip(value: boolean) { skipped = value }, setTimeout(_ms: number) { events.push('timeout') } },
    )
    const runtimeModule = { async createContextualTestRuntime() {
      events.push('runtime-entry')
      return { runtime: {}, async close(outcome: string) { events.push(`close:${outcome}`) } }
    } }
    const spec = join(repository, 'e2e/contextual-test-lifecycle.spec.ts')
    const sandboxModule = { exports: {} }
    const dependencies: Record<string, unknown> = {
      '@playwright/test': { test },
      './helpers/contextual-test-workflow': { async runContextualTestWorkflow() { events.push('workflow-run') } },
      './helpers/contextual-test-startup': {
        contextualTestStartupBinding() { events.push('binding'); return binding },
        createContextualTestStartup(value: unknown) { expect(value).toBe(binding); return startup },
      },
      './helpers/contextual-test-runtime': runtimeModule,
    }
    const sandbox = {
      exports: sandboxModule.exports, module: sandboxModule,
      process: { env: { PIKA_CONTEXTUAL_TEST_REHEARSAL: optedIn ? 'true' : undefined } },
      require(specifier: string) {
        expect(Object.hasOwn(dependencies, specifier), `Unexpected module ${specifier}`).toBe(true)
        if (specifier === './helpers/contextual-test-runtime') events.push('runtime-load')
        return dependencies[specifier]
      },
    }
    new Script(compile(spec), { filename: spec }).runInNewContext(sandbox)
    expect(body).toBeTypeOf('function')
    expect(skipped).toBe(!optedIn)
    expect(events).toEqual(optedIn ? ['binding'] : [])
    if (!optedIn) return
    await body!({ browser: {} }, {})
    expect(events).toEqual(['binding', 'spec-entry', 'timeout', 'runtime-import', 'runtime-load',
      'runtime-imported', 'runtime-entry', 'workflow', 'workflow-run', 'teardown', 'close:passed'])
  })
})
