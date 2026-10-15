import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import vm from 'node:vm'
import { mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync, readFileSync, renameSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { createContextualTestEgressPolicy, validateContextualTestNextFork, createContextualTestSharedLedger, boundContextualTestHttpRequest, createContextualTestBoundedFetch, createContextualTestStaticWorkerFork, disableContextualTestNextTelemetry, disableContextualTestNextVersionLookup } = require('../../scripts/contextual-test-rehearsal-egress.cjs')

describe('installed socket guard matches native argument normalization without native dispatch', () => {
  const normalize = require('node:net')._normalizeArgs as (args: unknown[]) => unknown[]
  const marker = Object.getOwnPropertySymbols(normalize([]))[0]
  const native = (process as unknown as { binding(name: string): Record<string, string> }).binding('natives').net
  const connectSource = native.slice(native.indexOf('function connect(...args)'), native.indexOf('\nfunction getDefaultAutoSelectFamily'))
  const socketStart = native.indexOf('Socket.prototype.connect = function(...args)')
  const socketPrefix = native.slice(socketStart, native.indexOf('  if (netClientSocketChannel.hasSubscribers)', socketStart))
  function harness(settings: { deadline?: number; normalize?: typeof normalize; bytes?: number } = {}) {
    const state = { app: 0, storage: 0, api: 0, flags: { denied: false, uncertain: false, expired: false, capExceeded: false } }
    const note = vi.fn((flag: keyof typeof state.flags) => { state.flags[flag] = true })
    const ledger = { note, snapshot: () => state, charge(bucket: 'app' | 'storage' | 'api') {
      if (Object.values(state.flags).some(Boolean)) throw Error('Closed synthetic ledger')
      state[bucket]++
    } }
    const dispatch = vi.fn((_args: unknown[], _options: unknown, _callback: unknown) => ({}))
    const Socket = function () {}
    const nativeContext = { Socket, ArrayIsArray: Array.isArray, normalizedArgsSymbol: marker, normalizeArgs: normalize, dispatch }
    // Execute only the installed native normalization prefix; all handle creation,
    // lookup and connect code is replaced by a CPU dispatch spy.
    vm.runInNewContext(socketPrefix + 'return dispatch(args, options, cb); };', nativeContext, { timeout: 1000 })
    const nativeConnect = vm.runInNewContext('(' + connectSource + ')', { Socket, normalizeArgs: normalize, debug() {} }, { timeout: 1000 }) as (...args: unknown[]) => unknown
    const synthetic = { host: '127.0.0.1', port: 54331, path: undefined }
    const originalFetch = vi.fn(async () => { nativeConnect(synthetic); return new Response(settings.bytes ? Buffer.alloc(settings.bytes) : '{}') })
    const forbidden = vi.fn(() => { throw Error('No native CPU dispatch') })
    const modules: Record<string, unknown> = {
      'node:assert/strict': require('node:assert/strict'), 'node:fs': {}, 'node:path': require('node:path'), 'node:crypto': {}, 'node:util': require('node:util'),
      'node:net': { Socket, _normalizeArgs: settings.normalize ?? normalize }, 'node:tls': {}, 'node:http': { request: forbidden }, 'node:https': {},
      'node:child_process': { fork: forbidden }, 'node:http2': {}, 'node:worker_threads': {}, 'node:module': { syncBuiltinESMExports() {} },
    }
    const vmModule = { exports: {} as { installContextualTestEgress(options: unknown): unknown } }
    const sourceFile = require.resolve('../../scripts/contextual-test-rehearsal-egress.cjs')
    const context = vm.createContext({ module: vmModule, exports: vmModule.exports, require: (id: string) => {
      if (!Object.hasOwn(modules, id)) throw Error('Unapproved CPU dependency'); return modules[id]
    }, process: { env: {}, argv: [] }, __filename: sourceFile, fetch: originalFetch, URL, Request, Response, AbortSignal, Buffer })
    vm.runInContext(readFileSync(sourceFile, 'utf8'), context, { timeout: 1000 })
    const install = () => vmModule.exports.installContextualTestEgress({ deadline: settings.deadline ?? Date.now() + 10000, ledger })
    return { install, state, note, dispatch, nativeConnect, originalFetch, forbidden, Socket,
      fetch: (url: string) => (context.fetch as typeof fetch)(url),
      socket: (...args: unknown[]) => Reflect.apply((Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown }).connect, {}, args) }
  }
  it('admits the real net.connect normalized tuple through the actual installer and bounded fetch', async () => {
    const h = harness(); h.install()
    const response = await h.fetch('http://127.0.0.1:54331/rest/v1/rpc/consume_auth_rate_limit')
    expect(await response.text()).toBe('{}')
    expect(h.dispatch).toHaveBeenCalledOnce()
    expect(h.dispatch.mock.calls[0][1]).toEqual({ host: '127.0.0.1', port: 54331, path: undefined })
    expect(h.state).toEqual({ app: 0, storage: 0, api: 1, flags: { denied: false, uncertain: false, expired: false, capExceeded: false } })
    expect(h.forbidden).not.toHaveBeenCalled()
  })
  it('preserves direct, positional and marked callback arguments and their effective native options', () => {
    const callback = () => {}, options = { host: '127.0.0.1', port: 54331 }, tuple = normalize([options, callback])
    for (const args of [[{ host: 'localhost', port: 3117 }], [54331, '127.0.0.1', callback], [tuple], [{ ...options, hostname: options.host }]]) {
      const h = harness(); h.install(); h.socket(...args)
      expect(h.dispatch).toHaveBeenCalledOnce()
      const originalArgs = h.dispatch.mock.calls[0][0]
      expect(originalArgs).toEqual(args)
      args.forEach((arg, index) => expect(originalArgs[index]).toBe(arg))
      expect(h.note).not.toHaveBeenCalled()
    }
  })
  it.each(['direct', 'marked'] as const)('rejects %s custom lookup before connector dispatch or lookup evaluation', form => {
    const lookup = vi.fn((_host: string, _options: unknown, callback: (error: null, address: string, family: number) => void) => callback(null, '203.0.113.9', 4))
    const getter = vi.fn(() => lookup)
    const ordinary = { host: 'localhost', port: 3117 }
    const targets = [
      { ...ordinary, lookup },
      Object.assign(Object.create({ lookup }), ordinary),
      Object.defineProperty({ ...ordinary }, 'lookup', { get: getter }),
      Object.assign(Object.create(Object.defineProperty({}, 'lookup', { get: getter })), ordinary),
    ]
    for (const target of targets) {
      const h = harness(); h.install()
      expect(() => h.socket(form === 'marked' ? normalize([target]) : target)).toThrow()
      expect(h.dispatch).not.toHaveBeenCalled(); expect(h.note).toHaveBeenCalledWith('denied')
      expect(lookup).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled()
    }
  })
  it('retains ordinary default lookup options and their original identity', () => {
    for (const target of [{ host: 'localhost', port: 3117 }, { host: 'localhost', port: 3117, lookup: undefined }]) {
      const h = harness(); h.install(); h.nativeConnect(target)
      expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.dispatch.mock.calls[0][1]).toBe(target)
      expect(h.note).not.toHaveBeenCalled()
    }
  })
  const marked = (options: unknown, callback: unknown = null, value: unknown = true) => Object.assign([options, callback], { [marker]: value })
  const cases: Array<[string, () => unknown[]]> = [
    ['foreign host', () => [{ host: 'example.invalid', port: 54331 }]],
    ['wrong port', () => [{ host: '127.0.0.1', port: 3117 }]],
    ['Unix path', () => [{ path: '/synthetic/socket' }]],
    ['unmarked array', () => [[{ host: '127.0.0.1', port: 54331 }, null]]],
    ['nested array', () => [[[{ host: '127.0.0.1', port: 54331 }, null], null]]],
    ['forged symbol', () => [Object.assign([{ host: '127.0.0.1', port: 54331 }, null], { [Symbol('normalizedArgs')]: true })]],
    ['contradictory hostname', () => [{ hostname: '127.0.0.1', host: 'example.invalid', port: 54331 }]],
    ['hostname only', () => [{ hostname: '127.0.0.1', port: 54331 }]],
    ['marked nested array', () => [marked([{ host: '127.0.0.1', port: 54331 }])]],
    ['marked foreign host', () => [normalize([{ host: 'example.invalid', port: 54331 }])]],
    ['marked invalid callback', () => [marked({ host: '127.0.0.1', port: 54331 }, 'invalid')]],
    ['truthy nontrue marker hiding another destination', () => [Object.assign(marked({ host: 'example.invalid', port: 80 }, null, 1), { host: '127.0.0.1', port: 54331 })]],
    ['false marker', () => [marked({ host: '127.0.0.1', port: 54331 }, null, false)]],
    ['proxy options', () => [new Proxy({ host: '127.0.0.1', port: 54331 }, {})]],
    ['proxy tuple', () => [new Proxy(normalize([{ host: '127.0.0.1', port: 54331 }]), {})]],
    ['host accessor', () => [{ get host() { throw Error('Accessor must not execute') }, port: 54331 }]],
    ['tuple accessor', () => [Object.defineProperty(marked({}, null), '0', { get() { throw Error('Accessor must not execute') } })]],
    ['coercible port', () => [{ host: '127.0.0.1', port: { valueOf() { throw Error('Coercion must not execute') } } }]],
    ['inherited hidden host', () => [Object.assign(Object.create({ host: 'example.invalid' }), { hostname: '127.0.0.1', port: 54331 })]],
  ]
  it.each(cases)('rejects %s before original connector dispatch and latches denial', (_label, args) => {
    const h = harness(); h.install()
    expect(() => h.socket(...args())).toThrow()
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.note).toHaveBeenCalledWith('denied')
    expect(h.state.api).toBe(0)
  })
  it('never evaluates destination accessors, proxy traps or port coercion while rejecting them', () => {
    const read = vi.fn(() => '127.0.0.1'), coerce = vi.fn(() => 54331), trap = vi.fn(() => '127.0.0.1')
    const targets = [
      { get host() { return read() }, port: 54331 },
      { host: '127.0.0.1', port: { valueOf: coerce } },
      new Proxy({ host: '127.0.0.1', port: 54331 }, { get: trap }),
      Object.defineProperty(marked({ host: '127.0.0.1', port: 54331 }), marker, { get: read }),
    ]
    for (const target of targets) {
      const h = harness(); h.install(); expect(() => h.socket(target)).toThrow()
      expect(h.dispatch).not.toHaveBeenCalled(); expect(h.note).toHaveBeenCalledWith('denied')
    }
    expect(read).not.toHaveBeenCalled(); expect(coerce).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled()
  })
  it('fails installation closed if the trusted normalizer marker shape drifts', () => {
    for (const normalize of [() => [], () => Object.assign([{}, null], { [Symbol('one')]: true, [Symbol('two')]: true }), () => Object.assign([{}, null], { [marker]: 1 })]) {
      const h = harness({ normalize })
      expect(h.install).toThrow(); expect(h.dispatch).not.toHaveBeenCalled(); expect(h.note).toHaveBeenCalledWith('denied')
    }
  })
  it('retains deadline rejection and the bounded original-body cap', async () => {
    const expired = harness({ deadline: Date.now() - 1 }); expired.install()
    expect(() => expired.nativeConnect({ host: '127.0.0.1', port: 54331 })).toThrow()
    expect(expired.dispatch).not.toHaveBeenCalled(); expect(expired.note).toHaveBeenCalledWith('expired')
    const large = harness({ bytes: 1048577 }); large.install()
    await expect(large.fetch('http://127.0.0.1:54331/rest/v1/users')).rejects.toThrow('Tests server bounded fetch failed')
    expect(large.dispatch).toHaveBeenCalledOnce(); expect(large.state.api).toBe(1)
    expect(large.state.flags).toMatchObject({ capExceeded: true, uncertain: true, denied: false })
  })
})

describe('installed Next version lookup stays offline before native dispatch', () => {
  const file = realpathSync(require.resolve('next/dist/server/dev/hot-reloader-webpack'))
  const registry = 'https://registry.npmjs.org/-/package/next/dist-tags'
  function hotReloader(version = '15.5.25') {
    type Instance = { tracedGetVersionInfo(span: unknown): Promise<unknown>; start(): Promise<unknown>; clean(): Promise<unknown>; versionInfo?: unknown; hotReloaderSpan?: unknown }
    type Exports = { default: new (...args: never[]) => Instance; getVersionInfo(): Promise<unknown>; matchNextPageBundleRequest: unknown; renderScriptError: unknown }
    const vmModule = { exports: {} as Exports }
    const fetch = vi.fn(async () => { throw Error('Forbidden CPU network dispatch') })
    const modules: Record<string, unknown> = {
      'next/package.json': { version }, 'next/dist/compiled/ws': { Server: class {} },
      '../../shared/lib/router/utils/path-match': { getPathMatch: () => () => undefined },
      '../lib/utils': { getNodeDebugType: () => undefined },
      path: require('node:path'), fs: {},
    }
    const cache: Record<string, typeof vmModule> = {}
    let originalExports: Exports
    const loader = Object.assign(vi.fn((id: string) => {
      if (id === 'next/package.json') return modules[id]
      if (id !== file) throw Error('Unapproved CPU load')
      if (!cache[file]) {
        vm.runInNewContext(readFileSync(file, 'utf8'), { module: vmModule, exports: vmModule.exports,
          require: (dependency: string) => modules[dependency] ?? {}, fetch, console, Buffer, process: { debugPort: 0 },
        }, { filename: file, timeout: 1000 })
        originalExports = vmModule.exports
        cache[file] = vmModule
      }
      return vmModule.exports
    }), { cache })
    const versionSpan = { traceAsyncFn: (fn: () => unknown) => fn() }
    const startSpan = { stop: vi.fn(), traceChild: vi.fn(() => versionSpan) }
    const span = { traceChild: vi.fn(() => startSpan) }
    const startThroughVersion = async (HotReloader: Exports['default']) => {
      const instance = Object.create(HotReloader.prototype) as Instance
      instance.hotReloaderSpan = span
      instance.clean = vi.fn(async () => { throw Error('Stopped after version lookup') })
      await expect(instance.start()).rejects.toThrow('Stopped after version lookup')
      return instance
    }
    return { module: vmModule, loader, fetch, span, startSpan, startThroughVersion, original: () => originalExports }
  }
  it('proves the installed instance path originally fetches and both wrapped entry points return the offline fallback', async () => {
    const before = hotReloader(), original = before.loader(file)
    await before.startThroughVersion(original.default)
    expect(before.fetch).toHaveBeenCalledOnce()
    expect(before.fetch).toHaveBeenCalledWith(registry)

    const after = hotReloader()
    disableContextualTestNextVersionLookup(file, after.loader)
    const fixed = after.loader.cache[file].exports
    const originalAfter = after.original()
    expect(Object.getOwnPropertyDescriptor(fixed, '__esModule')).toMatchObject({ value: true, enumerable: false, configurable: false })
    expect(Object.getPrototypeOf(fixed)).toBe(Object.getPrototypeOf(originalAfter))
    expect(fixed.default.prototype).toBeInstanceOf(originalAfter.default)
    expect(fixed.default.prototype.clean).toBe(originalAfter.default.prototype.clean)
    expect(fixed.matchNextPageBundleRequest).toBe(originalAfter.matchNextPageBundleRequest)
    expect(fixed.renderScriptError).toBe(originalAfter.renderScriptError)
    expect(Object.getOwnPropertyDescriptor(fixed, 'getVersionInfo')).toMatchObject({ writable: false, configurable: false })
    expect(await fixed.getVersionInfo()).toEqual({ installed: '15.5.25', staleness: 'unknown' })
    const instance = await after.startThroughVersion(fixed.default)
    expect(instance.versionInfo).toEqual({ installed: '15.5.25', staleness: 'unknown' })
    expect(after.span.traceChild).toHaveBeenCalledWith('start')
    expect(after.startSpan.traceChild).toHaveBeenCalledWith('get-version-info')
    expect(after.fetch).not.toHaveBeenCalled()
  })
  it('keeps generic foreign egress denial and the shared failure latch', () => {
    const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-version-egress-cpu-')))
    try {
      const binding = { outputDir, nonce: 'b'.repeat(32), deadline: Date.now() + 10000 }
      const ledger = createContextualTestSharedLedger(binding, { create: true })
      const policy = createContextualTestEgressPolicy({ ...binding, ledger })
      expect(() => policy.admit(registry)).toThrow()
      expect(ledger.snapshot()).toMatchObject({ flags: { denied: true } })
      expect(() => policy.admit('http://localhost:3117/api/auth/me')).toThrow()
      expect(ledger.snapshot()).toMatchObject({ app: 0, flags: { denied: true } })
    } finally { rmSync(outputDir, { recursive: true }) }
  })
  it('propagates trace failures without treating them as an offline success', async () => {
    const h = hotReloader()
    disableContextualTestNextVersionLookup(file, h.loader)
    const instance = Object.create(h.loader.cache[file].exports.default.prototype)
    const span = { traceChild: () => ({ traceAsyncFn: () => { throw Error('Trace failed') } }) }
    await expect(instance.tracedGetVersionInfo(span)).rejects.toThrow('Trace failed')
    expect(h.fetch).not.toHaveBeenCalled()
  })
  it('fails closed on source, cache, package or export drift before installing a wrapper', () => {
    const wrongFile = hotReloader()
    expect(() => disableContextualTestNextVersionLookup(realpathSync(require.resolve('next/package.json')), wrongFile.loader)).toThrow()
    expect(wrongFile.loader).not.toHaveBeenCalled()
    const warmCache = hotReloader(); const warmOriginal = warmCache.loader(file)
    expect(() => disableContextualTestNextVersionLookup(file, warmCache.loader)).toThrow()
    expect(warmCache.loader.cache[file].exports).toBe(warmOriginal)
    const wrongPackage = hotReloader('0.0.0')
    expect(() => disableContextualTestNextVersionLookup(file, wrongPackage.loader)).toThrow()
    expect(wrongPackage.loader.cache[file].exports).toBe(wrongPackage.original())
    const changedExport = hotReloader()
    const originalLoad = changedExport.loader
    const loader = Object.assign(vi.fn((id: string) => {
      const exports = originalLoad(id)
      if (id === file) {
        const malformed = { ...exports }
        changedExport.loader.cache[file].exports = malformed
        return malformed
      }
      return exports
    }), { cache: changedExport.loader.cache })
    expect(() => disableContextualTestNextVersionLookup(file, loader)).toThrow()
  })
})

describe('disabled installed Next telemetry stays disabled before native dispatch', () => {
  const file = realpathSync(require.resolve('next/dist/telemetry/storage'))
  function telemetry() {
    type Instance = { flushDetached(mode: string, directory: string): void; record(event: unknown, deferred: boolean): unknown }
    const vmModule = { exports: {} as { Telemetry: new (options: { distDir: string }) => Instance } }
    const spawn = vi.fn(), mkdir = vi.fn(), write = vi.fn(), env = { NEXT_TELEMETRY_DISABLED: '1' }
    const forbidden = () => { throw Error('No telemetry network in CPU test') }
    const modules: Record<string, unknown> = {
      '../lib/picocolors': {}, 'next/dist/compiled/conf': class { get() { return false }; set() {} },
      crypto: require('node:crypto'), 'next/dist/compiled/is-docker': () => false, path: require('node:path'),
      './anonymous-meta': { getAnonymousMeta: forbidden }, '../server/ci-info': { isCI: false },
      './post-telemetry-payload': { postNextTelemetryPayload: forbidden }, './project-id': { getRawProjectId: forbidden },
      'next/dist/compiled/@edge-runtime/ponyfill': { AbortController }, fs: { mkdirSync: mkdir, writeFileSync: write },
      child_process: { spawn, spawnSync: forbidden },
    }
    const nativeRequire = Object.assign((id: string) => {
      if (!Object.hasOwn(modules, id)) throw Error('Unapproved CPU dependency')
      return modules[id]
    }, { resolve: () => '/cpu/next/detached-flush.js' })
    vm.runInNewContext(readFileSync(file, 'utf8'), { module: vmModule, exports: vmModule.exports, require: nativeRequire,
      process: { env, execPath: '/cpu/node' }, Buffer, console }, { filename: file, timeout: 1000 })
    const loader = Object.assign(vi.fn(() => vmModule.exports), { cache: { [file]: vmModule } })
    return { module: vmModule, loader, spawn, mkdir, write, env }
  }
  it('demonstrates the real disabled-telemetry shutdown spawn and prevents it at the exact optional API', () => {
    const before = telemetry(), old = new before.module.exports.Telemetry({ distDir: '/cpu/dist' })
    old.record({ eventName: 'CPU', payload: {} }, true); old.flushDetached('dev', '/cpu/app')
    expect(before.spawn).toHaveBeenCalledOnce(); expect(before.write).toHaveBeenCalledOnce()
    const after = telemetry(), original = after.module.exports.Telemetry
    disableContextualTestNextTelemetry(file, after.loader, after.env)
    expect(Object.getOwnPropertyDescriptor(after.module.exports, '__esModule')).toMatchObject({ value: true, enumerable: false, configurable: false })
    const fixed = new after.module.exports.Telemetry({ distDir: '/cpu/dist' })
    expect(fixed).toBeInstanceOf(original)
    fixed.record({ eventName: 'CPU', payload: {} }, true); fixed.flushDetached('dev', '/cpu/app')
    expect(after.spawn).not.toHaveBeenCalled(); expect(after.mkdir).not.toHaveBeenCalled(); expect(after.write).not.toHaveBeenCalled()
    expect(Object.getOwnPropertyDescriptor(fixed, 'flushDetached')).toMatchObject({ writable: false, configurable: false })
  })
  it('refuses an enabled environment, dependency drift or a mismatched module cache', () => {
    const h = telemetry()
    expect(() => disableContextualTestNextTelemetry(file, h.loader, { NEXT_TELEMETRY_DISABLED: '0' })).toThrow()
    expect(() => disableContextualTestNextTelemetry(realpathSync(require.resolve('next/package.json')), h.loader, h.env)).toThrow()
    expect(h.loader).not.toHaveBeenCalled()
    expect(() => disableContextualTestNextTelemetry(file, Object.assign(() => h.module.exports, { cache: {} }), h.env)).toThrow()
  })
  it('fails closed if the explicit disabled environment changes after installation', () => {
    const h = telemetry(); disableContextualTestNextTelemetry(file, h.loader, h.env)
    const fixed = new h.module.exports.Telemetry({ distDir: '/cpu/dist' }); h.env.NEXT_TELEMETRY_DISABLED = '0'
    expect(() => fixed.flushDetached('dev', '/cpu/app')).toThrow()
    expect(() => new h.module.exports.Telemetry({ distDir: '/cpu/dist' })).toThrow()
    expect(h.spawn).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled()
  })
})

describe('installed Next static-path workers with CPU-only fork doubles', () => {
  const jestFile = realpathSync(require.resolve('next/dist/compiled/jest-worker'))
  const processChildPath = join(jestFile.slice(0, jestFile.lastIndexOf('/')), 'processChild.js')
  const staticPathsWorkerPath = realpathSync(require.resolve('next/dist/server/dev/static-paths-worker'))
  const parentEnv = { NEXT_PRIVATE_WORKER: '1', NEXT_DISABLE_MEM_OVERRIDE: '1', NODE_OPTIONS: '--require=/private/guard.cjs --enable-source-maps', PIKA_CONTEXTUAL_TEST_BINDING_FILE: '/private/binding.json', PIKA_CONTEXTUAL_TEST_BINDING_SHA256: 'a'.repeat(64) }
  const cwd = '/private/disposable/app'
  function harness() {
    const children: Array<EventEmitter & { send: (message: unknown, ...rest: unknown[]) => boolean; originalSend: ReturnType<typeof vi.fn<(...args: unknown[]) => boolean>>; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
    const note = vi.fn()
    const fork = vi.fn(() => {
      const send = vi.fn((_message: unknown, ..._rest: unknown[]) => true)
      const c = Object.assign(new EventEmitter(), { send, originalSend: send, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
      children.push(c); return c
    })
    const guard = createContextualTestStaticWorkerFork({ processChildPath, staticPathsWorkerPath, parentEnv, parentExecArgv: [], appDir: cwd,
      preloadPath: '/private/guard.cjs', deadline: Date.now() + 120000, ledger: { note }, fork })
    const call = (change: Record<string, unknown> = {}, module = processChildPath, args: unknown[] = []) => guard(module, args, {
      cwd, env: { ...parentEnv }, execArgv: [], silent: true, ...change,
    })
    const payload = { dir: cwd, distDir: join(cwd, '.next'), pathname: '/classrooms/[classroomId]', page: '/classrooms/[classroomId]/page', isAppPath: true }
    const initialize = (c: (typeof children)[number]) => c.send([0, false, staticPathsWorkerPath, []])
    const work = (c: (typeof children)[number]) => c.send([1, true, 'loadStaticPaths', [payload]], () => {})
    const finish = (c: (typeof children)[number]) => { c.emit('message', [0, { prerenderedRoutes: [] }]); c.send([2, false], () => {}); c.emit('exit', 0, null); c.emit('close', 0, null) }
    return { guard, call, children, fork, note, payload, initialize, work, finish }
  }
  it('accepts successive one-shot workers and retains active identity until positive close', () => {
    const h = harness(), first = h.call(); h.initialize(first); h.work(first)
    first.emit('message', [0, { prerenderedRoutes: [] }]); first.send([2, false], () => {}); first.emit('exit', 0, null)
    expect(h.guard.snapshot()).toMatchObject({ launched: 1, active: 1, failed: false })
    first.emit('close', 0, null)
    const second = h.call(); h.initialize(second); h.work(second); h.finish(second)
    expect(h.guard.snapshot()).toMatchObject({ launched: 2, active: 0, failed: false })
    expect(h.note).not.toHaveBeenCalled()
  })
  it('uses the actual installed jest-worker fork and IPC call shapes without any native child', async () => {
    const h = harness(), vmModule = { exports: {} as { Worker: new (file: string, options: unknown) => { loadStaticPaths(value: unknown): Promise<unknown>; end(): Promise<unknown> } } }
    const nativeRequire = (id: string) => {
      if (id === 'child_process') return { fork: h.guard }
      if (id === staticPathsWorkerPath) return { loadStaticPaths: () => {} }
      if (['os','path','stream','tty'].includes(id)) return require(id)
      if (id === 'worker_threads') return { Worker: () => { throw Error('Worker threads forbidden') } }
      throw new Error(`Unapproved CPU dependency: ${id}`)
    }
    vm.runInNewContext(readFileSync(jestFile, 'utf8'), { module: vmModule, exports: vmModule.exports, require: nativeRequire, __dirname: jestFile.slice(0, jestFile.lastIndexOf('/')),
      process: { env: { ...parentEnv }, cwd: () => cwd, execArgv: [], argv: ['node'], platform: process.platform, stdout: { isTTY: false }, stderr: { isTTY: false } },
      setTimeout, clearTimeout, Buffer, console }, { filename: jestFile, timeout: 1000 })
    const worker = new vmModule.exports.Worker(staticPathsWorkerPath, { numWorkers: 1, maxRetries: 1, enableWorkerThreads: false,
      forkOptions: { env: { ...parentEnv } } })
    const result = worker.loadStaticPaths(h.payload)
    expect(h.fork).toHaveBeenCalledOnce(); expect(h.children[0].originalSend).toHaveBeenCalledTimes(2)
    h.children[0].emit('message', [0, { prerenderedRoutes: [] }]); await result
    const ended = worker.end(); h.children[0].emit('exit', 0, null); h.children[0].emit('close', 0, null); await ended
    expect(h.guard.snapshot()).toMatchObject({ launched: 1, active: 0, failed: false })
  })
  it.each(['env','preload','execArgv','cwd','module','args'] as const)('rejects %s drift before child creation', kind => {
    const h = harness()
    const changes = kind === 'env' ? { env: { ...parentEnv, OPENAI_API_KEY: 'forbidden' } } : kind === 'preload' ? { env: { ...parentEnv, NODE_OPTIONS: '' } }
      : kind === 'execArgv' ? { execArgv: ['--inspect'] } : kind === 'cwd' ? { cwd: '/foreign' } : {}
    expect(() => h.call(changes, kind === 'module' ? staticPathsWorkerPath : processChildPath, kind === 'args' ? ['--other'] : [])).toThrow()
    expect(h.fork).not.toHaveBeenCalled(); expect(h.note).toHaveBeenCalledWith('denied')
  })
  it('rejects foreign work initialization and repeated work in the same child', () => {
    const foreign = harness(), c = foreign.call()
    expect(() => c.send([0, false, '/foreign/module.js', []])).toThrow()
    const repeat = harness(), second = repeat.call(); repeat.initialize(second); repeat.work(second)
    expect(() => repeat.work(second)).toThrow(); expect(repeat.note).toHaveBeenCalledWith('denied')
  })
  it('latches abnormal exit before jest can respawn and rejects extra workers', () => {
    const h = harness(), c = h.call(); h.initialize(c); h.work(c)
    const retry = vi.fn(() => expect(() => h.call()).toThrow())
    c.on('exit', retry); c.emit('exit', 1, null)
    expect(retry).toHaveBeenCalledOnce(); expect(h.fork).toHaveBeenCalledOnce()
    expect(h.guard.snapshot()).toMatchObject({ launched: 1, active: 1, failed: true })
  })
  it('allows at most the existing 1000-request-derived one-shot worker ceiling', () => {
    const h = harness()
    for (let i = 0; i < 1000; i++) { const c = h.call(); h.initialize(c); h.work(c); h.finish(c) }
    expect(h.guard.snapshot()).toMatchObject({ launched: 1000, active: 0, failed: false })
    expect(() => h.call()).toThrow(); expect(h.fork).toHaveBeenCalledTimes(1000)
  })
  it.each(['pathname','dir','distDir','isAppPath','method'] as const)('rejects static work %s drift', field => {
    const h = harness(), c = h.call(); h.initialize(c)
    const work = { ...h.payload, [field]: field === 'isAppPath' ? false : '/foreign' }
    expect(() => c.send([1, true, field === 'method' ? 'otherMethod' : 'loadStaticPaths', [work]])).toThrow()
    expect(h.note).toHaveBeenCalledWith('denied')
  })
  it('closes worker admission at its original operation deadline', () => {
    vi.useFakeTimers()
    try {
      const h = harness(), c = h.call(); h.initialize(c); h.work(c)
      vi.advanceTimersByTime(30000)
      expect(h.note).toHaveBeenCalledWith('uncertain'); expect(() => h.call()).toThrow()
      expect(h.fork).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('the actual preload installer forbids processChild from creating any descendant', () => {
    const nativeFork = vi.fn(), note = vi.fn(), child = { fork: nativeFork }
    const Socket = function () {}; Socket.prototype.connect = () => {}
    const modules: Record<string, unknown> = {
      'node:assert/strict': require('node:assert/strict'), 'node:fs': require('node:fs'), 'node:path': require('node:path'), 'node:crypto': require('node:crypto'),
      'node:net': { Socket, _normalizeArgs: require('node:net')._normalizeArgs }, 'node:util': require('node:util'), 'node:tls': {}, 'node:http': { request: () => { throw Error('No HTTP in CPU test') } }, 'node:https': {},
      'node:child_process': child, 'node:http2': {}, 'node:worker_threads': {}, 'node:module': { syncBuiltinESMExports() {} },
    }
    const vmModule = { exports: {} as { installContextualTestEgress(options: unknown): unknown } }
    const sourceFile = require.resolve('../../scripts/contextual-test-rehearsal-egress.cjs')
    vm.runInNewContext(readFileSync(sourceFile, 'utf8'), { module: vmModule, exports: vmModule.exports, require: (id: string) => {
      if (!Object.hasOwn(modules, id)) throw Error('Unapproved CPU require'); return modules[id]
    }, __filename: sourceFile, process: { env: { NEXT_PRIVATE_WORKER: '1' }, argv: ['node', processChildPath], execArgv: [], platform: process.platform },
    setTimeout, clearTimeout, Buffer, console }, { filename: sourceFile, timeout: 1000 })
    vmModule.exports.installContextualTestEgress({ nextServerPath: realpathSync(require.resolve('next/dist/server/lib/start-server')),
      processChildPath, staticPathsWorkerPath, appDir: cwd, deadline: Date.now() + 10000, ledger: { note } })
    expect(() => (child as unknown as { fork(...args: unknown[]): unknown }).fork(processChildPath, [], {})).toThrow()
    expect(() => (child as unknown as { spawn(...args: unknown[]): unknown }).spawn('/unapproved', [])).toThrow()
    expect(note).toHaveBeenCalledWith('denied')
    expect(nativeFork).not.toHaveBeenCalled()
  })
})

describe('bounded original server transports (no network dispatch)', () => {
  it('enforces an absolute HTTP body deadline even with regular data', () => {
    vi.useFakeTimers()
    try {
      const note = vi.fn(), req = Object.assign(new EventEmitter(), { destroy: vi.fn() }), res = new EventEmitter()
      boundContextualTestHttpRequest(req, { deadline: Date.now() + 100000, ledger: { note } })
      req.emit('response', res)
      for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(5000); res.emit('data', Buffer.from('x')) }
      expect(req.destroy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5000)
      expect(req.destroy).toHaveBeenCalledOnce(); expect(note).toHaveBeenCalledWith('uncertain')
    } finally { vi.useRealTimers() }
  })
  it('retains HTTP size and premature-close failures', () => {
    const note = vi.fn(), req = Object.assign(new EventEmitter(), { destroy: vi.fn() }), res = new EventEmitter()
    boundContextualTestHttpRequest(req, { deadline: Date.now() + 10000, ledger: { note } })
    req.emit('response', res); res.emit('data', Buffer.alloc(1048577)); req.emit('close')
    expect(note).toHaveBeenCalledWith('capExceeded'); expect(note).toHaveBeenCalledWith('uncertain')
  })
  it('does not misclassify a complete HTTP response as uncertain', () => {
    const note = vi.fn(), req = Object.assign(new EventEmitter(), { destroy: vi.fn() }), res = new EventEmitter()
    boundContextualTestHttpRequest(req, { deadline: Date.now() + 10000, ledger: { note } })
    req.emit('response', res); res.emit('data', Buffer.from('{}')); res.emit('end'); req.emit('close')
    expect(note).not.toHaveBeenCalled()
  })
  it('reads the original fetch body and permanently records overflow without raw errors', async () => {
    const note = vi.fn(), original = vi.fn(async (_input: string, _init: RequestInit) => new Response(Buffer.alloc(1048577)))
    const bounded = createContextualTestBoundedFetch(original, { deadline: Date.now() + 10000, ledger: { note } }, { admit: vi.fn(), check: vi.fn() })
    await expect(bounded('http://127.0.0.1:54331/rest/v1/x')).rejects.toThrow('Tests server bounded fetch failed')
    expect(original).toHaveBeenCalledOnce(); expect(note).toHaveBeenCalledWith('capExceeded')
    expect(note).toHaveBeenCalledWith('uncertain')
    expect(original.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })
})

describe('Tests server egress allocation', () => {
  it('permits only the exact app and isolated API origins', () => {
    const policy = createContextualTestEgressPolicy({ deadline: Date.now() + 10000 })
    expect(policy.admit('http://localhost:3117/api/auth/me')).toBe('app')
    expect(policy.admit('http://127.0.0.1:54331/rest/v1/users')).toBe('api')
    expect(policy.admit('http://127.0.0.1:54331/storage/v1/object/x')).toBe('storage')
    for (const u of ['https://api.openai.com/v1', 'http://127.0.0.1:54321', 'http://localhost:54331', 'http://localhost:3117@evil.test', 'http://localhost:3117/#x', 'http://127.0.0.1:54331/auth/v1/token', 'http://127.0.0.1:54331/rest/v10/users']) expect(() => policy.admit(u)).toThrow()
  })
  it('enforces the reserved 50 app and 20 Storage server requests', () => {
    const policy = createContextualTestEgressPolicy({ deadline: Date.now() + 10000 })
    for (let i = 0; i < 100; i++) policy.admit('http://127.0.0.1:54331/rest/v1/users')
    expect(policy.counts().app).toBe(0)
    for (let i = 0; i < 50; i++) policy.admit('http://localhost:3117/api/auth/me')
    expect(() => policy.admit('http://localhost:3117/api/auth/me')).toThrow()
    for (let i = 0; i < 20; i++) policy.admit('http://127.0.0.1:54331/storage/v1/object/x')
    expect(() => policy.admit('http://127.0.0.1:54331/storage/v1/object/x')).toThrow()
  })
  it('fails closed on any expiry or unsupported socket', () => {
    const policy = createContextualTestEgressPolicy({ deadline: Date.now() - 1 })
    expect(() => policy.socket({ host: 'localhost', port: 3117 })).toThrow()
    const live = createContextualTestEgressPolicy({ deadline: Date.now() + 10000 })
    expect(() => live.socket({ path: '/var/run/docker.sock' })).toThrow()
    expect(() => live.socket({ host: '169.254.169.254', port: 80 })).toThrow()
    expect(() => live.socket({ host: '127.0.0.1', port: 3117 })).toThrow()
    expect(live.socket({ host: '127.0.0.1', port: 54331 })).toBeUndefined()
  })
  it('allows only the installed Next fork shape with the same preload and hermetic environment', () => {
    const parent = { NEXT_DISABLE_MEM_OVERRIDE: '1', NODE_OPTIONS: '--require=/private/guard.cjs', SESSION_SECRET: 'synthetic' }
    const args = { stdio: 'inherit', env: { ...parent, NEXT_PRIVATE_WORKER: '1', NEXT_PRIVATE_TRACE_ID: 'a'.repeat(16), WATCHPACK_WATCHER_LIMIT: '20', NODE_OPTIONS: `${parent.NODE_OPTIONS} --enable-source-maps` } }
    const call = (overrides: Record<string, unknown> = {}) => validateContextualTestNextFork('/exact/start-server.js', '/exact/start-server.js', { ...args, ...overrides }, undefined, parent, '/private/guard.cjs', 'darwin')
    expect(() => call()).not.toThrow()
    expect(() => call({ env: { ...args.env, OPENAI_API_KEY: 'never-inherit' } })).toThrow()
    expect(() => call({ env: { ...args.env, NODE_OPTIONS: '--inspect' } })).toThrow()
    expect(() => call({ env: { ...args.env, NODE_EXTRA_CA_CERTS: '/unreviewed.pem' } })).toThrow()
    expect(() => call({ args: ['--unreviewed'] })).toThrow()
    expect(() => validateContextualTestNextFork('/exact/start-server.js', '/other/script.js', args, undefined, parent, '/private/guard.cjs', 'darwin')).toThrow()
  })
})

describe('shared Next parent/child request ledger', () => {
  function fixture() {
    const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-egress-ledger-cpu-')))
    const binding = { outputDir, nonce: 'a'.repeat(32), deadline: Date.now() + 10000 }
    const ledger = createContextualTestSharedLedger(binding, { create: true })
    return { binding, ledger, close: () => rmSync(outputDir, { recursive: true }) }
  }
  it('shares app and Storage counters across two policy instances without charging REST/RPC as app', () => {
    const f = fixture()
    try {
      const other = createContextualTestSharedLedger(f.binding)
      const parent = createContextualTestEgressPolicy({ ...f.binding, ledger: f.ledger })
      const child = createContextualTestEgressPolicy({ ...f.binding, ledger: other })
      for (let i = 0; i < 150; i++) child.admit('http://127.0.0.1:54331/rest/v1/rpc/private_read')
      for (let i = 0; i < 25; i++) { parent.admit('http://localhost:3117/a'); child.admit('http://localhost:3117/b') }
      expect(other.snapshot()).toMatchObject({ app: 50, storage: 0, api: 150 })
      expect(() => child.admit('http://localhost:3117/51')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ app: 50, flags: { capExceeded: true } })
      expect(() => parent.admit('http://127.0.0.1:54331/rest/v1/users')).toThrow()
    } finally { f.close() }
  })
  it('shares exactly twenty Storage operations and never doubles the child allowance', () => {
    const f = fixture()
    try {
      const other = createContextualTestSharedLedger(f.binding)
      for (let i = 0; i < 10; i++) { f.ledger.charge('storage'); other.charge('storage') }
      expect(() => other.charge('storage')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ storage: 20, flags: { capExceeded: true } })
    } finally { f.close() }
  })
  it('refuses recreation, nonce/deadline drift and insecure files without overwriting them', () => {
    const f = fixture()
    try {
      const original = readFileSync(f.ledger.paths.ledger, 'utf8')
      expect(() => createContextualTestSharedLedger(f.binding, { create: true })).toThrow()
      expect(() => createContextualTestSharedLedger({ ...f.binding, nonce: 'b'.repeat(32) })).toThrow()
      expect(() => createContextualTestSharedLedger({ ...f.binding, deadline: f.binding.deadline + 1 })).toThrow()
      expect(readFileSync(f.ledger.paths.ledger, 'utf8')).toBe(original)
      chmodSync(f.ledger.paths.ledger, 0o644)
      expect(() => f.ledger.charge('app')).toThrow()
      expect(readFileSync(f.ledger.paths.ledger, 'utf8')).toBe(original)
    } finally { f.close() }
  })
  it('does not adopt an existing lock and leaves a durable uncertainty marker', () => {
    const f = fixture()
    try {
      writeFileSync(f.ledger.paths.lock, 'foreign lock', { mode: 0o600, flag: 'wx' })
      const start = Date.now()
      expect(() => f.ledger.charge('app')).toThrow()
      expect(Date.now() - start).toBeLessThan(500)
      expect(readFileSync(f.ledger.paths.lock, 'utf8')).toBe('foreign lock')
      expect(JSON.parse(readFileSync(f.ledger.paths.poison, 'utf8'))).toMatchObject({ nonce: f.binding.nonce, uncertain: true })
    } finally { f.close() }
  })
  it.each(['replacement','symlink'] as const)('refuses a %s ledger without touching the replacement', kind => {
    const f = fixture()
    try {
      const original = readFileSync(f.ledger.paths.ledger, 'utf8')
      const moved = join(f.binding.outputDir, 'original.json')
      renameSync(f.ledger.paths.ledger, moved)
      if (kind === 'replacement') writeFileSync(f.ledger.paths.ledger, original, { mode: 0o600, flag: 'wx' })
      else symlinkSync(moved, f.ledger.paths.ledger)
      expect(() => f.ledger.charge('app')).toThrow()
      expect(readFileSync(f.ledger.paths.ledger, 'utf8')).toBe(original)
    } finally { f.close() }
  })
  it('retains denial and expiry flags for the final receipt', () => {
    const f = fixture()
    try {
      const policy = createContextualTestEgressPolicy({ ...f.binding, ledger: f.ledger })
      expect(() => policy.admit('https://provider.example.test/')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ flags: { denied: true } })
      const expired = createContextualTestEgressPolicy({ deadline: Date.now() - 1, ledger: f.ledger })
      expect(() => expired.admit('http://localhost:3117/a')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ flags: { denied: true, expired: true } })
    } finally { f.close() }
  })
})
