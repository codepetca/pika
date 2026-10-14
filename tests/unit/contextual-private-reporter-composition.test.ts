import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Script } from 'node:vm'
import * as diagnostic from '../../scripts/contextual-browser-diagnostic-data'
import * as startup from '../../e2e/helpers/contextual-test-startup'
import BrowserDiagnosticReporter from '../../e2e/helpers/contextual-browser-diagnostic-reporter'
import ContextualTestStartupReporter from '../../e2e/helpers/contextual-test-startup-reporter'

const require = createRequire(import.meta.url)
const playwright = createRequire(require.resolve('@playwright/test/package.json'))
const lib = join(dirname(playwright.resolve('playwright/package.json')), 'lib')
type Reporter = { _reporter?: unknown; printsToStdio(): boolean; onConfigure(config: unknown): void; onBegin(suite: unknown): void;
  onError(error: unknown): void; onStdOut(chunk: unknown, test?: unknown): void; onStdErr(chunk: unknown, test?: unknown): void; onEnd(result: unknown): Promise<void> }

describe('installed Playwright private reporter composition; CPU only, no config or admission execution', () => {
  it.each([
    { label: 'browser diagnostic', PrivateReporter: BrowserDiagnosticReporter, ci: undefined }, { label: 'browser diagnostic', PrivateReporter: BrowserDiagnosticReporter, ci: '1' },
    { label: 'full-app startup', PrivateReporter: ContextualTestStartupReporter, ci: undefined }, { label: 'full-app startup', PrivateReporter: ContextualTestStartupReporter, ci: '1' },
  ])('keeps only $label under CI=$ci and emits no hostile error/title/stdout/stderr', async ({ PrivateReporter, ci }) => {
    const writes: unknown[] = [], receipts: unknown[] = [], fallback = vi.fn()
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const spies = [
      vi.spyOn(diagnostic, 'diagnosticAdmissionFromEnvironment').mockReturnValue({ version: 1, outputDir: '/CPU-only', nonce: 'a'.repeat(32), startedAt: 1, deadline: 90001, cleanupDeadline: 450001 }),
      vi.spyOn(diagnostic, 'diagnosticWrite').mockImplementation((_dir, _name, report) => { receipts.push(report) }),
      vi.spyOn(startup, 'contextualTestStartupBinding').mockReturnValue({} as never),
      vi.spyOn(startup, 'createContextualTestStartup').mockReturnValue({ stage() {}, failure() {} }),
      vi.spyOn(startup, 'writeFullStartupReport').mockImplementation((_binding, report) => { receipts.push(report) }),
    ]
    try {
      expect(require('@playwright/test/package.json').version).toBe('1.58.0')
      class FallbackReporter {
        constructor() { fallback() }
        printsToStdio() { return true }
        onError(error: unknown) { writes.push(error) }
        onStdOut(chunk: unknown) { writes.push(chunk) }
        onStdErr(chunk: unknown) { writes.push(chunk) }
      }
      // Evaluate whole installed modules unchanged. Only reporter loading and
      // inactive built-in reporters are doubled; no CLI, config or native graph.
      const load = (file: string, imports: (name: string) => unknown) => {
        const loaded = { exports: {} }
        new Script(readFileSync(join(lib, file), 'utf8'), { filename: file }).runInNewContext({ module: loaded, exports: loaded.exports, require: imports,
          process: { env: { CI: ci }, stdout: { write: (value: unknown) => writes.push(value) }, stderr: { write: (value: unknown) => writes.push(value) } },
          console: { error: (...values: unknown[]) => writes.push(...values), log: (...values: unknown[]) => writes.push(...values) } })
        return loaded.exports
      }
      const wrapper = load('reporters/reporterV2.js', name => { throw Error(`Unexpected wrapper import: ${name}`) })
      const { Multiplexer } = load('reporters/multiplexer.js', name => { throw Error(`Unexpected multiplexer import: ${name}`) }) as { Multiplexer: new (reporters: Reporter[]) => Reporter }
      const loadReporter = vi.fn(async () => PrivateReporter)
      const { createReporters } = load('runner/reporters.js', name => {
        if (name === './loadUtils') return { loadReporter }
        if (name === '../reporters/reporterV2') return wrapper
        if (name === 'playwright-core/lib/utils' || name === '../reporters/base') return {}
        if (name === '../reporters/blob') return { BlobReporter: FallbackReporter }
        expect(name).toMatch(/^\.\.\/reporters\/(dot|empty|github|html|json|junit|line|list|listModeReporter)$/)
        return FallbackReporter
      }) as { createReporters(config: unknown, mode: string): Promise<Reporter[]> }
      const reporters = await createReporters({ config: { reporter: [['CPU-private-reporter']], tags: [] }, configCLIOverrides: {}, configDir: '/CPU-only', cliArgs: [] }, 'test')
      const mux = new Multiplexer(reporters), secret = 'SECRET-password https://private.invalid/?token=SECRET /private/SECRET'
      const error = { message: `browserType.launch: ${secret}`, stack: secret, stdout: secret, stderr: secret }
      mux.onConfigure({}); mux.onError(error); mux.onStdOut(secret, { title: secret }); mux.onStdErr(Buffer.from(secret), { title: secret })
      mux.onBegin({ allTests: () => [{}] })
      mux.onError(error); mux.onStdOut(secret); mux.onStdErr(secret); await mux.onEnd({ status: 'failed' })
      expect(reporters).toHaveLength(1); expect(reporters[0]._reporter).toBeInstanceOf(PrivateReporter)
      expect(loadReporter).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled()
      expect(writes).toEqual([]); expect(stdout).not.toHaveBeenCalled(); expect(stderr).not.toHaveBeenCalled()
      expect(receipts).toHaveLength(1); expect(JSON.stringify(receipts)).not.toMatch(/SECRET|private\.invalid|password|stack|stdout|stderr|title/)
      expect(diagnostic.validateDiagnosticReport(receipts[0]).errors).toEqual(Array(2).fill({ category: 'browser-launch', code: null, signal: null, source: 'fixture' }))
    } finally { for (const spy of spies) spy.mockRestore(); stdout.mockRestore(); stderr.mockRestore() }
  })
})
