import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { observeFixtureError, validateFixtureErrorObservation } from '../../scripts/contextual-fixture-error-observation'

const empty = { message: 'absent', value: 'absent', stack: 'absent', cause: 'absent', location: 'absent', code: 'absent', signal: 'absent', name: 'absent' }

describe('private fixture error observation', () => {
  it('describes installed Playwright serialization using only fixed fields and labels', () => {
    const require = createRequire(import.meta.url)
    const pw = createRequire(require.resolve('@playwright/test/package.json'))
    const { serializeError } = pw(join(dirname(pw.resolve('playwright/package.json')), 'lib/util.js'))
    expect(require('@playwright/test/package.json').version).toBe('1.58.0')
    const secret = 'PASSWORD https://private.invalid/?token=SECRET /private/credential'
    const error = new Error(secret, { cause: new TypeError(secret) })
    const result = observeFixtureError(serializeError(error), 'test-end')
    expect(result).toEqual({
      event: 'test-end',
      rootShape: { ...empty, kind: 'object', message: 'bounded', stack: 'bounded', cause: 'nonstring' },
      firstCauseShape: { ...empty, kind: 'object', message: 'bounded', stack: 'bounded', cause: 'nonstring' },
      sites: ['unknown'],
    })
    expect(JSON.stringify(result)).not.toMatch(/PASSWORD|SECRET|private\.invalid|credential/)
    expect(observeFixtureError(serializeError(secret), 'global').rootShape).toMatchObject({ kind: 'object', value: 'bounded' })
  })

  it('emits exact reported site labels from location and stack frames, with at most three distinct sites', () => {
    const stack = [
      'Error: secret',
      '    at Object._setTimeout (/private/node_modules/.pnpm/playwright@1.58.0/node_modules/playwright/lib/common/testType.js:227:9)',
      '    at /private/e2e/contextual-test-lifecycle.spec.ts:71:2',
      '    at fn (/private/node_modules/.pnpm/playwright@1.58.0/node_modules/playwright/lib/worker/fixtureRunner.js:81:3)',
      '    at fn (/private/node_modules/.pnpm/playwright@1.58.0/node_modules/playwright/lib/worker/workerMain.js:270:1)',
    ].join('\n')
    expect(observeFixtureError({ stack, location: { file: '/private/e2e/helpers/contextual-test-admission.ts', line: 99 } }, 'body').sites)
      .toEqual(['admission', 'pw-test-type', 'full-app-spec'])
    expect(observeFixtureError({ stack }, 'test-end').sites).toEqual(['pw-test-type', 'full-app-spec', 'pw-fixture-runner'])
    expect(observeFixtureError({ location: { file: '/private/node_modules/.pnpm/playwright-core@1.58.0/node_modules/playwright-core/lib/server/browserType.js' } }, 'global').sites)
      .toEqual(['pw-browser-type'])
    expect(observeFixtureError({ stack: 'Error: at /private/e2e/contextual-test-lifecycle.spec.ts:71:2' }, 'global').sites).toEqual(['unknown'])
    expect(observeFixtureError({ stack: '    at /private/e2e/contextual-test-lifecycle.spec.ts.evil:71:2' }, 'global').sites).toEqual(['unknown'])
    expect(observeFixtureError({ location: { file: '/private/e2e/fake-contextual-test-lifecycle.spec.ts' } }, 'global').sites).toEqual(['unknown'])
  })

  it('labels each grounded producer family without retaining file names or line numbers', () => {
    const cases = [
      ['playwright.contextual-tests.config.ts', 'full-app-config'],
      ['scripts/contextual-test-rehearsal-binding.ts', 'binding'],
      ['e2e/helpers/contextual-test-startup.ts', 'startup'],
      ['e2e/helpers/contextual-test-runtime.ts', 'runtime'],
      ['e2e/helpers/contextual-test-workflow.ts', 'workflow'],
      ['node_modules/playwright/lib/index.js', 'pw-lib-fixtures'],
      ['node_modules/playwright/lib/runner/dispatcher.js', 'pw-dispatcher'],
      ['node_modules/playwright/lib/transform/transform.js', 'pw-transform'],
      ['node_modules/playwright/lib/transform/esmLoader.js', 'pw-esm-loader'],
      ['node_modules/playwright-core/lib/server/chromium/chromium.js', 'pw-chromium'],
      ['node:internal/modules/cjs/loader', 'node-internal-module'],
    ] as const
    for (const [file, label] of cases) {
      const observed = observeFixtureError({ location: { file: file.startsWith('node:') ? file : `/private/${file}` } }, 'global')
      expect(observed.sites).toEqual([label])
      expect(JSON.stringify(observed)).not.toContain(file)
    }
  })

  it('bounds strings, frames and envelopes and avoids getters, proxies, cycles and coercion', () => {
    const reads = { count: 0 }
    const hostile = Object.defineProperties({}, {
      message: { get() { reads.count++; throw Error('SECRET') } },
      cause: { get() { reads.count++; throw Error('SECRET') } },
    })
    expect(observeFixtureError(hostile, 'global')).toEqual({ event: 'global', rootShape: { ...empty, kind: 'object', message: 'accessor', cause: 'accessor' }, sites: ['unknown'] })
    const proxy = new Proxy({ stack: '    at /private/e2e/contextual-test-lifecycle.spec.ts:4:5' }, { getOwnPropertyDescriptor() { reads.count++; throw Error('SECRET') } })
    expect(observeFixtureError(proxy, 'global').rootShape).toEqual({ ...empty, kind: 'proxy' })
    expect(observeFixtureError({ cause: proxy, location: proxy }, 'global').firstCauseShape).toEqual({ ...empty, kind: 'proxy' })
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    expect(observeFixtureError(revoked.proxy, 'global').rootShape).toEqual({ ...empty, kind: 'proxy' })
    expect(() => validateFixtureErrorObservation(revoked.proxy)).toThrow()
    expect(reads.count).toBe(0)
    const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic
    expect(observeFixtureError(cyclic, 'global').firstCauseShape).toBeUndefined()
    expect(observeFixtureError({ cause: { cause: { message: 'secret' } } }, 'global').firstCauseShape?.cause).toBe('nonstring')
    expect(observeFixtureError(null, 'global').rootShape.kind).toBe('null')
    expect(observeFixtureError(42, 'global').rootShape.kind).toBe('primitive')
    expect(observeFixtureError({ message: '', value: 3, stack: 'x'.repeat(65537), location: { file: 'x'.repeat(4097) } }, 'global'))
      .toMatchObject({ rootShape: { message: 'empty', value: 'nonstring', stack: 'oversized' }, sites: ['unknown'] })
    const manyFrames = Array(32).fill('    at /private/unknown.js:1:1').concat('    at /private/e2e/contextual-test-lifecycle.spec.ts:1:1').join('\n')
    expect(observeFixtureError({ stack: manyFrames }, 'global').sites).toEqual(['unknown'])
  })

  it('strictly validates schema and returns an independent plain copy', () => {
    expect(() => observeFixtureError({}, 'SECRET' as 'global')).toThrow()
    const good = observeFixtureError({ message: 'secret' }, 'body')
    const copy = validateFixtureErrorObservation(good)
    expect(copy).toEqual(good)
    expect(copy).not.toBe(good)
    expect(copy.rootShape).not.toBe(good.rootShape)
    for (const bad of [
      { ...good, secret: 'SECRET' },
      { ...good, sites: [] },
      { ...good, sites: ['unknown', 'unknown'] },
      { ...good, sites: ['unknown', 'full-app-spec', 'pw-worker-main', 'startup'] },
      { ...good, sites: ['SECRET'] },
      { ...good, rootShape: { ...good.rootShape, extra: 'SECRET' } },
      { ...good, rootShape: { ...good.rootShape, message: 'SECRET' } },
      Object.defineProperty({ ...good }, 'event', { get() { throw Error('SECRET') } }),
      new Proxy(good, {}),
    ]) expect(() => validateFixtureErrorObservation(bad)).toThrow()
  })
})
