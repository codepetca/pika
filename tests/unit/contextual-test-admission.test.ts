import { describe, expect, it } from 'vitest'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Script } from 'node:vm'
import * as launch from '../../scripts/contextual-test-rehearsal-launch'

const require = createRequire(import.meta.url), pw = createRequire(require.resolve('@playwright/test/package.json'))
const { babelTransform } = require(join(dirname(pw.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'))
const file = resolve(import.meta.dirname, '../../e2e/helpers/contextual-test-admission.ts')
const compiled = babelTransform(readFileSync(file, 'utf8'), file, false, [], []).code

function admissionFixture() {
  const events: string[] = [], files = new Set<string>(), outputDir = '/private/synthetic-output'
  let bindingRejected = false
  const exports: Record<string, unknown> = {}
  new Script(compiled).runInNewContext({ exports, process: { platform: 'darwin' }, Date,
    require: (specifier: string) => {
      if (specifier === './contextual-test-startup') return { contextualTestStartupBinding() {
        events.push('binding'); if (bindingRejected) throw Error('SECRET binding'); return { outputDir, projectId: 'synthetic', sourceSha: 'synthetic', deadline: Date.now() + 1000 }
      } }
      if (specifier.endsWith('contextual-test-rehearsal-launch')) return { assertContextualTestUnusedRunnerOutput(directory: string) {
        expect(directory).toBe(outputDir); events.push('unused-output')
        if (files.has('runner-output') || files.has('playwright-started.json')) throw Error('SECRET stale output')
      } }
      if (specifier === 'node:assert/strict') return assert
      if (specifier === 'node:path') return { join }
      if (specifier === 'node:crypto') return { createHash: () => ({ update: () => ({ digest: () => exports.CONTEXTUAL_TEST_CHROME_SHA256 }) }) }
      if (specifier === 'node:fs') return {
        existsSync: (path: string) => files.has(path.slice(outputDir.length + 1)),
        realpathSync: (path: string) => path,
        lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o755 }),
        readFileSync: () => { events.push('chrome-pin'); return Buffer.from('synthetic Chrome') },
        writeFileSync: (path: string, _bytes: string, options: { mode: number; flag: string }) => {
          expect(options).toEqual({ mode: 0o600, flag: 'wx' }); events.push('exclusive-start')
          const name = path.slice(outputDir.length + 1); if (files.has(name)) throw Error('SECRET collision'); files.add(name)
        },
      }
      throw Error('Unexpected CPU import')
    },
  })
  return { events, files, rejectBinding: () => { bindingRejected = true },
    config: exports.contextualTestConfigBinding as () => unknown,
    setup: exports.default as () => Promise<void> }
}

describe('first-run admission versus Playwright worker config reload (CPU only)', () => {
  it('validates the binding on every config read without treating owned worker output as a new admission', async () => {
    const f = admissionFixture()
    f.config(); await f.setup(); f.files.add('runner-output'); f.config(); f.config()
    expect(f.events).toEqual(['binding','binding','unused-output','chrome-pin','exclusive-start','binding','binding'])
    expect(f.events.filter(event => event === 'exclusive-start')).toHaveLength(1)
    f.rejectBinding(); expect(() => f.config()).toThrow('Private contextual Test admission rejected')
  })
  it.each(['runner-output', 'playwright-started.json'])('rejects stale %s at global setup before pin reads or a new receipt', async name => {
    const f = admissionFixture(); f.files.add(name)
    await expect(f.setup()).rejects.toThrow('Private contextual Test admission failed; no browser acceptance')
    expect(f.events).toEqual(['binding','unused-output']); expect(f.files).toEqual(new Set([name]))
  })
  it('does not allow a second global setup to reuse its exclusive start receipt', async () => {
    const f = admissionFixture(); await f.setup()
    await expect(f.setup()).rejects.toThrow('Private contextual Test admission failed; no browser acceptance')
    expect(f.events.filter(event => event === 'exclusive-start')).toHaveLength(1)
  })
})

describe('private pre-launch freshness guard (owned temporary CPU files only)', () => {
  function fixture() {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-unused-output-')))
    chmodSync(directory, 0o700)
    return { directory, close: () => rmSync(directory, { recursive: true }) }
  }
  it('accepts only a private parent and does not allocate any output or admission', () => {
    const f = fixture()
    try {
      expect(() => launch.assertContextualTestUnusedRunnerOutput(f.directory)).not.toThrow()
      expect(existsSync(join(f.directory, 'runner-output'))).toBe(false)
      expect(existsSync(join(f.directory, 'playwright-started.json'))).toBe(false)
      chmodSync(f.directory, 0o755)
      expect(() => launch.assertContextualTestUnusedRunnerOutput(f.directory)).toThrow()
    } finally { f.close() }
  })
  it.each(['directory','file','dangling-link','start-receipt'] as const)('rejects existing %s without adopting, clearing or replacing it', kind => {
    const f = fixture(), name = join(f.directory, kind === 'start-receipt' ? 'playwright-started.json' : 'runner-output')
    try {
      if (kind === 'directory') { mkdirSync(name); writeFileSync(join(name, 'keep'), 'unchanged') }
      else if (kind === 'dangling-link') symlinkSync(join(f.directory, 'missing'), name)
      else writeFileSync(name, 'unchanged')
      const before = lstatSync(name)
      expect(() => launch.assertContextualTestUnusedRunnerOutput(f.directory)).toThrow()
      expect(lstatSync(name).ino).toBe(before.ino)
      if (kind === 'directory') expect(readFileSync(join(name, 'keep'), 'utf8')).toBe('unchanged')
      else if (kind !== 'dangling-link') expect(readFileSync(name, 'utf8')).toBe('unchanged')
    } finally { f.close() }
  })
  it('rejects parent aliases and non-directory parents', () => {
    const f = fixture()
    try {
      const link = join(f.directory, 'alias'), plain = join(f.directory, 'plain')
      symlinkSync(f.directory, link); writeFileSync(plain, 'unchanged')
      expect(() => launch.assertContextualTestUnusedRunnerOutput(link)).toThrow()
      expect(() => launch.assertContextualTestUnusedRunnerOutput(plain)).toThrow()
    } finally { f.close() }
  })
  it('pins the native call site before spawn, not after Playwright can clear output', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../scripts/contextual-test-rehearsal-native.ts'), 'utf8')
    const method = source.slice(source.indexOf('async launchPlaywright(input)'), source.indexOf('async settleAll(end)', source.indexOf('async launchPlaywright(input)')))
    const guard = method.indexOf('assertContextualTestUnusedRunnerOutput(admission.outputDir)')
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(method.indexOf('native.spawnOwned('))
  })
})
