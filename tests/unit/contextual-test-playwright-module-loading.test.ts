import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
    const seeds = ['playwright.contextual-tests.config.ts', 'e2e/contextual-test-lifecycle.spec.ts', 'e2e/helpers/contextual-test-runtime.ts']
    const visited = new Set<string>(), external = new Set<string>(), pending = seeds.map(file => join(repository, file))
    while (pending.length) {
      const file = pending.pop()!; if (visited.has(file)) continue; visited.add(file)
      expect(visited.size).toBeLessThanOrEqual(32)
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
      'scripts/contextual-test-process-ownership.ts']) expect(files).toContain(needed)
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
